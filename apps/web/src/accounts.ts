/**
 * Accounts — design §3.
 *
 * "Optional, asked for only after value has been delivered." An account here
 * carries an email address and nothing else: it exists so that a person is
 * still themselves on a new phone, which is the one thing a device-bound
 * identity cannot do. It grants nothing an actor does not already have.
 *
 * The whole surface is three verbs — ask for a code, present one, delete the
 * account — and the third is not optional: App Store Guideline 5.1.1(v)
 * requires an app that creates accounts to delete them in-app.
 */

import { normaliseEmail, recordModeration, REASON, schema } from '@parea/core';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Db } from './db';
import { mergeActor } from './merge';

/** Long enough to find the mail, short enough that a leaked one is stale. */
export const CODE_TTL_MS = 10 * 60_000;
/** Six digits is a million; without a ceiling that is a few hours of guessing. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Stored as an HMAC, never in the clear.
 *
 * A read of this table should grant nothing. Keyed rather than plain-hashed
 * because six digits is a space you can enumerate in microseconds — an
 * unkeyed hash of a six-digit code is the code.
 */
function hashCode(secret: string, email: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest();
}

export async function storeCode(
  db: Db,
  secret: string,
  email: string,
  code: string,
  now = new Date(),
): Promise<void> {
  await db.insert(schema.signInCodes).values({
    email,
    codeHash: hashCode(secret, email, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
}

export type CodeCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'no_code' | 'expired' | 'wrong' | 'too_many' };

/**
 * Checks a code and consumes it.
 *
 * Only the newest outstanding code for an address is considered. Asking again
 * should invalidate the previous one — otherwise every request widens the
 * window rather than refreshing it, and a person who requested three codes has
 * three live secrets in three inboxes.
 */
export async function consumeCode(
  db: Db,
  secret: string,
  email: string,
  code: string,
  now = new Date(),
): Promise<CodeCheck> {
  const [row] = await db
    .select()
    .from(schema.signInCodes)
    .where(and(eq(schema.signInCodes.email, email), isNull(schema.signInCodes.consumedAt)))
    .orderBy(desc(schema.signInCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: 'no_code' };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'too_many' };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

  const expected = hashCode(secret, email, code);
  const stored = Buffer.from(row.codeHash);
  const matches =
    stored.length === expected.length && timingSafeEqual(stored, expected);

  if (!matches) {
    // Counted against the code, not the request: a fresh code would otherwise
    // reset the budget and there would be no ceiling at all.
    await db
      .update(schema.signInCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(schema.signInCodes.id, row.id));
    return { ok: false, reason: 'wrong' };
  }

  await db
    .update(schema.signInCodes)
    .set({ consumedAt: now })
    .where(eq(schema.signInCodes.id, row.id));
  return { ok: true, email };
}

export type SignInResult = { actorId: string; email: string; merged: boolean };

/**
 * Binds this device's actor to the account for `email`, creating it if needed.
 *
 * Three shapes, and the third is the interesting one:
 *
 *   - no account yet — create it, keep this actor, nothing moves. §3: "claiming
 *     an account sets `account_id`; nothing else moves."
 *   - the account is already this actor — nothing to do.
 *   - the account belongs to another actor — the same person on another
 *     device. Fold this one into it, so forty photos taken on a phone stop
 *     belonging to a stranger the moment they sign in on a laptop.
 */
export async function signIn(
  db: Db,
  email: string,
  actorId: string,
): Promise<SignInResult> {
  const [existing] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);

  if (!existing) {
    const [account] = await db.insert(schema.accounts).values({ email }).returning();
    await db
      .update(schema.actors)
      .set({ accountId: account!.id, kind: 'user' })
      .where(eq(schema.actors.id, actorId));
    return { actorId, email, merged: false };
  }

  const [canonical] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(eq(schema.actors.accountId, existing.id), isNull(schema.actors.mergedIntoId)),
    )
    .limit(1);

  // An account whose actor is gone: adopt this one rather than stranding it.
  if (!canonical) {
    await db
      .update(schema.actors)
      .set({ accountId: existing.id, kind: 'user' })
      .where(eq(schema.actors.id, actorId));
    return { actorId, email, merged: false };
  }

  if (canonical.id === actorId) return { actorId, email, merged: false };

  await mergeActor(db, actorId, canonical.id);
  return { actorId: canonical.id, email, merged: true };
}

export async function accountFor(
  db: Db,
  actorId: string,
): Promise<{ email: string } | null> {
  const [row] = await db
    .select({ email: schema.accounts.email })
    .from(schema.actors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  return row ?? null;
}

/**
 * Deletes the account, and only the account.
 *
 * The actor survives as a guest, keeping its uploads. That is a judgement
 * worth stating: the photos are in other people's events, and the person can
 * still remove any of them one at a time or all at once — `deleteEverything`
 * below is offered next to this in the UI. Silently tombstoning a shared event
 * because someone closed an account would take away other people's copies of
 * an evening they were also at.
 *
 * What is deleted here is what an account *is*: the address, and the link
 * between it and this person's devices.
 */
export async function deleteAccount(db: Db, actorId: string): Promise<boolean> {
  const [actor] = await db
    .select({ accountId: schema.actors.accountId })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  if (!actor?.accountId) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.actors)
      .set({ accountId: null, kind: 'guest' })
      .where(eq(schema.actors.accountId, actor.accountId!));
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, actor.accountId!));
  });
  return true;
}

/** Tombstones every photo this actor uploaded. The purge job removes the bytes. */
export async function deleteEverything(db: Db, actorId: string): Promise<number> {
  const removed = await db
    .update(schema.photos)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.photos.uploaderId, actorId), isNull(schema.photos.deletedAt)))
    .returning({ id: schema.photos.id, eventId: schema.photos.eventId });

  // One row each. A bulk deletion that leaves no trace is the case where
  // "where did all of these go" has no answer at all, and it is the largest
  // single removal the product can perform.
  for (const photo of removed) {
    await recordModeration(db, {
      photoId: photo.id,
      eventId: photo.eventId,
      action: 'removed',
      actorId,
      reason: REASON.accountDeleted,
    });
  }
  return removed.length;
}

/** Spent and stale codes. Called from the purge job. */
export function staleCodes(now: Date) {
  return lt(schema.signInCodes.expiresAt, now);
}

export { normaliseEmail };
