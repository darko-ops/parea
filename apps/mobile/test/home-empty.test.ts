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

  it('lines the faces and the live tag up with the title', () => {
    // While the cover was an inset card, an offset from its corner was the
    // obvious reference. Against a full-bleed photograph the only column left
    // to align with is the text underneath.
    expect(EVENTS).toMatch(/faces: \{ flexDirection: 'row', marginTop: -13, marginLeft: 4/);
    expect(EVENTS).toMatch(/under: \{ paddingHorizontal: 4/);
    expect(EVENTS).toMatch(/liveTag: \{\s*position: 'absolute',\s*(?:\/\/[^\n]*\n\s*)*left: 24,/);
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
