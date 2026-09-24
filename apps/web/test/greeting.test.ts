/**
 * The greeting, and the clock it reads.
 *
 * It was the server's clock, which in the deployment is UTC, and it told
 * somebody in California good afternoon at five in the morning. The instant
 * below is exactly that: one moment, three true answers, depending only on
 * where the reader is standing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { greetingFor, hourIn, partOfDay } from '@/greeting';
import { isZone } from '@/zoneCookie';

/** 12:30 UTC. Morning in Los Angeles, afternoon in London, evening in Tokyo. */
const NOON_UTC = new Date('2026-08-13T12:30:00Z');

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('greetingFor', () => {
  it('reads the hour where the reader is, not where the server is', () => {
    expect(greetingFor('Nadia Aziz', NOON_UTC, 'America/Los_Angeles')).toBe('Morning, Nadia');
    expect(greetingFor('Nadia Aziz', NOON_UTC, 'Europe/London')).toBe('Afternoon, Nadia');
    expect(greetingFor('Nadia Aziz', NOON_UTC, 'Asia/Tokyo')).toBe('Evening, Nadia');
  });

  it('still says nothing at all when it does not know the name', () => {
    expect(greetingFor(null, NOON_UTC, 'Europe/London')).toBeNull();
    expect(greetingFor('   ', NOON_UTC, 'Europe/London')).toBeNull();
  });

  it('falls back to the server clock rather than throwing on a bad zone', () => {
    // The zone arrives from a cookie, which is to say from the request. A
    // greeting is not worth a 500 on the page somebody opened.
    const local = greetingFor('Nadia', NOON_UTC, null);
    expect(greetingFor('Nadia', NOON_UTC, 'Mars/Olympus')).toBe(local);
    expect(greetingFor('Nadia', NOON_UTC, '')).toBe(local);
  });
});

describe('hourIn', () => {
  it('answers 0 at midnight, not 24', () => {
    /*
     * The bug `formatToParts` and `hourCycle: 'h23'` are here to avoid. With
     * `hour12: false` several locales word midnight as "24", which the
     * boundaries in `partOfDay` would read as the evening of the day before —
     * a greeting that says "Evening" for the whole of the small hours.
     */
    const midnightInTokyo = new Date('2026-08-13T15:00:00Z');
    expect(hourIn(midnightInTokyo, 'Asia/Tokyo')).toBe(0);
    expect(partOfDay(midnightInTokyo, 'Asia/Tokyo')).toBe('Morning');
  });

  it('crosses the boundaries where it says it does', () => {
    const at = (iso: string) => partOfDay(new Date(iso), 'UTC');
    expect(at('2026-08-13T11:59:00Z')).toBe('Morning');
    expect(at('2026-08-13T12:00:00Z')).toBe('Afternoon');
    expect(at('2026-08-13T17:59:00Z')).toBe('Afternoon');
    expect(at('2026-08-13T18:00:00Z')).toBe('Evening');
  });

  it('follows the offset the date actually has, not a fixed one', () => {
    // Why a zone rather than a stored number of minutes: the same place is a
    // different offset in August and in January, and a number recorded once is
    // wrong for half the year.
    expect(hourIn(new Date('2026-08-13T12:30:00Z'), 'Europe/London')).toBe(13);
    expect(hourIn(new Date('2026-01-13T12:30:00Z'), 'Europe/London')).toBe(12);
  });
});

describe('isZone', () => {
  it('takes what Intl takes and refuses the rest', () => {
    expect(isZone('America/Los_Angeles')).toBe(true);
    expect(isZone('UTC')).toBe(true);
    expect(isZone('Foo/Bar')).toBe(false);
    expect(isZone(null)).toBe(false);
    expect(isZone('A'.repeat(200))).toBe(false);
  });
});

describe('the pages that greet', () => {
  /*
   * The regression is not a wrong string, it is a page that stopped asking.
   * `greetingFor` defaults the zone to null so the old two-argument call still
   * compiles, which is what makes this worth asserting rather than trusting
   * the type checker: a page reverted to `greetingFor(name, now)` is the exact
   * bug, back, silently.
   */
  const PAGES = ['activity', 'events', 'find', 'groups'];

  it.each(PAGES)('%s reads the reader zone and hands it to the greeting', (page) => {
    const source = read(`../app/${page}/page.tsx`);
    expect(source).toMatch(/const zone = await readerZone\(\);/);
    expect(source).toMatch(/greetingFor\([^)]*, now, zone\)/);
  });

  it.each(PAGES)('%s tells the shell what time of day it claimed', (page) => {
    // Without this the browser cannot tell whether the words it is looking at
    // are the wrong ones, and a reader behind a VPN keeps the edge's guess
    // until they navigate. See `ReaderZone`.
    expect(read(`../app/${page}/page.tsx`)).toMatch(/at=\{partOfDay\(now, zone\)\}/);
  });
});
