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
    expect(GESTURE).not.toMatch(/actorId/);
    /*
     * `avatarUrl` used to be absent from this whole file and the assertion
     * said so. It is here now, once, for the uploader's square at the top —
     * which is a different thing from a reaction row and is the only face the
     * viewer draws. What the rule was protecting is that a *reaction* is a
     * name and an emoji, so that is what is checked.
     */
    const reactions = GESTURE.slice(GESTURE.indexOf('r.mine ?'));
    expect(reactions.slice(0, reactions.indexOf('</'))).not.toMatch(/avatarUrl/);
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

  /*
   * The four things Guideline 1.2 asks of an app carrying other people's
   * uploads: a filtering method, a way to report, a way to block, and
   * published contact details. Two of them are not code and the other two are
   * these rows.
   *
   * This used to assert `label="Report photo"` and nothing else, and it passed
   * for as long as reporting was the only one of the three that was wired.
   * `api.block` and `api.removalRequest` existed in the client the whole time
   * and no screen called either — which is exactly the shape of bug a test
   * naming one label cannot see. So it names the calls now: a row somebody can
   * press is the claim, and the call underneath it is the evidence.
   */
  it('offers taking it down, reporting and blocking, when it is not', () => {
    const sheet = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---'));
    expect(sheet).toMatch(/photo\.mine \? \(/);
    expect(sheet).toMatch(/api\.removalRequest\(photo\.id\)/);
    expect(sheet).toMatch(/api\.report\(photo\.id\)/);
    expect(sheet).toMatch(/api\.block\(photo\.id\)/);
  });

  it('asks twice before blocking, and says what it costs', () => {
    // Destructive and silent, so it gets the platform's own confirmation
    // rather than a label that changes under the finger. The second press
    // says `Block`, not `OK`.
    const sheet = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---'));
    expect(sheet).toMatch(/const confirmBlock = \(\) =>\s*Alert\.alert\(/);
    expect(sheet).toMatch(/style: 'destructive'/);
    expect(sheet).toMatch(/They are not told/);
  });

  it('does not offer an undo it does not have', () => {
    /*
     * `DELETE /api/blocks` exists and nothing on either client calls it, and
     * it is keyed by a photograph of the person being unblocked — which the
     * block has just hidden. Until a block list exists somewhere, the
     * confirmation must not tell somebody the door opens again.
     */
    // `code` first: the reason there is no undo is written in a comment two
    // lines above the confirmation, and a test that reads comments would pass
    // on the explanation while the screen made the promise.
    const sheet = code(
      APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('// --- chrome ---')),
    );
    expect(sheet).not.toMatch(/undo it in Settings|You can undo/i);
  });

  it('tells one story about a takedown on both clients', () => {
    /*
     * These sentences are a promise — the 48 hours is a deadline the auto-hide
     * job actually keeps — and they are the only account somebody gets of what
     * became of a report they made. Two clients describing one outcome
     * differently is worse than either description on its own.
     *
     * There is no package both clients already depend on where three strings
     * could live (`@parea/core` carries a database driver, which is not going
     * into a React Native bundle for this), so they are duplicated. This is
     * what holds the copies together: it reads the web's own `DONE` and
     * asserts the app says the same words. Change one and this fails, which is
     * the point — rewording is allowed, rewording one of them is not.
     */
    const web = readFileSync(
      fileURLToPath(new URL('../../web/app/components/PhotoView.tsx', import.meta.url).href),
      'utf8',
    );
    const sentences = [
      'Asked the host to take it down. If they have not answered in 48 hours it is hidden automatically.',
      'Reported. Someone will look at it.',
      'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.',
    ];
    for (const said of sentences) {
      expect(web).toContain(said);
      expect(APP).toContain(said);
    }
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


describe('whose photograph it is', () => {
  it('is a square in the middle of the chrome', () => {
    /*
     * Centred on the screen rather than on the gap between the two round
     * buttons — with `space-between` those are different centres, and the
     * second drifts as the buttons change size.
     */
    expect(GESTURE).toMatch(/who: \{ position: 'absolute', left: 0, right: 0, alignItems: 'center' \}/);
    // A square, like the faces on the tiles: a disc here would be the one
    // round face in a product whose photographs all have corners.
    expect(GESTURE).toMatch(/whoFace: \{ width: 34, height: 34, borderRadius: 9/);
  });

  it('opens the person, which is the path the column used to carry', () => {
    expect(GESTURE).toMatch(/onOpenPerson\(uploader\.handle!\)/);
    expect(APP).toMatch(/onOpenPerson=\{onOpenPerson\}/);
  });

  it('is a label, not a control, for somebody with no profile', () => {
    // Somebody who arrived by a link and added photographs has a name and a
    // face and nothing behind them.
    expect(GESTURE).toMatch(/disabled=\{!uploader\.handle\}/);
    expect(GESTURE).toMatch(/accessibilityRole=\{uploader\.handle \? 'button' : 'text'\}/);
  });

  it('draws nothing at all for an uploader who has gone', () => {
    // `by` is null there, and an anonymous square in the middle of the chrome
    // would be a claim about somebody.
    expect(GESTURE).toMatch(/\{uploader && \(/);
    expect(APP).toMatch(/uploader=\{selected\.by \? \(byline\.get\(selected\.by\) \?\? null\) : null\}/);
  });
});



/**
 * Paging through an album, and the flash that took four attempts.
 *
 * The first three kept a hand-rolled row of three photographs and tried to
 * put it back to centre at the moment the middle one changed. Centring is an
 * offset and changing the picture is a React commit, and those cross to the
 * native side on different schedules — so one of the two was always late and
 * a frame was drawn with them out of step. What people saw was the photograph
 * they had just left, centred under the new window, for a split second.
 *
 * Moving the reset earlier (`useLayoutEffect`), and then attaching the
 * animated value only while a gesture ran, made the JS side tidier and left
 * the race exactly where it was. It cannot be won from here: detaching a
 * native animated node is itself a native operation with its own schedule.
 *
 * So the row is gone. A horizontal pager does not move relative to itself and
 * is never re-centred; the only thing that changes is a scroll offset the
 * platform owns end to end, and there is no moment for this code to
 * synchronise with anything.
 */
describe('the pager', () => {
  it('is the platform’s, not a row this file moves', () => {
    expect(GESTURE).toMatch(/<FlatList[\s\S]{0,400}horizontal\s*\n\s*pagingEnabled/);
    // Every part of the hand-rolled row, and the reset that could not be made
    // to land on the right frame.
    expect(GESTURE).not.toMatch(/const strip = useRef|styles\.strip|sliding|PAGE_MS/);
    expect(GESTURE).not.toMatch(/strip\.setValue/);
  });

  it('opens on the photograph that was tapped', () => {
    // `getItemLayout` is what lets it jump to an index without measuring
    // everything before it.
    expect(GESTURE).toMatch(/initialScrollIndex=\{index\}/);
    expect(GESTURE).toMatch(/length: width, offset: width \* at, index: at/);
  });

  it('does not page while a photograph is magnified', () => {
    /*
     * Said twice, from both ends, and the second is the one that cannot be a
     * frame late: `scrollEnabled` is React state set from an animation
     * listener, and the termination request is read at the instant the pager
     * asks. The same sideways finger means two different things at 1× and at
     * 3×.
     */
    expect(GESTURE).toMatch(/scrollEnabled=\{!zoomed\}/);
    expect(GESTURE).toMatch(/if \(now\.current\.scale > 1\) return false;/);
  });

  it('keeps a vertical gesture even at fit', () => {
    /*
     * The bug that took the swipe-to-close away. A horizontal scroll view on
     * iOS has no directional lock — its recogniser begins on a downward drag
     * as readily as a sideways one — so it asked for the touch, this said
     * yes, and the gesture ended in `onPanResponderTerminate` rather than in
     * a release. Terminate settles the picture and nothing else, so swiping
     * down moved the photograph and put it back instead of leaving.
     *
     * Phrased as "give it up unless", so the default stays the behaviour that
     * works: at the start of a drag neither axis has won and the pager gets
     * the touch.
     */
    expect(GESTURE).toMatch(
      /return !\(Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\) && Math\.abs\(g\.dy\) > TAP_SLOP\);/,
    );
  });

  it('tells the pager about zoom on a change, not on every frame', () => {
    // The listener runs per animation frame; a `setState` there re-renders
    // the whole viewer for every frame of every pinch.
    expect(GESTURE).toMatch(/if \(zoomed !== told\.current\)/);
  });

  it('reports where it landed once it has stopped', () => {
    /*
     * `onMomentumScrollEnd` rather than a viewability callback: the index is
     * what the chrome and the comment box are about, and changing those under
     * a finger still moving is worse than changing them a moment late.
     */
    expect(GESTURE).toMatch(/onMomentumScrollEnd=/);
    expect(GESTURE).toMatch(/const at = Math\.round\(offset \/ width\);/);
    expect(GESTURE).toMatch(/if \(at !== index && at >= 0 && at < photos\.length\) onIndex\(at\);/);
  });

  it('keeps one answer for which photograph is on the glass', () => {
    // Derived from the index rather than passed beside it, so the chrome and
    // the page under it cannot disagree.
    expect(GESTURE).toMatch(/const photo = photos\[index\] \?\? photos\[0\]!;/);
    // And the caller is told, so the options sheet and the comments follow.
    expect(APP).toMatch(/onIndex: \(at: number\) => \{/);
    expect(APP).toMatch(/if \(there\) setSelected\(there\);/);
  });
});

describe('one page of the pager', () => {
  it('claims the touch, and hands it over when the pager asks', () => {
    /*
     * Declining on the way down was the obvious way to leave the pager able
     * to page, and it cost every gesture that is not a page: a responder that
     * never claims never receives a release, so there were no taps — and the
     * `Pressable` put over the top to catch them claimed the touch itself and
     * starved this of the vertical swipes, the pinch and the pan.
     *
     * One responder owns the gesture, and the negotiation is a request to
     * give it up rather than a refusal to take it.
     */
    expect(GESTURE).toMatch(/onStartShouldSetPanResponder: \(\) => true/);
    expect(GESTURE).toMatch(/onMoveShouldSetPanResponder: \(\) => true/);
    expect(GESTURE).toMatch(/onPanResponderTerminationRequest:/);
    // And nothing over the top of it competing for the same touch.
    const page = GESTURE.slice(GESTURE.indexOf('function Page('), GESTURE.indexOf('export function PhotoViewer'));
    expect(page).not.toMatch(/<Pressable/);
  });

  it('reads a tap as a release with nothing in it', () => {
    expect(GESTURE).toMatch(/if \(Math\.hypot\(g\.dx, g\.dy\) <= TAP_SLOP\)/);
    expect(GESTURE).toMatch(/at - lastTap\.current < DOUBLE_TAP_MS/);
    expect(GESTURE).toMatch(/zoomTo\(now\.current\.scale > 1 \? 1 : TAP_SCALE\)/);
    expect(GESTURE).toMatch(/if \(lastTap\.current === at\) onChrome\(\);/);
  });

  it('does not nudge the picture on a drag the pager is about to take', () => {
    /*
     * A sideways drag at fit spends its first few points in the move handler
     * before the pager asks for it. Following those would push the photograph
     * down and snap it back on every swipe between pictures.
     */
    expect(GESTURE).toMatch(
      /if \(Math\.abs\(g\.dy\) > Math\.abs\(g\.dx\)\) pan\.setValue\(\{ x: 0, y: g\.dy \/ 3 \}\);/,
    );
  });

  it('keeps down-to-leave and up-to-talk', () => {
    // Two habits somebody already has. Unchanged by the pager, because the
    // pager only ever wanted the other axis.
    expect(GESTURE).toMatch(/if \(g\.dy > 0\) onClose\(\);\s*else onTalk\(\);/);
    expect(GESTURE).toMatch(/const far = Math\.abs\(g\.dy\) > SWIPE;/);
    expect(GESTURE).toMatch(/const flung = Math\.abs\(g\.vy\) > FLING;/);
  });

  it('holds its own zoom, so leaving a page leaves its magnification', () => {
    // A component per photograph rather than one transform over a moving row:
    // whichever page you arrive at is at fit, which is where a photograph you
    // have just reached should start.
    const page = GESTURE.slice(GESTURE.indexOf('function Page('), GESTURE.indexOf('export function PhotoViewer'));
    expect(page).toMatch(/const scale = useRef\(new Animated\.Value\(1\)\)/);
    expect(page).toMatch(/const pan = useRef\(new Animated\.ValueXY/);
  });

  it('does not crossfade, because a page holds one picture for its life', () => {
    expect(GESTURE).toMatch(/transition=\{0\}/);
    expect(GESTURE).not.toMatch(/transition=\{120\}[\s\S]{0,200}photo\.full/);
  });
});

describe('the way out of a photograph', () => {
  /*
   * The ✕ opened the uploader's profile.
   *
   * The square naming them is centred on the screen rather than on the gap
   * between the two corner buttons — those are different centres, and the
   * second drifts as the buttons change size — so it is positioned across the
   * full width. It was also the pressable, which made it a full-width target
   * lying over both buttons, painted above them because it comes later in the
   * tree. Pressing ✕ pressed it.
   *
   * The two jobs are split: one view places, the other answers to a touch.
   */
  it('closes rather than opening the person who added it', () => {
    // The placing takes no touches.
    expect(GESTURE).toMatch(/<View style=\{styles\.who\} pointerEvents="box-none">/);
    // The target is the size of what is drawn inside it, not of the row.
    expect(GESTURE).toMatch(/whoTap: \{ alignItems: 'center', gap: 4 \}/);
    const tap = GESTURE.slice(GESTURE.indexOf('whoTap: {'));
    expect(tap.slice(0, tap.indexOf('\n'))).not.toMatch(/position: 'absolute'|left: 0|right: 0/);
  });

  it('keeps the close button reachable at all', () => {
    // It is the first thing in the row and the only one that leaves.
    expect(GESTURE).toMatch(/accessibilityLabel="Close"[\s\S]{0,120}✕/);
    expect(GESTURE).toMatch(/onPress=\{onClose\}/);
  });
});
