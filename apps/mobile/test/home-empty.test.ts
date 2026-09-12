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
    expect(EVENTS).toMatch(/cover: \{ marginHorizontal: -20, overflow: 'hidden', height: 260/);
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
    expect(EVENTS.indexOf('styles.byline}')).toBeLessThan(EVENTS.indexOf('<View style={styles.cover}>'));
  });

  it('draws a letter rather than a silhouette where there is no picture', () => {
    // The rule every other face in this product follows.
    expect(EVENTS).toMatch(/styles\.bylineBlank/);
    expect(EVENTS).toMatch(/const byLens = lensFor\(/);
  });

  it('says the handle once, not twice', () => {
    /*
     * The line under the title used to print both names. The byline carries
     * the handle now, so repeating it there said the same unique thing twice
     * on one card and left the name reading as a label for it. What survives
     * below is the half the byline does not have: what somebody is called.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    /*
     * Counted on what is *drawn*, not on how often the field is read: the
     * byline also keys a lens off the handle and falls back to it for the
     * initial, and neither of those puts it on the screen.
     */
    const under = CARD.slice(CARD.indexOf('<View style={styles.under}>'));
    expect(under).not.toMatch(/creator\.handle/);
    expect(CARD.match(/\{by\}/g) ?? []).toHaveLength(1);
    expect(CARD).toMatch(/\{host && \(/);
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
    expect(EVENTS).toMatch(/byline: \{[^}]*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/faces: \{ flexDirection: 'row', marginTop: -13, marginLeft: -4/);
    expect(EVENTS).toMatch(/under: \{ marginHorizontal: -4/);
    // The tag rides on the photograph, so it is placed from the glass direct.
    expect(EVENTS).toMatch(/liveTag: \{\s*position: 'absolute',\s*(?:\/\/[^\n]*\n\s*)*left: 16,/);
  });

  it('puts the creator’s name before the title, and quiets the title', () => {
    /*
     * Whose evening it was is the first thing read off the card: the picture
     * at the top is theirs, and both ends being about the same person is what
     * makes the middle an evening rather than a listing.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    const under = CARD.slice(CARD.indexOf('<View style={styles.under}>'));
    expect(under.indexOf('{host}')).toBeLessThan(under.indexOf('{event.name}'));
    // No longer the first thing on the card, so no longer set like it.
    expect(EVENTS).toMatch(/eventName: \{ fontSize: 18, fontWeight: '700' \}/);

    /*
     * And on one line, as one sentence.
     *
     * Nested `Text` rather than a row: inside a single `Text` the baseline is
     * the text engine's problem, where a flex row would need telling both how
     * to align a 13pt name against an 18pt title and which of the two may
     * shrink. `numberOfLines` on the outer one truncates the line as a line,
     * so a long title runs out of room rather than squeezing the name.
     */
    expect(under).toMatch(
      /<Text numberOfLines=\{1\}>\s*\{host && \([\s\S]*?\{event\.name\}<\/Text>\s*<\/Text>/,
    );
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
    expect(HOME).toMatch(/accessibilityLabel="Start an event"/);
    expect(HOME).toMatch(/styles\.newGroup/);
    expect(HOME).toMatch(/<Glyph name="plus" size=\{20\}/);
    expect(HOME).not.toMatch(/Start one/);
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
     * on the list: `onCreated` opens the event rather than returning to it.
     */
    expect(APP).toMatch(/onCreated=\{\(created\) => \{[\s\S]{0,200}void open\(\{/);
  });
});
