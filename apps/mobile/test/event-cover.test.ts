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
     */
    expect(COVER).toMatch(/if \(cover\) \{[\s\S]*?text: 'Remove it'/);
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
    expect(APP).toMatch(/onBack=\{\(\) => \{\s*void refreshEvents\(\);/);
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
