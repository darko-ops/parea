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
  it('separates who said something from what you could say', () => {
    /*
     * One row of pills conflated the two: "❤️ 3" was both a fact about other
     * people and a control that changed your own answer, and the only way to
     * tell which of the three was you was a border.
     */
    expect(GESTURE).toMatch(/styles\.said\b/);
    expect(GESTURE).toMatch(/styles\.picker\b/);
    // Left is people; right is every emoji in the set, and only that.
    expect(GESTURE).toMatch(/reactions\.slice\(0, VISIBLE_REACTIONS\)/);
    expect(GESTURE).toMatch(/REACTIONS\.map\(\(emoji\) =>/);
  });

  it('prints the handle, without an `@`, and never an actor id', () => {
    // The handle is a byline here, not a mention — and the client does not
    // add a sigil the server did not send.
    expect(API).toMatch(/reactions: \{ emoji: string; name: string; mine: boolean \}\[\]/);
    expect(GESTURE).toMatch(/\{r\.mine \? 'You' : r\.name\}/);
    expect(GESTURE).not.toMatch(/`@\$\{/);
    expect(GESTURE).not.toMatch(/actorId|avatarUrl/);
  });

  it('stops before a popular photograph is covered in names', () => {
    // Twenty handles up the side of a picture is a list covering the thing
    // the list is about.
    expect(GESTURE).toMatch(/const VISIBLE_REACTIONS = 4/);
    expect(GESTURE).toMatch(/reactions\.length - VISIBLE_REACTIONS/);
  });

  it('is a column you scroll, cut off so it looks like one', () => {
    // Four keys tall, so a fifth is visibly clipped and the column reads as
    // something to scroll rather than as all there is.
    expect(GESTURE).toMatch(/<ScrollView/);
    expect(GESTURE).toMatch(/pickerScroll: \{ maxHeight: 4 \* 44 \}/);
  });

  it('goes to its own path, not the message one', () => {
    // The ids come out of two tables, and a route that has to guess which one
    // it was handed is a route that can guess wrong.
    expect(API).toMatch(/\/api\/photos\/\$\{photoId\}\/reactions/);
    expect(GESTURE).toMatch(/api\.reactToPhoto\(photo\.id, emoji\)/);
  });

  it('says why rather than offering a control that will be refused', () => {
    expect(GESTURE).toMatch(/Sign in/);
    expect(GESTURE).toMatch(/!canReact \?/);
    expect(APP).toMatch(/canReact=\{feed\?\.canPost \?\? false\}/);
  });

  it('draws the answer before the server has given one', () => {
    /*
     * A reaction used to wait on a POST *and* a refresh of the entire album
     * feed, because that feed is where the counts live. Against a database in
     * another region that is most of a second with nothing on screen changing,
     * and the pill was disabled throughout.
     */
    expect(GESTURE).toMatch(/const \[pending, setPending\] = useState<Map<string, boolean>>/);
    // Set before the request, not after it.
    expect(GESTURE).toMatch(/setPending\(\(was\) => new Map\(was\)\.set\(emoji, on\)\);\s*try \{/);
    // And nothing in the picker is disabled while it is in flight.
    expect(GESTURE).not.toMatch(/disabled=\{busy/);
  });

  it('only ever overlays your own rows', () => {
    // You cannot react for somebody else, so everybody else's stand
    // untouched underneath the overlay.
    expect(GESTURE).toMatch(/r\.mine && pending\.get\(r\.emoji\) === false/);
  });

  it('fails quietly, and lets the refresh be the correction', () => {
    // An alert over a photograph for a tap that did not land is worse than the
    // tap not landing. No hand-rolled rollback: the feed arriving is what puts
    // a refused tap back.
    expect(GESTURE).toMatch(/} catch \{\s*}\s*await onChanged\(\);/);
  });
});
