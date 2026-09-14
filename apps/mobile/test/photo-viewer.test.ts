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
    /*
     * Otherwise the photograph slides around inside its own frame.
     *
     * At fit the same finger is a vertical gesture instead — up to leave, down
     * to open the comments — and that space was free precisely because there is
     * nothing to pan when the picture is already inside the screen. Zoomed in,
     * this branch takes the finger back and neither gesture can fire.
     */
    expect(GESTURE).toMatch(/if \(now\.current\.scale <= 1\) \{\s*pan\.setValue/);
    expect(GESTURE).toMatch(/now\.current\.scale <= 1 && Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\)/);
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
     *
     * They were then two columns at opposite corners with a gap of photograph
     * between them. Now the list sits over the bar, and the control is one face
     * at the end of it.
     */
    expect(GESTURE).toMatch(/styles\.said\b/);
    expect(GESTURE).toMatch(/ordered\.map\(\(r, i\) =>/);
    expect(GESTURE).toMatch(/styles\.smiley\b/);
  });

  it('prints the handle, without an `@`, and never an actor id', () => {
    // The handle is a byline here, not a mention — and the client does not
    // add a sigil the server did not send.
    expect(API).toMatch(/reactions: \{ emoji: string; name: string; mine: boolean \}\[\]/);
    expect(GESTURE).toMatch(/\{r\.mine \? 'You' : r\.name\}/);
    expect(GESTURE).not.toMatch(/`@\$\{/);
    expect(GESTURE).not.toMatch(/actorId|avatarUrl/);
  });

  it('reads downward from the newest, over the comment bar', () => {
    /*
     * Two reversals, and the second undid the first for a reason.
     *
     * It began as the four newest shown oldest-first with "and N more"
     * underneath — the overflow *below* the newest line, reading as "there are
     * newer ones I am not showing", and the whole column shifting up a row
     * every time somebody reacted. That was fixed by reversing it so the newest
     * sat against the corner and the list grew upward out of it.
     *
     * Right for a column anchored to a corner; wrong for a list in the middle
     * of the screen. Above the comment bar it is an ordinary list in an
     * ordinary place, and an ordinary list reads downward from the newest —
     * which is what the album's own conversation does and what everything else
     * in the product does.
     */
    expect(GESTURE).toMatch(/const ordered = reactions;/);
    expect(GESTURE).not.toMatch(/\[\.\.\.reactions\]\.reverse\(\)/);
    // No longer anchored to a corner, so nothing pins it to an edge.
    expect(GESTURE).not.toMatch(/justifyContent: 'flex-end'/);
    expect(GESTURE).toMatch(/said: \{ position: 'absolute', left: 16, right: 16, bottom: 88 \}/);
    // And nothing summarises the overflow away.
    expect(GESTURE).not.toMatch(/and \{reactions\.length - VISIBLE_REACTIONS\} more/);
    expect(GESTURE).not.toMatch(/saidMore/);
  });

  it('stops at four rows and lets the rest be scrolled to', () => {
    // Twenty handles up the side of a picture is a list covering the thing the
    // list is about — but summarising them hid who they were.
    expect(GESTURE).toMatch(/const VISIBLE_REACTIONS = 4/);
    expect(GESTURE).toMatch(
      /maxHeight: VISIBLE_REACTIONS \* SAID_ROW \+ \(VISIBLE_REACTIONS - 1\) \* SAID_GAP/,
    );
    /*
     * Nothing scrolls it on arrival any more. The newest is the first row now,
     * which is where a scroll view already starts — and `scrollToEnd` would
     * open it showing the oldest reaction on the photograph.
     */
    expect(GESTURE).not.toMatch(/scrollToEnd/);
    expect(GESTURE).toMatch(/<ScrollView/);
  });

  it('goes to its own path, not the message one', () => {
    // The ids come out of two tables, and a route that has to guess which one
    // it was handed is a route that can guess wrong.
    expect(API).toMatch(/\/api\/photos\/\$\{photoId\}\/reactions/);
    expect(GESTURE).toMatch(/api\.reactToPhoto\(photo\.id, emoji\)/);
  });

  it('says why rather than offering a control that will be refused', () => {
    expect(GESTURE).toMatch(/Sign in/);
    expect(GESTURE).toMatch(/canReact \? \(/);
    expect(APP).toMatch(/canReact=\{feed\?\.canPost \?\? false\}/);
  });

  it('puts an optimistic reaction where the server would have put it', () => {
    /*
     * A `Map` iterates in insertion order and this list reads newest first.
     *
     * With one reaction in flight that makes no difference, which is why it was
     * wrong and looked fine. Leave two — react, then react again before the
     * first has come back — and the pair went in oldest-above-newest while the
     * server was about to answer newest-above-oldest, so the second landed
     * below the first and swapped places a moment later. That reads as the app
     * changing its mind about what you just did.
     */
    expect(GESTURE).toMatch(/\.reverse\(\)\s*\.map\(\(\[emoji\]\) => \(\{ emoji, name: 'You', mine: true \}\)\)/);
    expect(GESTURE).toMatch(/return \[\.\.\.added, \.\.\.kept\]/);
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

/**
 * The two gestures at fit, the comments, and the open emoji set.
 *
 * All four live on the same screen and three of them are new surface on a view
 * whose whole subject is one photograph — so what is guarded here is mostly
 * what they must *not* do to each other.
 */
describe('what a finger means at fit', () => {
  it('leaves downward and talks upward', () => {
    /*
     * It was the other way round, on the argument that each gesture should move
     * something in the direction it actually goes: the comments are below, so
     * pull them up; the album is behind, so push the photograph away. That is
     * sound and it loses, because it is reasoning — and nobody reasons about a
     * swipe.
     *
     * Every photo viewer on this phone dismisses downward and every sheet
     * arrives from below when you pull up. Those are habits somebody already
     * has, and a screen that inverts both to be internally consistent is one
     * where the first swipe does the wrong thing to everybody.
     */
    expect(GESTURE).toMatch(/if \(g\.dy > 0\) onClose\(\);\s*else setTalking\(true\)/);
  });

  it('refuses a diagonal', () => {
    // A flick past a photograph would otherwise close it.
    expect(GESTURE).toMatch(/Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\)/);
  });

  it('takes a flick as readily as a drag', () => {
    // A short fast swipe is the same intention as a long slow one, which is the
    // rule `SwipeBack` already follows.
    expect(GESTURE).toMatch(/const far = Math\.abs\(g\.dy\) > SWIPE/);
    expect(GESTURE).toMatch(/const flung = Math\.abs\(g\.vy\) > FLING/);
  });

  it('moves the photograph while the finger is down', () => {
    // Not for the animation: it is how somebody finds out the gesture exists,
    // and how they discover mid-drag which way they are going.
    expect(GESTURE).toMatch(/pan\.setValue\(\{ x: 0, y: g\.dy \/ 3 \}\)/);
  });
});

describe('what is said about one photograph', () => {
  it('is the album’s own thread, not a second kind of message', () => {
    /*
     * `event_message` has carried a `photo_id` since the web let somebody reply
     * to a picture. A comment here is a line in the album's conversation that
     * happens to be about one of its photographs — no second table, no second
     * endpoint, and it appears in the album's Talk tab where it belongs.
     */
    expect(APP).toMatch(/comments=\{\(feed\?\.messages \?\? \[\]\)\.filter\(\(m\) => m\.photoId === selected\.id\)\}/);
    expect(VIEWER).toMatch(/api\.postMessage\(eventId, body, photo\.id\)/);
  });

  it('keeps the box on the glass rather than inside the panel', () => {
    // It is the thing somebody came here to do, and a comment box you have to
    // open a panel to find is a comment box nobody uses.
    expect(VIEWER).toMatch(/bar: \{\s*position: 'absolute'/);
    expect(VIEWER).toMatch(/\{!talking && \(/);
    // The box and the face share one line, so the list above has a single edge
    // to sit over rather than two controls at different heights.
    expect(VIEWER).toMatch(/composerHint: \{\s*flex: 1,/);
  });

  it('keeps the photograph in view behind it', () => {
    // A comment read without the picture in view is a remark about nothing.
    expect(VIEWER).toMatch(/maxHeight: '62%'/);
    expect(VIEWER).toMatch(/talkAway.*onPress=\{\(\) => setTalking\(false\)\}|onPress=\{\(\) => setTalking\(false\)\}/);
  });

  it('keeps the draft when sending fails', () => {
    // Somebody who wrote a sentence is not being asked to write it again.
    const post = VIEWER.slice(VIEWER.indexOf('const post = useCallback'), VIEWER.indexOf('const react = useCallback'));
    expect(post).toMatch(/setDraft\(''\);\s*await onChanged\(\)/);
    expect(post).not.toMatch(/catch[\s\S]{0,80}setDraft/);
  });
});

describe('reacting with anything', () => {
  it('offers one face rather than a column of guesses', () => {
    /*
     * Six emoji were offered because a reaction should be one tap and a grid of
     * two thousand is not one tap. The flaw in that is which six: they are the
     * set we guessed, and the seventh emoji somebody reaches for is the one
     * they actually mean — so the column spent the right-hand side of a
     * photograph to save a press that only sometimes landed.
     *
     * One control now, and the picker behind it is the one on their own phone,
     * with their own recents at the front of it. The frequent emoji are still
     * one tap away; they are theirs rather than ours.
     */
    expect(code(VIEWER)).not.toMatch(/\bREACTIONS\b/);
    expect(VIEWER).toMatch(/accessibilityLabel="React to this photo"/);
    expect(VIEWER).toMatch(/setPicking\(true\)/);
  });

  it('draws the control as a glyph, not as a particular emoji', () => {
    /*
     * A 🙂 in the button is *an* emoji sitting where a control should be: it
     * reads as "react with this one" rather than "choose one", and it changes
     * shape between platforms and font versions while every other control in
     * this app is a 24-unit stroke that does not.
     */
    expect(VIEWER).toMatch(/<Glyph name="face" size=\{22\} color="#fff" \/>/);
    expect(code(VIEWER)).not.toMatch(/🙂/);
  });

  it('shows emoji and only emoji', () => {
    /*
     * This focused an invisible `TextInput` so the phone would open its emoji
     * keyboard. It works, and it opens *a* keyboard — the last panel somebody
     * used, which is usually but not always the emoji one. There is no
     * `keyboardType` for emoji on iOS and no public way to ask for that panel.
     *
     * So the choice was a keyboard that is sometimes letters, or a grid of our
     * own. A grid can only produce emoji, which is the requirement, and it
     * never puts a text field over somebody's photograph.
     */
    expect(VIEWER).toMatch(/<EmojiPicker/);
    /*
     * The viewer still has a `TextInput` — it is the comment box, which is a
     * text field on purpose. What is gone is the invisible one that existed
     * only to summon a keyboard.
     */
    expect(code(VIEWER)).not.toMatch(/pickInput|Type an emoji/);

    const PICKER = readFileSync(
      fileURLToPath(new URL('../src/Emoji.tsx', import.meta.url).href),
      'utf8',
    );
    expect(code(PICKER)).not.toMatch(/TextInput|keyboardType/);
    /*
     * The six that used to be offered outright are still the first thing in it.
     * They were chosen because they are what people react to photographs with,
     * so the common case stays one scroll-free tap — which is the only thing
     * worth keeping from the column they replaced.
     */
    expect(PICKER).toMatch(/name: 'Reactions'/);
    const first = PICKER.slice(PICKER.indexOf("name: 'Reactions'"), PICKER.indexOf("name: 'Faces'"));
    for (const emoji of ['❤️', '😂', '🔥', '👏', '😮', '🙏']) {
      expect(first, `${emoji} should still lead`).toContain(emoji);
    }
  });
});

/**
 * What the `⋯` offers, and who it offers it to.
 *
 * Two menus, and which one you get is not a matter of taste: what a person can
 * do about a photograph depends entirely on whether they put it there. Yours —
 * take it down, or say who is in it. Somebody else's — report it.
 */
describe('the photo options', () => {
  it('is drawn inside the viewer’s modal, not beside it', () => {
    /*
     * The bug, and the thing that hid it.
     *
     * The sheet was a sibling of the viewer's `<Modal>`, which on iOS means it
     * presented *underneath* a full-screen modal that was already up. So `⋯`
     * appeared to do nothing: the sheet opened every time and was never
     * visible, and then turned up over the album the moment the photograph was
     * swiped away.
     *
     * That last part was reported as a bug and treated as one — clearing the
     * state on close, which is still right and is checked below. But the state
     * was never the fault. A sheet about a photograph belongs in the same layer
     * as the photograph.
     */
    const modal = APP.slice(
      APP.indexOf('{selected && ('),
      APP.indexOf('</Modal>', APP.indexOf('{selected && (')),
    );
    expect(modal).toMatch(/<PhotoViewer/);
    expect(modal).toMatch(/\{actionsFor && \(\s*<PhotoActions/);
  });

  it('does not outlive the photograph it is about', () => {
    // Closing the viewer closes the sheet: a "remove my photo" prompt about a
    // picture nobody is looking at is nobody's idea of a prompt.
    expect(APP).toMatch(/setSelected\(null\);\s*setActionsFor\(null\);/);
  });

  it('offers taking it down and tagging, when it is yours', () => {
    expect(APP).toMatch(/label="Remove photo"/);
    expect(APP).toMatch(/Tag 'em/);
  });

  it('offers reporting, when it is not', () => {
    expect(APP).toMatch(/label="Report photo"/);
    const sheet = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---'));
    expect(sheet).toMatch(/photo\.mine \? \(/);
  });

  it('tags from the album’s own people, not from everybody', () => {
    /*
     * The server refuses a tag on somebody who is not in the event — tagging is
     * not a way to point at a person who cannot open the album and so cannot
     * object. The picker offers exactly what the server accepts, rather than
     * searching every account and finding out on submit.
     */
    const sheet = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---'));
    expect(sheet).toMatch(/members: Member\[\]/);
    expect(sheet).not.toMatch(/findPeople/);
    expect(APP).toMatch(/members=\{feed\?\.members \?\? \[\]\}/);
  });

  it('lets a tag be taken off from here as well as added', () => {
    // The uploader put it on, so the uploader can take it off. The person
    // tagged can too, from their own side — the route allows both.
    const sheet = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---'));
    expect(sheet).toMatch(/\.untagPhoto\(photo\.id, member\.actorId\)/);
    expect(sheet).toMatch(/api\.tagPhoto\(photo\.id, actorId\)/);
  });

  it('moves to the top of the screen once there is a keyboard', () => {
    /*
     * Tagging is the one thing in this sheet with a text field in it, and a
     * bottom sheet with a keyboard over it is a list somebody is typing into
     * that they cannot see: the field, the names and the chips were all under
     * the keys.
     *
     * Only that state. The two menu buttons have no keyboard and belong where a
     * sheet belongs.
     */
    expect(APP).toMatch(/tagging \? styles\.sheetTop : styles\.sheetBackdrop/);
    expect(APP).toMatch(/sheetTop: \{ flex: 1, justifyContent: 'flex-start', paddingTop: 64/);
    // Bounded, so a long roster scrolls inside the panel rather than growing it
    // off the bottom and back under the keys it was moved to escape.
    expect(APP).toMatch(/sheetTopPanel: \{[\s\S]{0,80}maxHeight: '70%'/);
  });

  it('puts a way off the keyboard on the keyboard', () => {
    /*
     * A search field with no submit has nothing to press to put the keys away,
     * and tapping outside is the usual escape — except there is no outside
     * here, because the sheet is the screen. iOS puts an accessory bar directly
     * above the keys for this, which is where a thumb already is.
     *
     * The id is a constant: two literals that have to match is a pair that
     * eventually does not.
     */
    expect(APP).toMatch(/const KEYBOARD_BAR = /);
    expect(APP).toMatch(/inputAccessoryViewID=\{KEYBOARD_BAR\}/);
    expect(APP).toMatch(/<InputAccessoryView nativeID=\{KEYBOARD_BAR\}>/);
    expect(APP).toMatch(/onPress=\{Keyboard\.dismiss\}/);
    // iOS only: `InputAccessoryView` is not implemented on Android, where the
    // back key has always done this.
    expect(APP).toMatch(/\{Platform\.OS === 'ios' && \(\s*<InputAccessoryView/);
  });

  it('shows the names as they are now, not as they were when opened', () => {
    // Tagging refreshes the feed, and the copy taken when `⋯` was pressed would
    // go on showing the names from before it.
    expect(APP).toMatch(/feed\?\.photos\.find\(\(p\) => p\.id === actionsFor\.id\) \?\? actionsFor/);
  });
});

/**
 * The emoji sheet's own two problems.
 *
 * Both are about a grid inside a sheet, which is a shape with two gestures and
 * one finger: the grid wants every downward drag and the sheet wants some of
 * them.
 */
describe('the emoji sheet', () => {
  const PICKER = readFileSync(
    fileURLToPath(new URL('../src/Emoji.tsx', import.meta.url).href),
    'utf8',
  );

  it('draws every section pill the same size', () => {
    /*
     * Sized to its own word, "Food" was two-thirds the width of "Reactions", so
     * the row read as a ragged set of unrelated things — and the selected pill
     * changed width as the selection moved, so the row reflowed under a thumb.
     *
     * One constant, so a section named something longer is a change to a number
     * rather than a row that quietly starts clipping.
     */
    expect(PICKER).toMatch(/const TAB = \d+;/);
    expect(PICKER).toMatch(/tab: \{\s*width: TAB,\s*height: 32,/);
    expect(PICKER).toMatch(/alignItems: 'center',\s*justifyContent: 'center',/);
  });

  it('never lets a label wrap or clip', () => {
    // A label on two lines inside a 32pt pill is a label with its second half
    // cut off.
    expect(PICKER).toMatch(/numberOfLines=\{1\}/);
    expect(PICKER).toMatch(/tabText: \{[^}]*textAlign: 'center'/);
  });

  it('closes on a downward swipe, but only when the grid has nothing to scroll', () => {
    /*
     * The whole of the problem: a downward drag inside the grid is a scroll, so
     * a sheet that took every one would make the grid unscrollable. A drag at
     * the top of an already-at-the-top grid has nothing to scroll, which is
     * exactly when somebody means "put this away".
     */
    expect(PICKER).toMatch(/onMoveShouldSetPanResponderCapture: \(_evt, g\) =>\s*atTop\.current && g\.dy > 6 && g\.dy > Math\.abs\(g\.dx\)/);
    expect(PICKER).toMatch(/if \(g\.dy > SWIPE \|\| g\.vy > FLING\) onClose\(\)/);
    // Read from the scroll view rather than guessed.
    expect(PICKER).toMatch(/atTop\.current = e\.nativeEvent\.contentOffset\.y <= 0/);
  });

  it('never claims a tap or a sideways drag', () => {
    // Sideways is the section row; a tap is an emoji.
    expect(PICKER).toMatch(/onStartShouldSetPanResponderCapture: \(\) => false/);
  });

  it('resets the flag when the section changes', () => {
    // A new section starts at the top. Without this, switching after scrolling
    // leaves the sheet refusing to close until somebody scrolls again.
    expect(PICKER).toMatch(/atTop\.current = true;\s*setSection\(i\)/);
  });

  it('keeps the flag out of state', () => {
    // As state it would rebuild the responder on every scroll frame.
    expect(PICKER).toMatch(/const atTop = useRef\(true\)/);
  });
});
