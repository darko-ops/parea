/**
 * Albums with nothing in them are not on the home page.
 *
 * An empty album is a card that asks to be opened and then has nothing to
 * show, and most of them were never this person's doing: somebody made an
 * evening, added people, and the evening has not happened yet. A column of
 * those was the first thing the product's main screen said, on the tab whose
 * whole subject is photographs.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');
const PROFILE = read('src/Profile.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = code(
  EVENTS.slice(EVENTS.indexOf('export function HomeTab'), EVENTS.indexOf('export function GroupsTab')),
);

describe('the card the home list draws', () => {
  it('runs the photograph to both edges of the screen', () => {
    /*
     * A rounded card inset from both sides is an object on a page, with the
     * page showing around it. The subject of this screen is the photograph,
     * so it is the card — which is what the note at the top of `EventCard`
     * has always claimed and the 18pt radius was quietly contradicting.
     *
     * The scroll keeps its gutter for the words; the cover steps back out of
     * it, which is one number to keep in step rather than four.
     */
    expect(EVENTS).toMatch(/scroll: \{ padding: 20,/);
    expect(EVENTS).toMatch(/cover: \{ marginHorizontal: -20, overflow: 'hidden'/);
    // No radius on it at all, rather than a smaller one.
    expect(EVENTS).not.toMatch(/cover: \{[^}]*borderRadius/);
  });

  it('names the creator above the photograph, by handle, in bold', () => {
    /*
     * The handle rather than the display name: it is the half of somebody that
     * is unique and the half they can be found by, which is what a wall of
     * evenings needs to tell two people called Ana apart.
     */
    expect(EVENTS).toMatch(/styles\.byline\b/);
    expect(EVENTS).toMatch(/const by = event\.creator\.handle \?\? event\.creator\.name/);
    expect(EVENTS).toMatch(/bylineName: \{[^}]*fontWeight: '700'/);
    /*
     * And without the `@`. The sigil tells a handle from a name when the two
     * sit together in a sentence; a face and the word beside it is a byline,
     * which reads as a name whether or not it is punctuated like one.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).not.toMatch(/`@\$\{event\.creator\.handle\}`/);
    // Above the cover, not under it.
    expect(EVENTS.indexOf('styles.byline}')).toBeLessThan(EVENTS.indexOf('<View style={[styles.cover,'));
  });

  it('draws a letter rather than a silhouette where there is no picture', () => {
    // The rule every other face in this product follows.
    expect(EVENTS).toMatch(/styles\.bylineBlank/);
    expect(EVENTS).toMatch(/const byLens = lensFor\(/);
  });

  it('says the handle once, not twice', () => {
    /*
     * The card names the creator in exactly one place: the byline. The line
     * beside it is about the album — how many people, and whether anything is
     * still arriving — and the line above the title is about the album too, so
     * neither of them repeats a name.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    /*
     * Drawn, which is narrower than "mentioned": the byline is a control and
     * its accessible name is built from the same value — "maya, see their
     * profile" — which is a string a screen reader speaks rather than a second
     * copy on the card. Counting every `{by}` would fail on that and pass on a
     * real duplicate rendered from a different expression.
     */
    expect(CARD.match(/>\s*\{by\}\s*</g) ?? []).toHaveLength(1);
    /*
     * And the sentence beside it does not print a name at all. "You" is the
     * one exception and it is about the reader, not about the host — whose
     * name is the word directly to its left.
     */
    expect(CARD).toMatch(/const about = \[\s*event\.mine \? 'You' : null,/);
    expect(CARD).not.toMatch(/creator\.name : null/);
  });

  it('leaves the host out of the circles and scales them to 70%', () => {
    /*
     * The host is named and pictured in the byline directly above, so the
     * first circle was the same person twice on one card.
     *
     * Filtered rather than sliced off the front: the server orders the host
     * first, so dropping `[0]` looks identical right up until an event whose
     * creator never turned up to it — and then the card quietly stops showing
     * a real guest.
     */
    expect(EVENTS).toMatch(/event\.faces\.filter\(\(face\) => !face\.isCreator\)/);
    expect(EVENTS).not.toMatch(/event\.faces\.slice\(0, CARD_FACES\)/);
    // And the "+N" does not count them either, when they were in it at all.
    expect(EVENTS).toMatch(/const hostCounted = event\.faces\.length > others\.length \? 1 : 0/);

    // 70% of 34, with the ring, the overlap and the letter scaled with it.
    expect(EVENTS).toMatch(/width: 24,\s*\n\s*height: 24,\s*\n\s*borderRadius: 12,\s*\n\s*borderWidth: 1\.5,\s*\n\s*marginRight: -6,/);
    expect(EVENTS).toMatch(/faceLetter: \{ fontSize: 8\.5/);
  });

  it('measures the text column from the glass, not from the scroll', () => {
    /*
     * Everything in the card's column sat at the scroll's 20 plus 4 of its
     * own — 24 from the screen, which was right while the photograph was an
     * inset card and its corner was the thing being aligned to. The picture
     * runs to the edge now, so the only edge left to measure from is the
     * screen's, and 24 read as a wide margin beside one with none at all.
     *
     * `-4` against the scroll's 20 is 16, and the three blocks must agree.
     */
    expect(EVENTS).toMatch(/scroll: \{ padding: 20,/);
    expect(EVENTS).toMatch(/measured: \{[^}]*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/cardTitle: \{\s*\n\s*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/byline: \{[^}]*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/faces: \{ flexDirection: 'row', marginTop: -13, marginLeft: -4/);
  });

  it('leads with the album’s name, above the photograph', () => {
    /*
     * The title spent a while under the cover at 18 points, on the argument
     * that it was no longer the first thing on the card and should stop
     * competing with the picture. What that produced was a wall of pictures
     * you had to scroll past to find out what any of them were: the name of
     * an evening is how somebody recognises it, and on a screen of covers
     * from four different holidays it is the only thing telling them apart.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    const title = CARD.indexOf('styles.cardTitle');
    expect(title).toBeGreaterThan(CARD.indexOf('styles.measured}'));
    expect(title).toBeLessThan(CARD.indexOf('styles.byline}'));
    expect(title).toBeLessThan(CARD.indexOf('<View style={[styles.cover,'));
    // Set like a headline, with the tracking pulled in at this size.
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?fontSize: 24,[\s\S]*?letterSpacing: -0\.4,/);
    /*
     * Two lines rather than one: "Sunday lunch at the Kostas'" is a real name
     * for an album, and cutting it at one line loses the end that tells it
     * from every other Sunday lunch.
     */
    expect(CARD).toMatch(/styles\.cardTitle[\s\S]{0,60}numberOfLines=\{2\}/);
    // The 18pt one survives on the card with nothing in it, which has no
    // photograph to be a headline over.
    expect(EVENTS).toMatch(/eventName: \{ fontSize: 18, fontWeight: '700' \}/);
  });

  it('dates and measures the album on a rule above the title', () => {
    /*
     * Two numbers and a date — the label on the outside of the box — set in
     * the one monospaced face in the product, with a hairline running from
     * where the words stop to the edge of the column. The rule is what makes a
     * stack of these read as entries rather than as a feed: every card gets
     * the same top edge whatever length its date is.
     */
    expect(EVENTS).toMatch(
      /const measured = \[date, plural\(event\.photoCount, 'photo'\)\]/,
    );
    expect(EVENTS).toMatch(/measuredText: \{[\s\S]*?ios: 'Menlo', default: 'monospace'/);
    expect(EVENTS).toMatch(/measuredText: \{[\s\S]*?textTransform: 'uppercase',/);
    expect(EVENTS).toMatch(/rule: \{ flex: 1, height: 1 \}/);
    /*
     * And no live chip on the end of it. A coloured dot and the word beside it
     * is the loudest thing on a card whose subject is somebody else's
     * photograph, and the byline already says "added to 20 min ago" in words
     * the reader was going to read anyway.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).not.toMatch(/>\s*live\s*</i);
    expect(CARD).toMatch(/live \? `added to \$\{ago\(/);
  });

  it('shows what is inside as a strip, and says how much it is not showing', () => {
    /*
     * The card led with one photograph and stopped, which asks somebody to
     * open an album to find out whether it is worth opening.
     *
     * Horizontal rather than wrapped: a grid of thumbnails under a cover is
     * the mosaic this card was rewritten to get away from. `slice(1)` because
     * the first entry of `mosaic` is always the photograph the card is already
     * leading with — the server prepends the cover to it, and where there is
     * no cover the lead is `mosaic[0]` drawn larger.
     */
    expect(EVENTS).toMatch(/const sheet = event\.mosaic\.slice\(1\);/);
    expect(EVENTS).toMatch(/const rest = Math\.max\(0, event\.photoCount - sheet\.length\);/);
    expect(EVENTS).toMatch(/sheetTile: \{ width: 76, height: 76 \}/);
    // Full-bleed like the cover above it, with the column's gutter restored
    // inside the scroll so the first tile lines up with the title.
    expect(EVENTS).toMatch(/sheet: \{ marginHorizontal: -20, marginTop: 10 \}/);
    expect(EVENTS).toMatch(/sheetRow: \{ paddingHorizontal: 20, gap: 6 \}/);
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    /*
     * Each tile opens the album. A scroll view takes the touch before the
     * card's own `Pressable` sees it — it has to, or it could not be scrolled
     * — so without this the one part of the card made entirely of photographs
     * would be the one part that does nothing.
     */
    expect(CARD).toMatch(/\{sheet\.map\(\(src\) => \([\s\S]{0,700}<Pressable key=\{src\} onPress=\{onPress\}>/);
    // And it is one stop for a screen reader, not four unnamed images.
    expect(CARD).toMatch(/style=\{styles\.sheet\}[\s\S]{0,200}accessibilityElementsHidden/);
  });
});

describe('switching tabs', () => {
  it('keeps a tab alive rather than unmounting it', () => {
    /*
     * Each tab was `{tab === 'profile' && <ProfileScreen …>}`, which destroys it
     * the moment somebody looks at something else — so switching back threw away
     * what it had fetched, asked again, and sat on a spinner. It also lost the
     * scroll position, which is the part nobody reports and everybody notices.
     */
    expect(APP).toMatch(/visited\.has\('profile'\)/);
    expect(APP).toMatch(/<Pane showing=\{tab === 'profile'\}>/);
    expect(APP).not.toMatch(/\{tab === 'profile' && \(/);
    // Hidden, not laid out: four panes in a column would each get a quarter of
    // the screen.
    expect(APP).toMatch(/paneHidden: \{ display: 'none' \}/);
    expect(APP).toMatch(/pane: \{ position: 'absolute'/);
  });

  it('mounts them lazily, so a cold start fetches one tab and not four', () => {
    expect(APP).toMatch(/useState<ReadonlySet<Tab>>\(\(\) => new Set\(\['home'\]\)\)/);
  });

  it('still refreshes the ones that can go stale, without a spinner', () => {
    /*
     * A kept-alive tab never refetches on its own. Returning to it re-reads
     * quietly: `load` does not clear what it holds first, so the old answer
     * stays on screen until the new one lands.
     */
    expect(APP).toMatch(/active=\{tab === 'profile'\}/);
    expect(APP).toMatch(/active=\{tab === 'groups'\}/);
    for (const source of [PROFILE, EVENTS]) {
      expect(source).toMatch(/if \(active\) void load\(\);/);
    }
    // And neither resets to the empty state before fetching, which is what
    // would put the spinner back on every visit.
    expect(PROFILE).not.toMatch(/setAccount\(undefined\)/);
    expect(EVENTS).not.toMatch(/setGroups\(null\)/);
  });
});

describe('the heading row', () => {
  it('is a title and one `+`, not two words', () => {
    /*
     * The same 36pt bordered circle the Groups tab makes a group with and the
     * album screen adds photographs with. Three tabs, one shape for "make
     * something here".
     */
    expect(HOME).toMatch(/accessibilityLabel="New album or group"/);
    // The product's one piece of round chrome, shared rather than restyled per
    // corner — see `RoundButton`.
    expect(HOME).toMatch(/<RoundButton/);
    expect(HOME).toMatch(/<Glyph name="plus" size=\{20\}/);
    expect(HOME).not.toMatch(/Start one/);
    /*
     * And it offers the same two things the profile's `+` does. One glyph
     * meaning two things in one place and one thing in another is a difference
     * nobody can learn.
     */
    expect(HOME).toMatch(/<StartSomething/);
    expect(HOME).toMatch(/onAlbum=\{onCreate\}/);
    expect(HOME).toMatch(/onGroup=\{onCreateGroup\}/);
  });

  it('no longer sends anybody to a button that is not there', () => {
    // `Open a link` is gone, and so is the empty card's instruction to use it.
    expect(HOME).not.toMatch(/Open a link/);
    expect(HOME).not.toMatch(/onOpenLink/);
    expect(APP).not.toMatch(/onOpenLink=/);
  });
});

describe('the home list', () => {
  it('leaves out the ones with no photographs', () => {
    expect(HOME).toMatch(
      /const filled = events\.filter\(\s*\(event\) => event\.photoCount > 0 \|\| event\.arrivingCount > 0,\s*\);/,
    );
  });

  it('counts what is still being processed as full', () => {
    /*
     * Without `arrivingCount`, adding the first photograph to an album makes
     * it vanish for the minute or so the derivatives take and then come back —
     * which is worse than either state on its own.
     */
    expect(HOME).toMatch(/event\.arrivingCount > 0/);
  });

  it('draws the filtered list, not the whole one', () => {
    // Including the empty state and the spinner: "you have nothing" has to
    // mean the same thing as what the list below it is showing.
    expect(HOME).toMatch(/\{filled\.map\(\(event\) => \(/);
    expect(HOME).toMatch(/\{loading && filled\.length === 0 &&/);
    expect(HOME).toMatch(/\{!loading && filled\.length === 0 && \(/);
    expect(HOME).not.toMatch(/\{events\.map\(/);
  });

  it('is the home tab only', () => {
    /*
     * The groups tab reads the same `events` for the three covers under each
     * group's name, and a group whose evenings have not happened yet should
     * still be a room you can walk into.
     */
    const GROUPS = code(
      EVENTS.slice(EVENTS.indexOf('export function GroupsTab'), EVENTS.indexOf('function GroupBlock')),
    );
    expect(GROUPS).not.toMatch(/photoCount > 0/);
  });

  it('still lands you inside an album you have just made', () => {
    /*
     * This hides your own empty albums too, so the create flow must not depend
     * on the list: `onCreated` opens the event rather than returning to it —
     * and hands it the photographs the form is holding, so the album it lands
     * on is filling rather than empty.
     */
    expect(APP).toMatch(/onCreated=\{\(created, photos\) => \{[\s\S]{0,260}void open\(/);
    expect(APP).toMatch(/photos\.map\(\(photo\) => photo\.id\)/);
  });
});

/**
 * A byline is a person, so pressing one opens them.
 *
 * Two of them: the face and handle above a card on the home list, which is
 * whoever made the album, and the one on each photograph inside an album, which
 * is whoever added that picture. Both were the only things in the product that
 * named somebody and could not be pressed.
 */
describe('pressing a byline', () => {
  it('opens the person on a home card', () => {
    expect(EVENTS).toMatch(/onOpenPerson\(event\.creator\.handle!\)/);
    expect(APP).toMatch(/<HomeTab[\s\S]{0,600}onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
  });

  it('opens the person on a photograph', () => {
    expect(APP).toMatch(/onOpenPerson\(who\.handle!\)/);
    expect(APP).toMatch(/<EventScreen[\s\S]{0,900}onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
  });

  it('leaves the rest of each surface doing what it did', () => {
    /*
     * Nested inside the `Pressable` that was already there, which is what makes
     * both work: the inner one takes the touch when it lands on the face or the
     * name, the outer one takes everything else. The card still opens the
     * album and the row still opens the photograph.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    // Comments stripped: the prose between the two explains the nesting, and
    // 400 characters of it is longer than the markup being checked.
    expect(code(CARD)).toMatch(/<Pressable onPress=\{onPress\}[\s\S]{0,900}<Pressable/);
    // And the photograph's byline stopped being untouchable for exactly this.
    const tile = APP.slice(APP.indexOf('style={styles.tileBy}') - 400, APP.indexOf('style={styles.tileBy}'));
    expect(tile).not.toMatch(/pointerEvents="none"[\s\S]{0,40}tileBy/);
  });

  it('offers nothing where there is no profile to open', () => {
    /*
     * Somebody who arrived by link has a name and a face and no handle. A
     * control that does nothing is worse than a label that never offered, so
     * both are disabled and neither claims to be a button.
     */
    expect(EVENTS).toMatch(/disabled=\{!event\.creator\.handle\}/);
    expect(APP).toMatch(/disabled=\{!who\.handle\}/);
    expect(EVENTS).toMatch(/accessibilityRole=\{event\.creator\.handle \? 'button' : 'text'\}/);
    expect(APP).toMatch(/accessibilityRole=\{who\.handle \? 'button' : 'text'\}/);
  });
});
