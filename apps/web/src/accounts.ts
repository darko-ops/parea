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

import { generateHandle, normaliseEmail, recordModeration, REASON, schema } from '@parea/core';

import { getStorage } from './storage';
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

/** How many names to try before admitting the lists are not the problem. */
const HANDLE_TRIES = 8;

/**
 * Give this actor a handle if it has none.
 *
 * Called on the way in rather than offered on a form. An empty field labelled
 * "Handle" is homework at the door, and the accounts that skip it are the ones
 * left with nothing to show beside a name — so everyone leaves sign-in with a
 * real one, and Edit profile is where it becomes theirs.
 *
 * The write is conditional on the handle still being null, which is what makes
 * this safe to call on every sign-in: two tabs signing in at once cannot
 * produce two names, and it can never overwrite one somebody chose.
 *
 * Failure is quiet and returns null. A person who cannot sign in because the
 * generator lost eight coin flips is a worse outcome than a person with no
 * handle, and the next sign-in tries again.
 */
export async function ensureHandle(db: Db, actorId: string): Promise<string | null> {
  for (let attempt = 0; attempt < HANDLE_TRIES; attempt++) {
    const handle = generateHandle();
    try {
      const updated = await db
        .update(schema.actors)
        .set({ handle })
        .where(and(eq(schema.actors.id, actorId), isNull(schema.actors.handle)))
        .returning({ handle: schema.actors.handle });
      // Empty means the row already had one — nothing to do, and not a loss
      // worth retrying, because retrying would find the same row.
      return updated.length > 0 ? handle : null;
    } catch {
      // The unique index on `lower(handle)`. Another name, same as anyone
      // typing one that is taken.
    }
  }
  return null;
}

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
 *
 * Whichever shape it took, the actor that comes out of it leaves with a
 * handle. `ensureHandle` is outside the three branches rather than repeated in
 * them: it is the same thing in all three, and the branch it would be easiest
 * to forget is the merge, where the handle belongs to the actor that won.
 */
export async function signIn(
  db: Db,
  email: string,
  actorId: string,
): Promise<SignInResult> {
  const result = await bindAccount(db, email, actorId);
  await ensureHandle(db, result.actorId);
  return result;
}

async function bindAccount(
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

export type AccountProfile = {
  email: string;
  displayName: string | null;
  handle: string | null;
  /** Presigned and short-lived. The bucket is private; see `avatarUrl`. */
  avatarUrl: string | null;
};

export async function accountFor(
  db: Db,
  actorId: string,
): Promise<AccountProfile | null> {
  // The name comes back with the address because the page that asks for one
  // asks for the other in the same breath, and two round trips to render one
  // header is two chances for it to arrive half-drawn.
  const [row] = await db
    .select({
      email: schema.accounts.email,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.actors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  if (!row) return null;

  const { avatarKey, ...rest } = row;
  return { ...rest, avatarUrl: await avatarUrl(avatarKey) };
}

/**
 * A URL a browser can load the picture from.
 *
 * Presigned against R2 rather than proxied: `deploy.md` is explicit that the
 * app tier serves HTML and JSON and never photo bytes, and a profile picture
 * is photo bytes. The browser fetches it from storage directly and the app
 * only ever hands over the address.
 *
 * Short-lived on purpose. The URL is a capability, and the page holding it is
 * re-rendered often enough that an hour is generous.
 */
export async function avatarUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  return getStorage()
    .presignGet(key, 3600)
    .catch(() => null);
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
