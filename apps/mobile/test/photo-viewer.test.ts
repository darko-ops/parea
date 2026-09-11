/**
 * One photograph, on its own.
 *
 * What was here was a sheet: a thumbnail at the top of a card with five
 * full-width buttons under it, on the screen whose entire subject is one
 * picture. You could not see the photograph you had tapped, and there was
 * nothing to do with it except report somebody.
 *
 * The checks below are about the three things that are easy to get wrong and
 * invisible until somebody is holding the phone: that the gesture does not
 * fight itself, that the picture is never cropped, and that a reaction is a
 * count rather than a name.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const API = read('src/api.ts');
const VIEWER = read('src/PhotoViewer.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GESTURE = code(VIEWER);

describe('the picture', () => {
  it('fills the screen on black, uncropped', () => {
    /*
     * `contain`, never `cover`: this is the one screen where the whole
     * photograph is the point. Black rather than the theme's background,
     * because a photograph is judged against what surrounds it.
     */
    expect(GESTURE).toMatch(/contentFit="contain"/);
    expect(GESTURE).toMatch(/root: \{ flex: 1, backgroundColor: '#000' \}/);
    expect(GESTURE).toMatch(/source=\{\{ uri: photo\.full \}\}/);
  });

  it('is a screen rather than a card with buttons under it', () => {
    // The five slabs are behind the `⋯`, and the sheet no longer draws its
    // own copy of the photograph.
    expect(APP).toMatch(/<Modal visible animationType="fade"/);
    expect(APP).not.toMatch(/<Image source=\{\{ uri: photo\.full \}\} style=\{styles\.sheetImage\}/);
    expect(GESTURE).toMatch(/accessibilityLabel="Photo options"/);
  });

  it('shows the counts as they are now, not as they were when tapped', () => {
    // A reaction refreshes the feed; the copy captured at tap time would go on
    // showing what it showed before the tap.
    expect(APP).toMatch(/feed\?\.photos\.find\(\(p\) => p\.id === selected\.id\) \?\? selected/);
  });
});

describe('the gesture', () => {
  it('adds no native dependency', () => {
    // The same argument `SwipeBack` makes: a gesture library is native code
    // and a rebuild, and `PanResponder` is already here.
    expect(GESTURE).toMatch(/PanResponder/);
    expect(GESTURE).not.toMatch(/react-native-gesture-handler|reanimated/);
  });

  it('pinches between fit and a ceiling', () => {
    // Beyond 4x a 2560px rendition is mush, and below 1 the photograph is
    // smaller than the screen it is being looked at on.
    expect(GESTURE).toMatch(/Math\.max\(\s*1,\s*Math\.min\(MAX_SCALE,/);
  });

  it('only pans a picture bigger than the screen', () => {
    // Otherwise the photograph slides around inside its own frame.
    expect(GESTURE).toMatch(/if \(now\.current\.scale <= 1\) return;/);
  });

  it('will not let the edges leave the glass', () => {
    // Half the extra width and height is the whole overhang; past it the pan
    // is into blank space with the photograph off the side.
    expect(GESTURE).toMatch(/const overX = \(width \* \(next - 1\)\) \/ 2/);
    expect(GESTURE).toMatch(/Math\.max\(-overX, Math\.min\(now\.current\.x, overX\)\)/);
  });

  it('returns to fit, and to centre, together', () => {
    // A photograph left at 1x but nudged off-centre reads as a bug long
    // before anybody works out what is wrong with it.
    expect(GESTURE).toMatch(/if \(next <= 1\) \{[\s\S]{0,400}toValue: \{ x: 0, y: 0 \}/);
  });

  it('does not flash the chrome on every double tap', () => {
    // The single tap waits out the double-tap window before acting.
    expect(GESTURE).toMatch(/if \(lastTap\.current === at\) setChrome/);
    expect(GESTURE).toMatch(/at - lastTap\.current < DOUBLE_TAP_MS/);
  });

  it('reads the live transform through listeners, not a private field', () => {
    /*
     * `Animated.Value` has no public getter and the gesture needs one on every
     * frame. Listeners are the documented way; `_value` is a private field
     * that has changed shape between React Native versions.
     */
    expect(GESTURE).toMatch(/scale\.addListener/);
    expect(GESTURE).toMatch(/scale\.removeListener/);
    expect(GESTURE).not.toMatch(/\._value/);
  });
});

describe('reacting to a photograph', () => {
  it('offers what is already there, then the rest of the set', () => {
    // "What people said about this, and what else you could say" — rather
    // than a keyboard.
    expect(GESTURE).toMatch(/photo\.reactions\.map\(\(r\) =>/);
    expect(GESTURE).toMatch(/REACTIONS\.filter\(\(emoji\) => !mine\.has\(emoji\)\)/);
  });

  it('is a count and never a name', () => {
    // Who left which reaction is not disclosed to anybody.
    expect(API).toMatch(/reactions: \{ emoji: string; count: number; mine: boolean \}\[\]/);
    expect(GESTURE).not.toMatch(/actorId|avatarUrl/);
  });

  it('goes to its own path, not the message one', () => {
    // The ids come out of two tables, and a route that has to guess which one
    // it was handed is a route that can guess wrong.
    expect(API).toMatch(/\/api\/photos\/\$\{photoId\}\/reactions/);
    expect(GESTURE).toMatch(/api\.reactToPhoto\(photo\.id, emoji\)/);
  });

  it('says why rather than offering a control that will be refused', () => {
    expect(GESTURE).toMatch(/Reacting needs an account/);
    expect(APP).toMatch(/canReact=\{feed\?\.canPost \?\? false\}/);
  });

  it('fails quietly', () => {
    // An alert over a photograph for a tap that did not land is worse than
    // the tap not landing; the next refresh corrects the pill.
    expect(GESTURE).toMatch(/} catch \{\s*} finally \{/);
  });
});
