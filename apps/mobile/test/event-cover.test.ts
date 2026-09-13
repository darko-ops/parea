/**
 * The event cover on mobile, which existed but could not be seen.
 *
 * Setting one and removing one were both already wired: the create screen
 * uploads a cover with the event, and the event screen had a button that
 * offered "Choose a photo" and "Remove it". What it did not do was *show* the
 * cover. So "Event cover" meant "there may or may not be one, press to find
 * out", "Remove it" was offered on events with nothing to remove, and after
 * choosing a picture nothing on the screen moved — the only way to learn
 * whether it took was to leave the event and come back.
 *
 * The three rules below are the fix, and each of them is the sort of thing a
 * later edit removes without noticing, because the screen still looks right in
 * a simulator with a cover already set.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const API = read('src/api.ts');

/** The handler, without the rest of a 2000-line screen. */
const COVER = APP.slice(APP.indexOf('const editCover'), APP.indexOf('if (autoWindow)'));

/**
 * The row that opens it.
 *
 * It is inside the `⋯` sheet now rather than stacked on the screen above the
 * photographs — one of the eight slabs that moved there. What it draws and who
 * may draw it are unchanged, which is what the rest of this file checks.
 */
const ROW = APP.slice(
  APP.indexOf('function HostSheet'),
  APP.indexOf('Who can see it, changeable here'),
);

describe('the cover the event already has', () => {
  it('arrives on the feed, so the screen can draw it', () => {
    /*
     * The card's mosaic leads with the cover, which is how it reaches the home
     * screen — but a mosaic entry is a photograph that happens to be first,
     * indistinguishable from the newest upload. The event screen needs to know
     * whether a cover is *set*, which is a different question, so the feed
     * answers it directly.
     */
    expect(API).toMatch(/coverUrl: string \| null/);
  });

  it('is drawn on the event screen, not only described', () => {
    // The one setting on this screen whose value is an image. Described in
    // words it is a setting you have to remember rather than read.
    expect(ROW).toMatch(/source=\{\{ uri: cover \}\}/);
    expect(ROW).toMatch(/styles\.coverEmpty/);
  });

  it('offers removal only when there is something to remove', () => {
    /*
     * The endpoint treats a DELETE against an event with no cover as a no-op,
     * so the old unconditional "Remove it" was harmless — and still wrong. A
     * destructive-styled button that does nothing teaches people that the red
     * text on this screen is decorative.
     *
     * `chosenCover` rather than `cover` since the fallback below landed, and
     * the distinction is the whole point of there being two names: offering to
     * remove a cover nobody set is the same bug in a new disguise.
     */
    expect(COVER).toMatch(/if \(chosenCover\) \{[\s\S]*?text: 'Remove it'/);
    expect(COVER).not.toMatch(/if \(cover\) \{/);
    expect(COVER).toMatch(/text: chosenCover \? 'Choose a different photo'/);
  });

  it('falls back to the first photograph when nobody chose one', () => {
    /*
     * This reverses a rule that used to be written into the header — "never a
     * photograph pulled out of the grid, that is a decision about which evening
     * this was, made by an upload's timestamp".
     *
     * The objection was about *which* photograph, and it has been answered: the
     * picker fixes the order now, so the one leading the grid is the one
     * somebody put first rather than whichever phone finished uploading first.
     * Borrowing it reads a decision instead of inventing one — and the album it
     * replaces was a coloured letter on a screen full of photographs.
     *
     * `card` before `src` because the header is the width of the screen, and
     * the 320 is only what exists before the deriver has run.
     */
    expect(APP).toMatch(
      /const cover = chosenCover \?\? feed\?\.photos\[0\]\?\.card \?\? feed\?\.photos\[0\]\?\.src \?\? null;/,
    );
    // And the header draws that one, so the sheet's row and the screen behind
    // it can never disagree about what the album leads with.
    expect(APP).toMatch(/<View style=\{styles\.cover\}>\s*\{cover \? \(/);
  });

  it('says nothing under the row about what a cover is', () => {
    /*
     * The row *is* the photograph, at the size the album draws it. "What this
     * event leads with everywhere" was a sentence explaining a picture sitting
     * two inches from it, and the words were longer than the thing they
     * described.
     */
    expect(ROW).not.toMatch(/What this event leads with|Leading with its newest/);
    expect(ROW).toMatch(/Event cover/);
  });
});

describe('after the change', () => {
  it('re-reads the feed, both ways', () => {
    /*
     * Twice, because the two paths fail differently and only one of them is
     * ever exercised by hand: everybody tests choosing a photograph, and
     * almost nobody tests removing one.
     *
     * `refresh` swallows its own errors rather than throwing, which is why
     * awaiting it inside the `try` does not turn a failed reload into "Could
     * not remove the cover".
     */
    const refreshes = COVER.match(/await refresh\(\)/g) ?? [];
    expect(refreshes).toHaveLength(2);
  });

  it('leaves the home screen to `onBack`', () => {
    // The cards there are stale the moment a cover changes, and re-reading the
    // whole event list from inside the event to fix a thumbnail nobody is
    // looking at is a request for the sake of tidiness. Going back already
    // reloads it.
    //
    // `leaveEvent` rather than an inline handler since the swipe landed: the
    // arrow and the gesture are two ways out of the same screen and they have
    // to refresh the same list, so there is one callback and both take it.
    expect(APP).toMatch(
      /const leaveEvent = useCallback\(\(\) => \{\s*void refreshEvents\(\);/,
    );
    expect(APP).toMatch(/onBack=\{leaveEvent\}/);
    expect(APP).toMatch(/<SwipeBack onBack=\{leaveEvent\}>/);
  });
});

describe('who sees it', () => {
  it('is the host and nobody else', () => {
    // It changes what everybody else's home screen shows, which is the same
    // reason the web keeps it on the manage screen rather than on the event.
    expect(APP).toMatch(/const host = feed\?\.event\.canAdminister === true;/);
    expect(ROW).toMatch(/\{host && \(\s*<Pressable/);
  });
});
