/**
 * Phone numbers, which this product deliberately does not keep.
 *
 * The feature is "somebody who already has your number can find you". Nothing
 * about it needs the digits: it needs to know that two people typed the same
 * number. So a number is turned into a keyed hash on arrival and the number
 * itself is never written down — not in a column, not in a log, not in an
 * analytics event. A copy of the actor table is not a phone book.
 *
 * ## Why HMAC and not a digest
 *
 * There are about ten billion phone numbers. A bare SHA-256 of one is
 * reversible by generating all ten billion, which is an afternoon on a laptop
 * — so an unkeyed hash of a phone number is a phone number with extra steps.
 * The key makes the table useless to anybody who takes it without also taking
 * the environment.
 *
 * The cost of the key is that matching has to happen here rather than on
 * somebody's phone: a client that could hash a number the same way would have
 * to hold the key, and a key on ten thousand phones is a published key. So a
 * number reaches this server in a request body over TLS, and this file hashes
 * and discards it. "Never stored" is the true claim; "never sent" would not be,
 * and the privacy page says so in those words.
 *
 * ## The two ways a number arrives, and the one that does not exist
 *
 * Somebody types their own, to be findable. Somebody types one they already
 * have, to look a person up. That is all — there is no address-book import in
 * this product and this file is the reason there does not need to be one: a
 * contact upload is a list of numbers belonging to people who never agreed to
 * anything, and the recommendations on the Find Friends page are derived from
 * albums, groups and friendships instead. See `recommendationsFor`.
 *
 * ## Why a number has to be proved
 *
 * A hash says two people typed the same digits. It says nothing about whose
 * digits they are — so a column written straight from a form is a column
 * anybody can fill with anybody's number, and the person harmed by that is the
 * one who owns it, who is not here and cannot see it happen. Hence
 * `startVerification` and `confirmVerification` below, and hence
 * `phone_verified_at`, which is what every lookup actually reads.
 */

import { schema } from '@parea/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Db } from './db';

/**
 * What a number has to look like before it can be hashed.
 *
 * Full international form, because a hash only matches another hash of the
 * *identical* string: "07700 900123" and "+44 7700 900123" are one number and
 * two hashes, and the product has no way to know which country a bare local
 * number belongs to. Asking for the country code is the only version of this
 * that works, so it is asked for rather than guessed.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('+')) return null;

  const digits = trimmed.slice(1).replace(/[\s()\-.]/g, '');
  // E.164: up to fifteen digits, and a country code is at least one, so
  // anything under seven is not a phone number anybody can be reached on.
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** The last two digits, for a profile that has to say which number this is. */
export function lastTwo(e164: string): string {
  return e164.slice(-2);
}

function key(): string {
  const value = process.env.PHONE_PEPPER ?? process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PHONE_PEPPER or SESSION_SECRET is required in production');
    }
    return 'dev-pepper-not-for-production';
  }
  return value;
}

/**
 * The stored form.
 *
 * Falls back to `SESSION_SECRET` when no dedicated pepper is set, which is a
 * real decision rather than laziness: a separate key can be rotated without
 * signing everybody out, and rotating it invalidates every stored hash — every
 * number would have to be entered again. Sharing the session secret means one
 * fewer thing to configure and one fewer thing to lose; setting `PHONE_PEPPER`
 * is the better answer for a deployment that has somewhere safe to keep it.
 */
export function hashPhone(e164: string): string {
  return createHmac('sha256', key()).update(e164).digest('base64url');
}

/** Constant-time, because this is used to decide whether two people match. */
export function samePhone(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * How long a verification code is good for.
 *
 * The same ten minutes a sign-in code gets. Long enough to find the text after
 * putting the phone down, short enough that one read over a shoulder is stale
 * by the time it is useful.
 */
export const PHONE_CODE_TTL_MS = 10 * 60_000;

/**
 * Wrong guesses allowed against one code.
 *
 * Six digits is a million, and a million is a few hours of guessing without a
 * ceiling. Counted on the row rather than per request, for the reason
 * `consumeCode` gives: a fresh code would otherwise reset the budget and there
 * would be no ceiling at all.
 */
export const MAX_PHONE_ATTEMPTS = 5;

/**
 * The stored form of a code.
 *
 * Keyed on the actor as well as the code, so a row lifted out of this table
 * cannot be replayed against another account even by somebody holding the
 * secret — and unkeyed hashing would be pointless anyway over a space of a
 * million.
 */
function hashCode(secret: string, actorId: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${actorId}:${code}`).digest();
}

/**
 * Write down what will land on the actor if the code comes back.
 *
 * The hash and the two digits, never the number. The digits are in memory for
 * the length of the request that sends the text and are gone with it — which is
 * the whole reason this row exists in a table of its own rather than as two
 * nullable "pending" columns on `actor`: a pending column is a column, and a
 * column holding the makings of a claim nobody has proved is exactly what this
 * design is trying not to have.
 */
export async function startVerification(
  db: Db,
  secret: string,
  actorId: string,
  e164: string,
  code: string,
  now = new Date(),
): Promise<void> {
  await db.insert(schema.phoneCodes).values({
    actorId,
    phoneHash: hashPhone(e164),
    phoneLast2: lastTwo(e164),
    codeHash: hashCode(secret, actorId, code),
    expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_MS),
  });
}

export type PhoneCheck =
  | { ok: true; phoneHash: string; phoneLast2: string }
  | { ok: false; reason: 'no_code' | 'expired' | 'wrong' | 'too_many' };

/**
 * Check a code and consume it.
 *
 * Only the newest outstanding code for this actor is considered, which is the
 * same rule sign-in follows and matters more here: somebody who mistypes their
 * number, asks again with the right one and then presents the code would
 * otherwise have two live rows and the older one would claim the wrong number.
 * Asking again supersedes; it does not accumulate.
 *
 * The answer carries the hash and the digits rather than writing them, because
 * what to do with a proved number is the route's decision — it is the thing
 * that knows about the unique index and what to say when another account
 * already holds it.
 */
export async function confirmVerification(
  db: Db,
  secret: string,
  actorId: string,
  code: string,
  now = new Date(),
): Promise<PhoneCheck> {
  const [row] = await db
    .select()
    .from(schema.phoneCodes)
    .where(and(eq(schema.phoneCodes.actorId, actorId), isNull(schema.phoneCodes.consumedAt)))
    .orderBy(desc(schema.phoneCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: 'no_code' };
  if (row.attempts >= MAX_PHONE_ATTEMPTS) return { ok: false, reason: 'too_many' };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

  const expected = hashCode(secret, actorId, code);
  const stored = Buffer.from(row.codeHash);
  const matches = stored.length === expected.length && timingSafeEqual(stored, expected);

  if (!matches) {
    await db
      .update(schema.phoneCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(schema.phoneCodes.id, row.id));
    return { ok: false, reason: 'wrong' };
  }

  await db
    .update(schema.phoneCodes)
    .set({ consumedAt: now })
    .where(eq(schema.phoneCodes.id, row.id));

  return { ok: true, phoneHash: row.phoneHash, phoneLast2: row.phoneLast2 };
}
