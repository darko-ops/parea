import { describe, expect, it } from 'vitest';

import {
  ADJECTIVES,
  NOUNS,
  codePoolSize,
  CODE_POOL_TARGET,
  codeWordPairs,
  codeWordTriples,
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

describe('the three-word pool', () => {
  const pool = [...codeWordTriples()];

  it('seeds the number it advertises, with no repeats', () => {
    expect(pool.length).toBe(CODE_POOL_TARGET);
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('walks the space instead of the front of it', () => {
    /*
     * The property the stride exists for. Nested-loop order would produce a
     * hundred thousand codes whose first word is one of the first six
     * adjectives — a pool that is technically 100k and effectively tiny to
     * anyone guessing, and which looks completely fine in a sample of ten.
     */
    const firsts = new Set(pool.map((code) => code.split('-')[0]));
    const seconds = new Set(pool.map((code) => code.split('-')[1]));
    const nouns = new Set(pool.map((code) => code.split('-')[2]));
    expect(firsts.size).toBe(ADJECTIVES.length);
    expect(seconds.size).toBe(ADJECTIVES.length);
    expect(nouns.size).toBe(NOUNS.length);
  });

  it('has a stride that is still co-prime to the space', () => {
    /*
     * The one that breaks silently. Adding a word to either list changes the
     * total, and if it ever shares a factor with the stride the walk closes
     * into a short cycle — the generator then runs out of distinct codes and
     * yields a pool a fraction of the size, with no error anywhere.
     */
    const total = ADJECTIVES.length * ADJECTIVES.length * NOUNS.length;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect(gcd(104_729, total)).toBe(1);
    expect(total).toBeGreaterThan(CODE_POOL_TARGET);
  });

  it('never repeats a word inside one code', () => {
    for (const code of pool) {
      const words = code.split('-');
      expect(new Set(words).size, code).toBe(3);
    }
  });

  it('round-trips through normaliseCode', () => {
    for (const code of pool) expect(normaliseCode(code)).toBe(code);
  });

  it('is reproducible, so re-seeding inserts nothing new', () => {
    expect([...codeWordTriples(50)]).toEqual(pool.slice(0, 50));
  });
});

describe('normaliseCode', () => {
  it('forgives how people actually type a code they half-heard', () => {
    for (const input of ['amber-fox', 'Amber Fox', '  AMBER   fox ', 'amber_fox', 'amber--fox']) {
      expect(normaliseCode(input), input).toBe('amber-fox');
    }
  });

  it('takes three words as well as two', () => {
    // New codes are three words; the ones claimed before that change are two
    // and are written on somebody's hand. Refusing either would report a real
    // code as not a code.
    expect(normaliseCode('Amber Quiet Lantern')).toBe('amber-quiet-lantern');
    expect(normaliseCode('amber_quiet-lantern')).toBe('amber-quiet-lantern');
  });

  it('rejects anything that is not two or three words', () => {
    for (const input of ['', 'amber', 'amber fox otter badger', '   ', '-']) {
      expect(normaliseCode(input), JSON.stringify(input)).toBeNull();
    }
  });
});
