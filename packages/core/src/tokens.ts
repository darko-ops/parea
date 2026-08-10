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
 * Codes are said aloud and typed by people who half-heard them, so parsing is
 * forgiving: any whitespace or dash separates the words, and case is ignored.
 */
export function normaliseCode(input: string): string | null {
  const parts = input
    .trim()
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return parts.join(CODE_SEPARATOR);
}
