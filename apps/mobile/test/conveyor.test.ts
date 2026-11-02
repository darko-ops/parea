/**
 * The pull-to-refresh loader — handoff 7a, the "conveyor".
 *
 * The motion is pure and tested as numbers; the wiring is in the two tabs and
 * tested as source, the way the rest of this app's screens are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LIGHT_PALETTES,
  PALETTES,
  SPEC,
  dotsY,
  isDarkPage,
  nextPalette,
  pullingDots,
  travellingDots,
} from '../src/conveyor';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

describe('the pull', () => {
  it('shows nothing before the list moves', () => {
    expect(pullingDots(0).every((d) => d.r === 0 && d.opacity === 0)).toBe(true);
  });

  it('pops the dots in left to right', () => {
    const [a, b, c] = pullingDots(SPEC.revealPull * 0.4);
    expect(a!.r).toBeGreaterThan(b!.r);
    expect(b!.r).toBeGreaterThanOrEqual(c!.r);
  });

  it('has all three out by the reveal, at their own places, in the gap', () => {
    const dots = pullingDots(SPEC.revealPull);
    expect(dots.map((d) => d.x)).toEqual([54, 70, 86]);
    expect(dots.every((d) => d.r === SPEC.dotR && d.opacity === 1)).toBe(true);
    expect(dots[0]!.y).toBe(dotsY(SPEC.revealPull));
  });
});

describe('the load', () => {
  it('travels at 260pt a second', () => {
    const at0 = travellingDots(0, SPEC.restPull, 390);
    const at1 = travellingDots(100, SPEC.restPull, 390);
    expect(at1[0]!.x - at0[0]!.x).toBeCloseTo(26);
  });

  it('wraps on the screen width plus 80, and shrinks out at the edges rather than clipping', () => {
    const width = 390;
    const period = (width + 80) / SPEC.speed;
    expect(travellingDots(period, 76, width)[0]!.x).toBeCloseTo(travellingDots(0, 76, width)[0]!.x);
    // Off the right edge: nothing drawn.
    const off = travellingDots(((width + 35 - 54 - 40 + 40) / SPEC.speed), 76, width)[0]!;
    expect(off.r).toBeLessThan(0.01);
  });

  it('only ever bobs upward, and never merges', () => {
    for (let t = 0; t < 3000; t += 37) {
      const dots = travellingDots(t, SPEC.restPull, 390);
      for (const dot of dots) expect(dot.y).toBeLessThanOrEqual(dotsY(SPEC.restPull));
      // Sixteen points apart, except across the wrap.
      expect(Math.abs(dots[1]!.x - dots[0]!.x - 16) < 1e-6 || dots[1]!.x < dots[0]!.x).toBe(true);
    }
  });

  it('fades out on the way back', () => {
    expect(travellingDots(400, 40, 390, 1).every((d) => d.r === 0 && d.opacity === 0)).toBe(true);
  });
});

describe('the palette', () => {
  it('is never the same twice running', () => {
    let prev: number | null = null;
    for (let i = 0; i < 200; i++) {
      const next = nextPalette(prev, [0, 1, 2, 3, 4]);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it('leaves out "One accent" on a light page, where two of its dots are white', () => {
    expect(PALETTES[3]![0]).toBe('#f2f4f7');
    expect(LIGHT_PALETTES).not.toContain(3);
    expect(isDarkPage('#0d0f12')).toBe(true);
    expect(isDarkPage('#f7f8fa')).toBe(false);
  });
});

describe('where it is', () => {
  it('replaces the system spinner on Home and Chats, on iOS', () => {
    const events = read('src/Events.tsx');
    expect(events).not.toMatch(/<RefreshControl/);
    expect(events.match(/<ConveyorDots conveyor=\{pull\.conveyor\} \/>/g)).toHaveLength(2);
    expect(events.match(/\{\.\.\.pull\.scrollProps\}/g)).toHaveLength(2);
    const loader = read('src/ConveyorRefresh.tsx');
    expect(loader).toMatch(/Platform\.OS === 'ios'/);
    expect(loader).toMatch(/contentInset: \{ top: holding \? SPEC\.restPull : 0/);
  });
});
