/**
 * The app calls itself what the product is called.
 *
 * The home tab said "Events", which is the software's word for what is
 * underneath it rather than the name of the thing somebody opened. The web has
 * set `parea` in Garet at the top of every page for as long as it has had a
 * rail, and a client that names itself differently is a second product wearing
 * the same icon.
 *
 * Source checks because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP_JSON = JSON.parse(read('app.json')) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};
const WEB_CSS = read('../web/app/globals.css');

describe('the name', () => {
  it('is the product’s, not the screen’s contents', () => {
    expect(EVENTS).toMatch(/<Text style=\{\[styles\.wordmark, \{ color: t\.fg \}\]\}>Parea<\/Text>/);
    const home = EVENTS.slice(
      EVENTS.indexOf('export function HomeTab'),
      EVENTS.indexOf('export function GroupsTab'),
    );
    expect(home).not.toMatch(/>Events</);
  });

  it('is lowercased by the style, not typed that way', () => {
    /*
     * The same split the web makes: the markup says the proper noun so the
     * accessible name is "Parea", and the type says how it is drawn. Typing
     * "parea" would hand a screen reader a word it may or may not say as a
     * name.
     */
    expect(EVENTS).toMatch(/textTransform: 'lowercase'/);
    expect(WEB_CSS).toMatch(/text-transform: lowercase/);
  });
});

describe('the face it is set in', () => {
  it('is the web’s font, embedded rather than loaded', () => {
    /*
     * At build time by the config plugin, so the family is there on the first
     * frame. `useFonts` would mean a gate in front of the whole app while one
     * word's typeface arrives.
     */
    const font = APP_JSON.expo.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-font',
    );
    expect(font).toBeDefined();
    expect(font![1].fonts).toEqual(['./assets/fonts/Garet-Book.ttf']);
  });

  it('is named so that one string works on both platforms', () => {
    /*
     * iOS resolves an embedded font by its PostScript name and Android by the
     * file name, so the file is called after the PostScript name — `Garet-Book`
     * — and one `fontFamily` satisfies both.
     */
    expect(EVENTS).toMatch(/fontFamily: 'Garet-Book'/);
  });

  it('asks for no weight it does not have', () => {
    /*
     * One file, Book. Naming a weight would have the platform synthesise one by
     * thinning or smearing outlines, which at wordmark size is visible — the
     * same warning `public/fonts/README.md` gives the web.
     */
    const style = EVENTS.slice(EVENTS.indexOf('wordmark: {'), EVENTS.indexOf('wordmark: {') + 200);
    expect(style).not.toMatch(/fontWeight/);
  });
});

describe('what left the home screen with it', () => {
  it('no longer answers invitations in two places', () => {
    /*
     * The bubble held the same four asks Lately holds, with the same two
     * buttons. Answered in one and still sitting in the other reads as the
     * answer not having taken — which is the failure `activity.ts` names, and
     * the reason an answered friend request leaves the queue there.
     *
     * What replaces it is the badge on the envelope: a smaller claim, in a
     * place that is always there.
     */
    expect(EVENTS).not.toMatch(/<RequestBubble/);
    expect(EVENTS).not.toMatch(/import \{ RequestBubble \}/);
  });
});
