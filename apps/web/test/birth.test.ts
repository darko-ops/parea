/**
 * The age screen asks for a year, and the month or day only when the year
 * cannot settle it. See `@/birth`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { birthFieldsNeeded, birthValue, checkBirth } from '@/birth';

// 7 October 2026, so the borderline year is 2013 and the month is October.
const on = new Date(Date.UTC(2026, 9, 7, 12));

describe('the year someone was born', () => {
  it('settles it on its own for everybody not born exactly thirteen years ago', () => {
    expect(checkBirth('2012', on)).toEqual({ ok: true });
    expect(checkBirth('1990', on)).toEqual({ ok: true });
    expect(checkBirth('2014', on)).toEqual({ ok: false, reason: 'too_young' });
    expect(birthFieldsNeeded('2012', '', on)).toEqual({ month: false, day: false });
    expect(birthValue('2012', '', '', on)).toBe('2012');
  });

  it('asks the month in the year that could go either way', () => {
    expect(checkBirth('2013', on)).toEqual({ ok: false, reason: 'need_month' });
    expect(birthFieldsNeeded('2013', '', on)).toEqual({ month: true, day: false });
    expect(birthValue('2013', '', '', on)).toBe('');
    expect(checkBirth('2013-09', on)).toEqual({ ok: true });
    expect(checkBirth('2013-11', on)).toEqual({ ok: false, reason: 'too_young' });
    expect(birthValue('2013', '9', '', on)).toBe('2013-09');
  });

  it('and the day only when that month is this one', () => {
    expect(checkBirth('2013-10', on)).toEqual({ ok: false, reason: 'need_day' });
    expect(birthFieldsNeeded('2013', '10', on)).toEqual({ month: true, day: true });
    expect(checkBirth('2013-10-07', on)).toEqual({ ok: true });
    expect(checkBirth('2013-10-08', on)).toEqual({ ok: false, reason: 'too_young' });
    expect(birthValue('2013', '10', '7', on)).toBe('2013-10-07');
  });

  it('still answers a full date, which older app builds send', () => {
    expect(checkBirth('2000-01-01', on)).toEqual({ ok: true });
    expect(checkBirth('2015-06-01', on)).toEqual({ ok: false, reason: 'too_young' });
  });

  it('refuses what is not a birth year', () => {
    for (const bad of ['2030', '1800', '13/09/2013', '2013-13', '2013-02-31', '', undefined, 2013]) {
      expect(checkBirth(bad, on), String(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('is the same rule in the app', () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    expect(read('../../mobile/src/birth.ts')).toBe(read('../src/birth.ts'));
  });
});
