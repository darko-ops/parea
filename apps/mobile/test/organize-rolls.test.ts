/**
 * Organize Rolls — holding a roll on your profile to rearrange the shelf.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { moveTo, slotAt } from '../src/shelfGrid';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

describe('the grid', () => {
  // A 171pt tile with a 10pt gap, and a 198pt row: the design's numbers.
  const at = (x: number, y: number, count = 8) => slotAt(x, y, 181, 198, count);

  it('finds the nearest slot, two across', () => {
    expect(at(0, 0)).toBe(0);
    expect(at(181, 0)).toBe(1);
    expect(at(0, 198)).toBe(2);
    expect(at(170, 420)).toBe(5);
  });

  it('never goes past the shelf', () => {
    expect(at(-400, -400)).toBe(0);
    expect(at(900, 9000)).toBe(7);
    // An odd shelf has no slot to the right of its last tile.
    expect(at(181, 198 * 2, 5)).toBe(4);
  });

  it('moves one roll and leaves the others in order', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('the profile', () => {
  const PROFILE = read('src/Profile.tsx');
  const SHELF = read('src/Shelf.tsx');

  it('opens the menu on a 320ms hold, offering Organize Rolls', () => {
    expect(PROFILE).toMatch(/onLongPress=\{\(\) => setHeld\(event\)\}\s*delayLongPress=\{320\}/);
    expect(PROFILE).toMatch(/>Organize Rolls</);
    expect(PROFILE).toMatch(/Drag them into the order you want them on your shelf\./);
  });

  it('swaps the + for Done while organizing, and saves the order on it', () => {
    expect(PROFILE).toMatch(/\{organizing \? \(/);
    expect(PROFILE).toMatch(/>Done</);
    expect(PROFILE).toMatch(/await api\.saveShelf\(arranged\);\s*await onShelfChanged\(\);/);
    expect(read('src/api.ts')).toMatch(/'\/api\/account\/shelf', \{ method: 'PUT'/);
  });

  it('holds the page still while a tile is in hand', () => {
    expect(PROFILE).toMatch(/scrollEnabled=\{!dragging\}/);
    expect(SHELF).toMatch(/onPanResponderTerminationRequest: \(\) => false/);
  });

  it('breathes each tile on its own cadence, as the design has them', () => {
    expect(SHELF).toMatch(/const DUR = \[3\.6, 4\.4, 3\.1, 4\.9, 3\.9, 2\.9, 4\.6, 3\.4\];/);
    expect(SHELF).toMatch(/const BREATH = 0\.025;/);
    expect(SHELF).toMatch(/Easing\.bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  });

  it('sorts the shelf as its owner arranged it', () => {
    expect(PROFILE).toMatch(/const sorted = shelfOrder\(events\);/);
  });
});
