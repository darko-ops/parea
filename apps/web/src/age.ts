/**
 * The age check at sign-up.
 *
 * The terms say 13 and over, and nothing asked. This asks once, when an email
 * address is first used to make an account, and in the neutral form the FTC
 * describes for COPPA: a date of birth, with nothing on the screen that says
 * what the cutoff is, rather than a box reading "I am 13 or older" that
 * answers its own question.
 *
 * The date is used to decide and then dropped. The account keeps only when the
 * check passed (`age_confirmed_at`); a date of birth held for no further
 * purpose would be one more thing to protect and to have to justify.
 *
 * Asked after the code, not before: the server must not say whether an address
 * already has an account, so it cannot know to ask until somebody has proved
 * the address — and then it hands back a short-lived proof so they are not
 * sent for a second code while they type a date.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The youngest a person may be to make an account. The terms say so. */
export const MINIMUM_AGE = 13;

/** How long a proven address may wait for its date of birth. */
const PROOF_MS = 10 * 60 * 1000;

/**
 * Whole years old on `now`, from `YYYY-MM-DD`. Null for anything that is not a
 * real date, is in the future, or is older than anyone alive.
 */
export function ageOn(birthDate: unknown, now = new Date()): number | null {
  if (typeof birthDate !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const born = new Date(Date.UTC(year, month - 1, day));
  // A date that rolled over — 31 February — is not a date anybody was born on.
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) {
    return null;
  }
  if (born.getTime() > now.getTime()) return null;

  let age = now.getUTCFullYear() - year;
  const birthdayThisYear =
    now.getUTCMonth() > month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!birthdayThisYear) age -= 1;
  return age > 130 ? null : age;
}

const sign = (secret: string, email: string, expires: number) =>
  createHmac('sha256', secret).update(`age-proof|${email}|${expires}`).digest('hex');

/**
 * Proof that this address was just verified, for the second request that
 * carries the date of birth. Bound to the address and to ten minutes.
 */
export function ageProof(secret: string, email: string, now = new Date()): string {
  const expires = now.getTime() + PROOF_MS;
  return `${expires}.${sign(secret, email, expires)}`;
}

export function checkAgeProof(
  secret: string,
  email: string,
  proof: unknown,
  now = new Date(),
): boolean {
  if (typeof proof !== 'string') return false;
  const [expiresText, given] = proof.split('.');
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now.getTime() || !given) return false;
  const expected = Buffer.from(sign(secret, email, expires));
  const presented = Buffer.from(given);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
