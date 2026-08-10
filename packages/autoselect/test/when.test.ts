/**
 * The window a creator picks — design §7.3.
 *
 * Worth testing carefully for a reason that is not obvious from the size of
 * the module: this is the only input auto-selection has that a human chose.
 * Everything else it works from is inferred, and §17 records the asymmetry —
 * *a wrong window is worse than no window*, because a wrong one pre-ticks the
 * wrong photos and spends the photo-library permission and the contributor's
 * trust in the same moment.
 *
 * So the cases here are the ones where a plausible implementation is quietly
 * wrong by hours: a night that runs past midnight, a night at the end of a
 * month, and the difference between the day an event is filed under and the
 * hours its photos came from.
 */

import { describe, expect, it } from 'vitest';

import { WHEN_OPTIONS, eventDateFor, windowFor } from '../src/index';

/** A Saturday night, 22:40 local — someone creating the event mid-party. */
const MID_PARTY = new Date(2026, 6, 18, 22, 40);
const local = (iso: string) => new Date(iso);

describe('tonight', () => {
  it('starts this evening and ends in the early hours of tomorrow', () => {
    const window = windowFor('tonight', MID_PARTY)!;
    expect(local(window.startsAt).getDate()).toBe(18);
    expect(local(window.startsAt).getHours()).toBe(18);
    // The part a naive implementation gets wrong: a night is not a calendar
    // day, and photos from 1am belong to the party that started at 8pm.
    expect(local(window.endsAt).getDate()).toBe(19);
    expect(local(window.endsAt).getHours()).toBe(4);
  });

  it('contains the moment it was created', () => {
    // If it does not, the creator's own photos fall outside their own window.
    const window = windowFor('tonight', MID_PARTY)!;
    expect(local(window.startsAt).getTime()).toBeLessThanOrEqual(MID_PARTY.getTime());
    expect(local(window.endsAt).getTime()).toBeGreaterThan(MID_PARTY.getTime());
  });

  it('crosses a month boundary without landing in the wrong month', () => {
    const window = windowFor('tonight', new Date(2026, 6, 31, 21, 0))!;
    expect(local(window.endsAt).getMonth()).toBe(7);
    expect(local(window.endsAt).getDate()).toBe(1);
  });

  it('crosses a year boundary', () => {
    const window = windowFor('tonight', new Date(2026, 11, 31, 23, 0))!;
    expect(local(window.endsAt).getFullYear()).toBe(2027);
    expect(local(window.endsAt).getMonth()).toBe(0);
    expect(local(window.endsAt).getDate()).toBe(1);
  });
});

describe('last night', () => {
  it('runs from yesterday evening to this morning', () => {
    // The morning-after case: someone makes the event while clearing up.
    const morning = new Date(2026, 6, 19, 10, 15);
    const window = windowFor('last-night', morning)!;
    expect(local(window.startsAt).getDate()).toBe(18);
    expect(local(window.startsAt).getHours()).toBe(18);
    expect(local(window.endsAt).getDate()).toBe(19);
    expect(local(window.endsAt).getHours()).toBe(4);
  });

  it('does not include the morning it is being created in', () => {
    // Photos taken over breakfast are not photos from the party.
    const morning = new Date(2026, 6, 19, 10, 15);
    const window = windowFor('last-night', morning)!;
    expect(local(window.endsAt).getTime()).toBeLessThan(morning.getTime());
  });

  it('crosses a month boundary backwards', () => {
    const window = windowFor('last-night', new Date(2026, 7, 1, 9, 0))!;
    expect(local(window.startsAt).getMonth()).toBe(6);
    expect(local(window.startsAt).getDate()).toBe(31);
  });
});

describe('whole days', () => {
  it('covers today from midnight to midnight', () => {
    const window = windowFor('today', MID_PARTY)!;
    expect(local(window.startsAt).getHours()).toBe(0);
    expect(local(window.endsAt).getHours()).toBe(23);
    expect(local(window.startsAt).getDate()).toBe(18);
    expect(local(window.endsAt).getDate()).toBe(18);
  });

  it('covers yesterday, and stops there', () => {
    const window = windowFor('yesterday', MID_PARTY)!;
    expect(local(window.startsAt).getDate()).toBe(17);
    expect(local(window.endsAt).getDate()).toBe(17);
    expect(local(window.endsAt).getTime()).toBeLessThan(MID_PARTY.getTime());
  });
});

describe('not sure', () => {
  it('is a real answer, and produces no window at all', () => {
    // Not a failure to answer. With no window the app opens the system picker
    // and nothing is pre-selected, which §7.3 calls a good outcome — and it is
    // strictly better than a guess, which is the bad one.
    expect(windowFor('unsure', MID_PARTY)).toBeNull();
    expect(eventDateFor('unsure', MID_PARTY)).toBeNull();
  });

  it('is offered, rather than only reachable by skipping the question', () => {
    expect(WHEN_OPTIONS.map((o) => o.id)).toContain('unsure');
  });
});

describe('the choices themselves', () => {
  it('every one produces a window that runs forwards', () => {
    for (const option of WHEN_OPTIONS) {
      const window = windowFor(option.id, MID_PARTY);
      if (!window) continue;
      expect(
        local(window.endsAt).getTime() - local(window.startsAt).getTime(),
        option.id,
      ).toBeGreaterThan(0);
    }
  });

  it('none is longer than a day and a bit', () => {
    // A window wide enough to catch a whole weekend catches the wrong photos,
    // which is the failure this is all guarding against.
    for (const option of WHEN_OPTIONS) {
      const window = windowFor(option.id, MID_PARTY);
      if (!window) continue;
      const hours =
        (local(window.endsAt).getTime() - local(window.startsAt).getTime()) / 3600_000;
      expect(hours, option.id).toBeLessThanOrEqual(24);
    }
  });

  it('spells out the two that run past midnight', () => {
    // "Today" explains itself; "Tonight" does not, and someone who reads it
    // as "until midnight" will believe the 1am photos were left out.
    for (const id of ['tonight', 'last-night'] as const) {
      const hint = WHEN_OPTIONS.find((o) => o.id === id)!.hint;
      expect(hint, id).toMatch(/hours|morning/);
    }
  });

  it('gives every choice a distinct hint', () => {
    const hints = WHEN_OPTIONS.map((o) => o.hint);
    expect(hints.every((h) => h.length > 0)).toBe(true);
    // 'all day' under both Today and Yesterday would be fine; identical hints
    // on options that mean different things would not.
    expect(new Set(WHEN_OPTIONS.map((o) => `${o.label}:${o.hint}`)).size).toBe(
      WHEN_OPTIONS.length,
    );
  });
});

describe('the date an event is filed under', () => {
  it('is the day it started, not the day it ended', () => {
    // A party running past midnight is still Saturday's party.
    expect(eventDateFor('tonight', MID_PARTY)).toBe('2026-07-18');
  });

  it('is yesterday for a morning-after creation', () => {
    expect(eventDateFor('last-night', new Date(2026, 6, 19, 10, 15))).toBe('2026-07-18');
  });

  it('is zero-padded, because the column is a date and the wire is a string', () => {
    expect(eventDateFor('today', new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});
