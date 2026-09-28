/**
 * Moments: a row of squares on Home, opened in the roll's own viewer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const MOMENTS = read('src/Moments.tsx');
const VIEWER = read('src/PhotoViewer.tsx');
const EVENTS = read('src/Events.tsx');
const API = read('src/api.ts');
const APP = read('App.tsx');

describe('moments', () => {
  it('opens in the same viewer a roll photograph opens in, without the roll', () => {
    expect(MOMENTS).toMatch(/<PhotoViewer\s+plain/);
    expect(VIEWER).toMatch(/plain = false/);
    // The star, the reactions and the comments are a roll's, not a moment's.
    expect(VIEWER).toMatch(/\{!plain && \(\s*<Pressable\s+onPress=\{\(\) => void keep/);
    expect(VIEWER).toMatch(/\{!plain && \(\s*<View style=\{styles\.said\}/);
    expect(VIEWER).toMatch(/\{talking && !plain && \(/);
  });

  it('draws people as rounded squares, not circles', () => {
    expect(MOMENTS).toMatch(/face: \{\s*width: 56,\s*height: 56,\s*borderRadius: 16/);
  });

  it('sits on Home, under the head', () => {
    expect(EVENTS).toMatch(/<MomentsRow people=\{moments\.people\}/);
    expect(EVENTS).toMatch(/onMoment=\{onCreateMoment\}/);
  });

  it('adds one on its own screen, shown before it is shared', () => {
    /*
     * The sheet's Moment used to launch the picker from the sheet, which iOS
     * refuses while the sheet is still dismissing — so the choice did nothing.
     * It opens a route now, and only Share there sends anything.
     */
    expect(APP).toMatch(/onCreateMoment=\{\(\) => setRoute\(\{ screen: 'moment' \}\)\}/);
    expect(APP).toMatch(/route\.screen === 'moment' && \(/);
    expect(MOMENTS).toMatch(/export function AddMoment/);
    expect(MOMENTS).toMatch(/accessibilityLabel="Share this moment"\s+disabled=\{!uri \|\| sharing\}/);
    expect(MOMENTS).not.toMatch(/export async function postMoment/);
  });

  it('posts raw bytes like an avatar, and blocks by moment', () => {
    expect(API).toMatch(/url: `\$\{this\.baseUrl\}\/api\/moments`/);
    expect(API).toMatch(/JSON\.stringify\(\{ momentId \}\)/);
  });
});
