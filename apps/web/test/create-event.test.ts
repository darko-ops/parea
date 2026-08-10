/**
 * Creating an event, and the window that comes with it — design §3, §7.3.
 *
 * The window is the interesting half. `event.starts_at` / `ends_at` have been
 * in the schema since the first migration and no client set them until the
 * native create screen existed, so this is the first code that has ever had to
 * decide what a bad one looks like.
 *
 * §17 states the asymmetry: *a wrong window is worse than no window*. Nothing
 * downstream can detect one — `resolveWindow` will happily resolve against a
 * reversed or open interval, and the only symptom is a contributor being shown
 * forty pre-ticked photos from the wrong day.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseWindow } from '../src/eventwindow';

const source = readFileSync(
  fileURLToPath(new URL('../app/api/events/route.ts', import.meta.url)),
  'utf8',
);

const START = '2026-07-18T18:00:00.000Z';
const END = '2026-07-19T03:00:00.000Z';

describe('the window a creator sends', () => {
  it('is accepted when it runs forwards', () => {
    const window = parseWindow(START, END) as { startsAt: Date; endsAt: Date };
    expect(window.startsAt.toISOString()).toBe(START);
    expect(window.endsAt.toISOString()).toBe(END);
  });

  it('is absent when neither end is given', () => {
    // "Not sure yet" is a real answer, and it must not be an error.
    expect(parseWindow(undefined, undefined)).toBeNull();
    expect(parseWindow(null, null)).toBeNull();
  });

  it('is refused when it runs backwards', () => {
    expect(parseWindow(END, START)).toBe('invalid');
  });

  it('is refused when it has no duration', () => {
    expect(parseWindow(START, START)).toBe('invalid');
  });

  it('is refused when only one end is given', () => {
    // Half a window resolves against an open interval, which is every photo
    // on the contributor's device.
    expect(parseWindow(START, undefined)).toBe('invalid');
    expect(parseWindow(undefined, END)).toBe('invalid');
  });

  it('is refused when a date is not a date', () => {
    expect(parseWindow('tonight', END)).toBe('invalid');
    expect(parseWindow(START, 12345)).toBe('invalid');
  });
});

describe('the route', () => {
  it('answers 400 rather than storing a window it cannot trust', () => {
    expect(source).toContain("error: 'invalid_window'");
    expect(source).toMatch(/status: 400/);
  });

  it('persists the validated window, not the raw body', () => {
    // The bug this guards: validating and then inserting `body.startsAt`.
    expect(source).toMatch(/startsAt: window\?\.startsAt \?\? null/);
    expect(source).toMatch(/endsAt: window\?\.endsAt \?\? null/);
    expect(source).not.toMatch(/startsAt: asDate\(body/);
  });
});
