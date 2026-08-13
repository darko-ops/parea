/**
 * What a handle may be.
 *
 * Every rule here is one someone will hit while typing, so each has a case in
 * both directions — the thing it forbids, and the nearest legal thing to it.
 */

import { describe, expect, it } from 'vitest';

import {
  generateHandle,
  HANDLE_MAX,
  HANDLE_SPACE,
  handleKey,
  handleProblem,
} from '../src/handles';

const ok = (h: string) => expect(handleProblem(h), h).toBeNull();
const bad = (h: string) => expect(handleProblem(h), h).not.toBeNull();

describe('the key a handle is unique under', () => {
  it('folds case, because nobody remembers capitalising their own name', () => {
    expect(handleKey('  SamJones ')).toBe('samjones');
  });

  it('is not what gets stored', () => {
    // The whole reason this is a separate function. `BlueChunkyMonkey` folded
    // into storage comes back unreadable, and the capitals are doing the work
    // the spaces are not allowed to do.
    expect(generateHandle(() => 0)).toMatch(/[A-Z]/);
  });
});

describe('what is allowed', () => {
  it('takes letters, numbers, underscores and full stops', () => {
    ok('sam');
    ok('sam_jones');
    ok('sam.jones');
    ok('s4m');
    ok('a1');
  });

  it('refuses spaces and everything else', () => {
    bad('sam jones');
    bad('sam-jones');
    bad('sam@jones');
    bad('sam!');
    bad('samjonés');
    bad('🙂');
  });

  it('refuses the empty and the enormous', () => {
    bad('');
    bad('a');
    ok('a'.repeat(HANDLE_MAX));
    bad('a'.repeat(HANDLE_MAX + 1));
  });

  it('will not start or end on punctuation', () => {
    // A leading dot hides a handle in some listings; a trailing one reads as
    // the end of a sentence.
    bad('.sam');
    bad('sam.');
    bad('_sam');
    bad('sam_');
    ok('s.m');
  });

  it('refuses runs of punctuation', () => {
    // `sam..jones` and `sam.jones` being different people is a way to be
    // impersonated by someone whose handle looks identical at a glance.
    bad('sam..jones');
    bad('sam__jones');
    bad('sam._jones');
    ok('sam.jo.nes');
  });

  it('keeps the words the product needs', () => {
    bad('settings');
    bad('account');
    bad('parea');
    bad('support');
    // Case-folded first, so shouting it does not get around the list.
    bad('ADMIN');
    ok('samsettings');
  });
});

describe('the handle nobody typed', () => {
  /**
   * Seeded so a failure names a real combination and names it again next run.
   *
   * mulberry32 rather than something arithmetic off the loop counter: the
   * first attempt here was `(i * 7919 + …) % 100000`, which shares factors
   * with the list lengths and walks a short cycle — 5000 draws produced 174
   * distinct handles, and the test below caught the test rather than the code.
   */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const sweep = (n: number) => {
    const random = seeded(1);
    return Array.from({ length: n }, () => generateHandle(random));
  };

  it('is three words, capitalised so they can be read apart', () => {
    // `hairytalllarry` has three `l`s in a row. The capitals are the only
    // thing separating the words, which is why they survive to storage.
    for (const handle of sweep(400)) {
      expect(handle, handle).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/);
    }
  });

  it('never generates one a person would then be forbidden from typing', () => {
    // The lists are edited by hand. A word long enough to push the total past
    // HANDLE_MAX, or a pair that happens to spell a reserved word, would be
    // caught here rather than by the one account that got it.
    for (const handle of sweep(2000)) ok(handle);
  });

  it('has a space large enough to be worth retrying in', () => {
    // `ensureHandle` gives up after a handful of tries. That is only a
    // reasonable thing to do while collisions are rare; if the lists were ever
    // trimmed to a few hundred combinations it would stop being one.
    expect(HANDLE_SPACE).toBeGreaterThan(100_000);
  });

  it('reaches both ends of every list', () => {
    // The failure this is for is an off-by-one in the index arithmetic, which
    // silently costs the last word of each list — or, one step worse, returns
    // undefined for it. Driving the edges directly says which end broke;
    // sampling only says the count looked low.
    const first = generateHandle(() => 0);
    const last = generateHandle(() => 0.999999);
    expect(first).not.toBe(last);
    for (const handle of [first, last]) {
      expect(handle, handle).not.toMatch(/undefined/);
      ok(handle);
    }
  });

  it('spreads across the space rather than favouring a corner', () => {
    const seen = new Set(sweep(5000));
    expect(seen.size).toBeGreaterThan(4000);
  });
});

describe('the message', () => {
  it('names the characters rather than saying "invalid"', () => {
    // Otherwise someone hunts through their own typing for which one.
    expect(handleProblem('sam jones')).toMatch(/spaces/);
  });

  it('says which rule, not that there was a rule', () => {
    expect(handleProblem('a')).toMatch(/at least/);
    expect(handleProblem('.sam')).toMatch(/start and end/);
    expect(handleProblem('parea')).toMatch(/reserved/);
  });
});
