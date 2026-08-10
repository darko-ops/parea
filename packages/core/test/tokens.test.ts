import { describe, expect, it } from 'vitest';

import {
  ADJECTIVES,
  NOUNS,
  codePoolSize,
  codeWordPairs,
  isWellFormedLinkToken,
  LINK_TOKEN_LENGTH,
  newLinkToken,
  normaliseCode,
} from '../src';

describe('link tokens', () => {
  it('is the documented length and alphabet', () => {
    const token = newLinkToken();
    expect(token).toHaveLength(LINK_TOKEN_LENGTH);
    expect(isWellFormedLinkToken(token)).toBe(true);
  });

  it('does not collide over a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(newLinkToken());
    expect(seen.size).toBe(20_000);
  });

  it('is not biased toward the start of the alphabet', () => {
    // Guards the rejection sampling: `byte % 62` would over-represent the
    // first 10 characters by ~1.6%, which this detects at this sample size.
    const counts = new Map<string, number>();
    const chars = 200_000;
    for (let i = 0; i < chars / LINK_TOKEN_LENGTH; i++) {
      for (const ch of newLinkToken()) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const expected = total / 62;
    for (const [ch, n] of counts) {
      expect(Math.abs(n - expected) / expected, `char ${ch}`).toBeLessThan(0.15);
    }
    expect(counts.size).toBe(62);
  });

  it('rejects malformed tokens without touching the database', () => {
    expect(isWellFormedLinkToken('')).toBe(false);
    expect(isWellFormedLinkToken('short')).toBe(false);
    expect(isWellFormedLinkToken('a'.repeat(LINK_TOKEN_LENGTH + 1))).toBe(false);
    expect(isWellFormedLinkToken(`${'a'.repeat(LINK_TOKEN_LENGTH - 1)}/`)).toBe(false);
    expect(isWellFormedLinkToken("' or 1=1 --           ")).toBe(false);
  });
});

describe('code words', () => {
  it('has no duplicates within either list', () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(NOUNS).size).toBe(NOUNS.length);
  });

  it('is all lowercase and free of separators', () => {
    // A word containing a dash or space would break `normaliseCode` round-tripping.
    for (const w of [...ADJECTIVES, ...NOUNS]) {
      expect(w, w).toMatch(/^[a-z]+$/);
    }
  });

  it('generates a pool matching the advertised size', () => {
    const pairs = [...codeWordPairs()];
    expect(pairs.length).toBe(codePoolSize());
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('never doubles a word', () => {
    for (const pair of codeWordPairs()) {
      const [a, b] = pair.split('-');
      expect(a, pair).not.toBe(b);
    }
  });

  it('is big enough to be worth having', () => {
    // Not the ~1M the design targets; large enough that recycling is the
    // constraint rather than exhaustion. See words.ts.
    expect(codePoolSize()).toBeGreaterThan(10_000);
  });

  it('every generated pair round-trips through normaliseCode', () => {
    for (const pair of codeWordPairs()) {
      expect(normaliseCode(pair)).toBe(pair);
    }
  });
});

describe('normaliseCode', () => {
  it('forgives how people actually type a code they half-heard', () => {
    for (const input of ['amber-fox', 'Amber Fox', '  AMBER   fox ', 'amber_fox', 'amber--fox']) {
      expect(normaliseCode(input), input).toBe('amber-fox');
    }
  });

  it('rejects anything that is not two words', () => {
    for (const input of ['', 'amber', 'amber fox otter', '   ', '-']) {
      expect(normaliseCode(input), JSON.stringify(input)).toBeNull();
    }
  });
});
