/**
 * What a handle may be.
 *
 * Every rule here is one someone will hit while typing, so each has a case in
 * both directions — the thing it forbids, and the nearest legal thing to it.
 */

import { describe, expect, it } from 'vitest';

import { HANDLE_MAX, handleProblem, normaliseHandle } from '../src/handles';

const ok = (h: string) => expect(handleProblem(h), h).toBeNull();
const bad = (h: string) => expect(handleProblem(h), h).not.toBeNull();

describe('normalising', () => {
  it('folds case, because nobody remembers capitalising their own name', () => {
    expect(normaliseHandle('  SamJones ')).toBe('samjones');
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
