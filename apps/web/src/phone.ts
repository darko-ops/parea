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
 * to hold the key, and a key on ten thousand phones is a published key. Which
 * means a contact import sends numbers to this server, in the request body,
 * over TLS, and this file hashes and discards them. "Never stored" is the true
 * claim; "never sent" would not be, and the privacy page says so in those
 * words.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

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
