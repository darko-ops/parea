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

  it('is one bar on Home: no names, no faces, no pictures', () => {
    // Moments are one collective stream, so Home says only that there are
    // moments and how many are new; who posted what is found out inside.
    expect(EVENTS).toMatch(/<MomentsBar moments=\{moments\.moments\}/);
    expect(EVENTS).not.toMatch(/<MomentsRow/);
    const BAR = MOMENTS.slice(
      MOMENTS.indexOf('export function MomentsBar'),
      MOMENTS.indexOf('export function MomentsRow'),
    );
    expect(BAR).not.toMatch(/author|thumb|ExpoImage|IconRing|MomentTile/);
    // The status on the right, and the chevron after it.
    expect(BAR).toMatch(/\{news\} new<\/Text>\}\s*<Text style=\{\[styles\.barChevron, \{ color: look\.quiet \}\]\}>›<\/Text>/);
    // Follows the app's look: the web's light card on light, glass on dark.
    expect(BAR).toMatch(/const look = scheme === 'light' \? BAR_LIGHT : BAR_DARK;/);
    // Faded out towards the left by a mask, never ending in a hard edge.
    expect(MOMENTS).toMatch(/<G mask=\{`url\(#\$\{id\}mask\)`\}>/);
    expect(MOMENTS).toMatch(/<Stop offset="0\.25" stopColor="#fff" stopOpacity=\{0\} \/>\s*<Stop offset="0\.65" stopColor="#fff" stopOpacity=\{1\} \/>/);
    // Colour through frosted glass always: faint and still when caught up,
    // brighter and drifting while something is new.
    expect(BAR).toMatch(/<Bloom lively=\{news > 0\} look=\{look\} \/>/);
    expect(BAR).toMatch(/opacity: lively \? 1 : look\.quietGlow,/);
    expect(BAR).toMatch(/if \(!lively\) \{\s*drift\.setValue\(0\);\s*return;/);
    expect(BAR).toMatch(/<BlurView intensity=\{40\} tint=\{look\.tint\}/);
    // The drift is off for anybody who has asked for less motion.
    expect(BAR).toMatch(/isReduceMotionEnabled\(\)\.then\(\(still\) => \{\s*if \(still \|\| cancelled\) return;/);
    // And it opens on the first one new to you, in the stream's order.
    expect(BAR).toMatch(/const fresh = moments\.filter\(\(m\) => !m\.seen && !m\.mine\);/);
    expect(BAR).toMatch(/\(fresh\[0\] \?\? moments\[0\]\)!\.id/);
    expect(BAR).toMatch(/if \(moments\.length === 0\) return null;/);
  });

  it('walks the stream inside the viewer with the tiles across the top', () => {
    // The same tiles, as a position: the one on screen marked, pressing one
    // jumps there, and the pager follows an index it did not set itself.
    expect(MOMENTS).toMatch(/<MomentsNav moments=\{moments\} at=\{at\} t=\{t\} onJump=\{setIndex\} \/>/);
    expect(MOMENTS).toMatch(/active=\{i === at\}/);
    expect(MOMENTS).toMatch(/onPress=\{\(\) => onJump\(i\)\}/);
    expect(MOMENTS).toMatch(/opacity: pressed \? 0\.5 : faded \? 0\.55 : 1/);
    expect(VIEWER).toMatch(/strip\?: React\.ReactNode;/);
    expect(VIEWER).toMatch(/pager\.current\?\.scrollToOffset\(\{ offset: index \* width, animated: false \}\)/);
  });

  it('keeps one tile per moment, in the server’s order, wherever tiles are drawn', () => {
    // The strip maps the stream as it arrives and never sorts it — the order
    // is `orderStream` on the server.
    expect(EVENTS).toMatch(/onMoment=\{onCreateMoment\}/);
    expect(MOMENTS).toMatch(/\{moments\.map\(\(moment\) => \(\s*<MomentTile\s+key=\{moment\.id\}/);
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
      /moment\.seen \? \(\s*<IconRing size=\{RING\} radius=\{RING_RADIUS\} thickness=\{SEEN_LINE\} color=\{hairline\} \/>\s*\) : \(\s*<IconRing size=\{RING\} radius=\{RING_RADIUS\} thickness=\{RING_LINE\} \/>/,
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

  it('shows only the photographs on a profile, without the face or the name', () => {
    // Somebody on a person's page already knows whose these are. The viewer's
    // strip still says who; the profile's row does not.
    expect(MOMENTS).toMatch(/onPress=\{\(\) => onOpen\(moment\.id\)\}\s*plain\s*\/>/);
    expect(MOMENTS).toMatch(/\{!plain && \(\s*<View style=\{\[styles\.badge,/);
    expect(MOMENTS).toMatch(/\{!plain && \(\s*<Text style=\{\[styles\.name,/);
  });

  it('lets Settings choose light or dark, dark unless somebody picks light', () => {
    const APPEARANCE = read('src/appearance.ts');
    expect(APPEARANCE).toMatch(/export const DEFAULT_LOOK: Look = 'dark';/);
    // Dark before the stored choice is read, so the first frame is dark.
    expect(APPEARANCE).toMatch(/let current: Look = DEFAULT_LOOK;/);
    expect(APPEARANCE).toMatch(/Appearance\.setColorScheme\(look\)/);
    // Screens ask the app's choice, never the system's scheme.
    for (const file of ['App.tsx', 'src/Events.tsx', 'src/Waiting.tsx', 'src/Moments.tsx']) {
      expect(read(file)).not.toMatch(/useColorScheme\(/);
    }
    expect(read('src/Profile.tsx')).toMatch(/<AppearanceChoice t=\{t\} \/>/);
    expect(APP).toMatch(/void loadAppearance\(\);/);
  });
});
