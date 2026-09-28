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
const FIELD = read('src/IconField.tsx');
const PERSON = read('src/Person.tsx');
const PROFILE = read('src/Profile.tsx');

describe('moments', () => {
  it('opens in the same viewer a roll photograph opens in, without the roll', () => {
    expect(MOMENTS).toMatch(/<PhotoViewer\s+plain/);
    expect(VIEWER).toMatch(/plain = false/);
    // The star, the reactions and the comments are a roll's, not a moment's.
    expect(VIEWER).toMatch(/\{!plain && \(\s*<Pressable\s+onPress=\{\(\) => void keep/);
    expect(VIEWER).toMatch(/\{!plain && \(\s*<View style=\{styles\.said\}/);
    expect(VIEWER).toMatch(/\{talking && !plain && \(/);
  });

  it('is one stream on Home, one tile per moment, in the server’s order', () => {
    // Not a square per person: the strip maps the stream as it arrives and
    // never sorts it — the order is `orderStream` on the server.
    expect(EVENTS).toMatch(/<MomentsRow moments=\{moments\.moments\}/);
    expect(EVENTS).toMatch(/onMoment=\{onCreateMoment\}/);
    expect(MOMENTS).toMatch(/\{moments\.map\(\(moment\) => \(\s*<MomentTile key=\{moment\.id\}/);
    expect(MOMENTS).not.toMatch(/\.sort\(/);
    expect(API).toMatch(/export type MomentsResponse = \{ moments: Moment\[\] \};/);
  });

  it('draws the photograph, with its author as a badge on the corner', () => {
    expect(MOMENTS).toMatch(/source=\{\{ uri: moment\.thumb \}\}/);
    expect(MOMENTS).toMatch(/source=\{\{ uri: moment\.author\.avatar \}\}/);
    expect(MOMENTS).toMatch(/right: -BADGE_HANG,\s*bottom: -BADGE_HANG,/);
  });

  it('rings the unseen in the app icon’s field, and the seen in a hairline', () => {
    expect(MOMENTS).toMatch(
      /moment\.seen \? \(\s*<IconRing size=\{RING\} radius=\{RING_RADIUS\} thickness=\{SEEN_LINE\} color=\{t\.line\} \/>\s*\) : \(\s*<IconRing size=\{RING\} radius=\{RING_RADIUS\} thickness=\{RING_LINE\} \/>/,
    );
  });

  it('draws the ring’s rounded corners itself rather than trusting a clip', () => {
    /*
     * The corners were cut: the ring was the icon's square field, rounded only
     * by its parent's `overflow: hidden`, and an SVG is its own native view.
     * The ring is a path now, the inner square taken out by the even-odd rule.
     */
    expect(FIELD).toMatch(/export function IconRing/);
    expect(FIELD).toMatch(/<Path d=\{d\} fillRule="evenodd" fill=\{color \?\? GLASS_BASE\} \/>/);
    expect(MOMENTS).not.toMatch(/<IconField \/>/);
    // And the scroll view, which clips at its bounds, keeps every tile and
    // badge inside padding rather than against that edge.
    expect(MOMENTS).toMatch(/const ROW_PAD = BADGE_HANG \+ 3;/);
    expect(MOMENTS).toMatch(/row: \{ gap: 12, padding: ROW_PAD \}/);
  });

  it('sits close above the rolls rather than a card’s gap away', () => {
    expect(MOMENTS).toMatch(/marginBottom: -24,/);
  });

  it('marks a moment seen once it is on screen, and draws it seen at once', () => {
    expect(API).toMatch(/markMomentSeen\(id: string\)/);
    expect(API).toMatch(/`\/api\/moments\/\$\{id\}\/seen`/);
    expect(MOMENTS).toMatch(/onSeen\(seenId\);\s*api\.markMomentSeen\(seenId\)/);
    expect(MOMENTS).toMatch(/opened\.has\(m\.id\) \? \{ \.\.\.m, seen: true \} : m/);
  });

  it('shows a person’s moments on their page, and yours on yours', () => {
    expect(API).toMatch(/\/api\/moments\?by=\$\{encodeURIComponent\(handle\)\}/);
    expect(PERSON).toMatch(/const moments = useMoments\(api, handle\);/);
    expect(PERSON).toMatch(/<MomentsRow\s+moments=\{moments\.moments\}/);
    expect(PROFILE).toMatch(/stream\.moments\.filter\(\(m\) => m\.mine\)/);
    expect(PROFILE).toMatch(/<MomentsRow moments=\{mine\}/);
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

  it('puts the original straight to storage, and blocks by moment', () => {
    // A request body to the server is capped at about 4.5MB; a phone
    // photograph is larger, so the bytes never go through it.
    expect(API).toMatch(/this\.call\('\/api\/moments\/uploads'/);
    expect(API).toMatch(/JSON\.stringify\(\{ key \}\)/);
    expect(MOMENTS).toMatch(/await putToStorage\(slot\.url, slot\.headers, picked\.uri\)/);
    expect(MOMENTS).not.toMatch(/uploadCover/);
    expect(API).toMatch(/JSON\.stringify\(\{ momentId \}\)/);
  });
});
