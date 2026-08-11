/**
 * The line under an event's name, and how long ago it was.
 *
 * Both are small and both are the kind of thing that is wrong for months
 * without anyone filing it: a relative time that rounds the wrong way, or a
 * meta line that says the same fact twice.
 */

import { describe, expect, it } from 'vitest';

import { ago, metaFor } from '../src/cards';

const NOW = new Date('2026-08-11T21:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('ago', () => {
  it.each([
    [0, 'just now'],
    [1, '1m ago'],
    [20, '20m ago'],
    [59, '59m ago'],
    [60, '1h ago'],
    [60 * 23, '23h ago'],
    [60 * 24, '1 day ago'],
    [60 * 24 * 6, '6 days ago'],
    [60 * 24 * 7, '1 week ago'],
    [60 * 24 * 30, '4 weeks ago'],
    [60 * 24 * 60, '2 months ago'],
  ])('describes %i minutes as "%s"', (mins, expected) => {
    expect(ago(minutesAgo(mins), NOW)).toBe(expected);
  });

  it('rounds down rather than up', () => {
    // "an hour ago" for something 35 minutes old invites someone to think
    // they missed more than they did.
    expect(ago(minutesAgo(35), NOW)).toBe('35m ago');
    expect(ago(minutesAgo(119), NOW)).toBe('1h ago');
  });

  it('does not go backwards for a clock skewed into the future', () => {
    // Timestamps come from the server and `now` from the browser, so this
    // happens. "-3m ago" is worse than a small lie.
    expect(ago(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now');
  });
});

describe('metaFor', () => {
  const base = { memberCount: 6, place: null, lastActiveAt: minutesAgo(20).toISOString() };

  it('leads with the people, because that is the recruiting fact', () => {
    expect(metaFor(base, { newest: true, now: NOW })).toBe('6 people · added to 20m ago');
  });

  it('says recency on the newest even when it has a place', () => {
    // At the top of the list, "added to 20m ago" is what makes someone open
    // it; further down, where tells events apart better than when.
    const withPlace = { ...base, place: 'The Flat' };
    expect(metaFor(withPlace, { newest: true, now: NOW })).toContain('20m ago');
    expect(metaFor(withPlace, { newest: false, now: NOW })).toBe('6 people · The Flat');
  });

  it('falls back to recency when there is no place', () => {
    expect(metaFor(base, { newest: false, now: NOW })).toBe('6 people · added to 20m ago');
  });

  it('never repeats the photo count', () => {
    // It is already the large number on the right of the same row. Saying it
    // twice in one card is what makes a design feel like a form.
    expect(metaFor({ ...base, place: 'Hvar' }, { newest: false, now: NOW })).not.toMatch(
      /photo/,
    );
  });

  it('says person for one', () => {
    expect(metaFor({ ...base, memberCount: 1 }, { newest: false, now: NOW })).toMatch(
      /^1 person /,
    );
  });
});
