/**
 * Credentials — docs/design.md §4, §5.
 *
 * Two kinds, with very different jobs:
 *   - the link token is the event's actual credential and must be
 *     unguessable;
 *   - the code is a convenience for saying an event out loud across a room,
 *     drawn from a pool small enough to be memorable and recycled when events
 *     go dormant.
 */

import { randomBytes } from 'node:crypto';

import { ADJECTIVES, NOUNS } from './words';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 22 base62 characters ≈ 131 bits. */
export const LINK_TOKEN_LENGTH = 22;

const LINK_TOKEN_RE = new RegExp(`^[A-Za-z0-9]{${LINK_TOKEN_LENGTH}}$`);

/**
 * Rejection sampling rather than `byte % 62`, which would make the first four
 * characters of the alphabet ~1.6% likelier than the rest. The bias would be
 * harmless at this length, but a biased token generator is the kind of thing
 * that gets copied into somewhere it matters.
 */
export function newLinkToken(length = LINK_TOKEN_LENGTH): string {
  const limit = 256 - (256 % BASE62.length); // 248
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out += BASE62[byte % BASE62.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Cheap shape check before hitting the database with an arbitrary path segment. */
export function isWellFormedLinkToken(value: string): boolean {
  return LINK_TOKEN_RE.test(value);
}

export const CODE_SEPARATOR = '-';

/**
 * Every pair in the pool, for seeding the `code` table.
 *
 * Same-word pairs ("cedar-cedar") are skipped: the two lists overlap on a
 * handful of nature words, and a doubled code reads like a bug.
 *
 * Superseded by `codeWordTriples` for new codes and kept because it describes
 * the shape of the ~17k codes already in the table, three of which are claimed
 * by live events and said out loud by people who were told them.
 */
export function* codeWordPairs(): Generator<string> {
  for (const adjective of ADJECTIVES) {
    for (const noun of NOUNS) {
      if (adjective === noun) continue;
      yield `${adjective}${CODE_SEPARATOR}${noun}`;
    }
  }
}

export function codePoolSize(): number {
  let overlap = 0;
  const nouns = new Set<string>(NOUNS);
  for (const adjective of ADJECTIVES) if (nouns.has(adjective)) overlap++;
  return ADJECTIVES.length * NOUNS.length - overlap;
}

/**
 * How many three-word codes to seed.
 *
 * A deliberate fraction of what the lists could produce. `adjective ×
 * adjective × noun` is 2.09 million, and seeding all of it would put two
 * million rows in a table to support a convenience feature — the pool only has
 * to comfortably exceed the number of events alive at once, and the two-word
 * pool was considered sufficient at 17k. This is six times that.
 */
export const CODE_POOL_TARGET = 100_000;

/**
 * A stride through the product space, co-prime to its size.
 *
 * The pool is a sample rather than the whole space, and *which* sample matters:
 * taking the first hundred thousand in nested-loop order would yield a pool
 * whose first word is one of the first six adjectives. Walking by a stride
 * co-prime to the total visits every index exactly once before repeating, so a
 * prefix of that walk is spread across the whole space and is still perfectly
 * reproducible — which is what keeps re-seeding idempotent.
 *
 * 2088162 = 2 · 3³ · 23 · 41²; 104729 is prime and none of those, so they share
 * no factor. Asserted in the tests rather than trusted, because the day someone
 * adds a word to either list this stops being true silently and the pool
 * quietly shrinks to a fraction of its size.
 */
const CODE_STRIDE = 104_729;

/**
 * Three-word codes, for seeding the `code` table.
 *
 * Adjective, adjective, noun — "amber-quiet-lantern" — which reads as a
 * description of a thing rather than a list of words, and that is what makes
 * an arbitrary phrase repeatable by someone who heard it once across a room.
 *
 * Repeats within one code are skipped for the same reason pairs skipped them:
 * "cedar-cedar-lantern" reads like a bug rather than a code.
 */
export function* codeWordTriples(limit = CODE_POOL_TARGET): Generator<string> {
  const a = ADJECTIVES.length;
  const n = NOUNS.length;
  const total = a * a * n;

  let made = 0;
  for (let k = 0; made < limit && k < total; k++) {
    const index = (k * CODE_STRIDE) % total;
    const first = ADJECTIVES[index % a]!;
    const second = ADJECTIVES[Math.floor(index / a) % a]!;
    const noun = NOUNS[Math.floor(index / (a * a)) % n]!;
    if (first === second || first === noun || second === noun) continue;
    made++;
    yield `${first}${CODE_SEPARATOR}${second}${CODE_SEPARATOR}${noun}`;
  }
}

/**
 * Codes are said aloud and typed by people who half-heard them, so parsing is
 * forgiving: any whitespace or dash separates the words, and case is ignored.
 *
 * Two words *and* three. New codes are three; the ones claimed before that
 * change are two, and they are written on somebody's hand. Narrowing this to
 * three would stop those events being spoken into existence with no error
 * anyone could act on — the code would simply be reported as not a code.
 */
export function normaliseCode(input: string): string | null {
  const parts = input
    .trim()
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;
  return parts.join(CODE_SEPARATOR);
}

// --- accounts ----------------------------------------------------------------

/**
 * One canonical form per address, so an account cannot be created twice.
 *
 * Case-folded and trimmed, and nothing more. The tempting extra is stripping
 * Gmail's dots and `+tags`, and it is a mistake: those rules are one
 * provider's and applying them to every domain merges addresses that are
 * genuinely different people. Someone who signs in with a different spelling
 * of their own address gets a second account, which is recoverable; someone
 * merged into a stranger's account is not.
 */
export function normaliseEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  // Deliberately loose. Address syntax is famously baroque and this is not
  // the check that matters — the code goes to the address, and an address
  // that does not exist simply never produces one.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
}

export const SIGN_IN_CODE_LENGTH = 6;

/**
 * A code someone reads off a screen and types on another device.
 *
 * Digits only, and generated from a CSPRNG with rejection sampling rather than
 * a modulo — a modulo over 10^6 from 32 random bits is very slightly biased,
 * which does not matter here and costs nothing to avoid.
 */
export function newSignInCode(): string {
  const digits: string[] = [];
  while (digits.length < SIGN_IN_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(SIGN_IN_CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= 250) continue; // 250 = 25 * 10, so the rest is unbiased
      if (digits.length < SIGN_IN_CODE_LENGTH) digits.push(String(byte % 10));
    }
  }
  return digits.join('');
}

/** Forgiving about spaces and dashes, because people paste from mail clients. */
export function normaliseSignInCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}
