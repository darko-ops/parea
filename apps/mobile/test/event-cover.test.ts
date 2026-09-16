/**
 * The event cover on mobile, which existed but could not be seen.
 *
 * Setting one and removing one were both already wired: the create screen
 * uploads a cover with the event, and the event screen had a button that
 * offered "Choose a photo" and "Remove it". What it did not do was *show* the
 * cover. So the row meant "there may or may not be one, press to find
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
/*
 * From `sendCover` to the next unrelated thing on the screen, which is now five
 * callbacks rather than two: the upload, gathering what the album can be
 * fronted by, sending one of those, opening the frame, and taking the cover
 * off. They are contiguous on purpose — a cover is one subject.
 */
const COVER = APP.slice(APP.indexOf('const sendCover'), APP.indexOf('if (autoWindow)'));

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
     * so an unconditional "Remove" is harmless — and still wrong. A
     * destructive-styled control that does nothing teaches people that the red
     * text on this screen is decorative.
     *
     * It is its own row under the picture now rather than the second action in
     * an alert: the ordinary action goes straight to the frame, so there is no
     * alert left to keep the rare one a press behind. Null rather than a
     * disabled row — offering to undo something nobody did is the same bug in
     * a new disguise.
     */
    expect(APP).toMatch(/onRemoveCover=\{feed\?\.event\.coverUrl \? removeCover : null\}/);
    expect(ROW).toMatch(/\{host && onRemoveCover && \(/);
    expect(ROW).toMatch(/Remove cover/);
    // And it asks before it acts, which the alert's `destructive` style used
    // to be doing on its behalf.
    expect(COVER).toMatch(/Alert\.alert\(\s*'Remove the cover\?'/);
  });

  it('opens the frame on the album, not on the camera roll', () => {
    /*
     * The cover row used to open an alert whose first action opened the camera
     * roll — so "change the cover" meant "choose another picture", every time,
     * from a screen that could not show what the cover currently was or where
     * it sat. Nudging an existing cover a little to the left was not something
     * the product could do at all.
     *
     * It opens the frame directly now, on the photograph the cover was cut
     * from, at the position it was left at, with the rest of the album
     * underneath to try instead.
     */
    expect(APP).toMatch(/coverId=\{feed\?\.event\.coverPhotoId \?\? coverChoices\[0\]!\.id\}/);
    expect(APP).toMatch(/initial=\{feed\?\.event\.coverFraming \?\? undefined\}/);
    expect(APP).toMatch(/photos=\{coverChoices\}/);
    /*
     * `full` rather than the thumbnail the strip draws: a tile is 320 pixels
     * across and a cover cut from it would be a cover of a thumbnail.
     */
    expect(COVER).toMatch(/full: photo\.full,/);
    /*
     * An album with nothing in it has nothing to offer, so that one still
     * opens the library — it is the only picture there could be.
     */
    expect(COVER).toMatch(/if \(coverChoices\.length > 0\) \{\s*\n\s*setFramingAlbum\(true\);/);
    expect(COVER).toMatch(/launchImageLibraryAsync/);
  });

  it('keeps the photograph’s bytes off the origin', () => {
    /*
     * Down from storage and back up, rather than a "make the cover out of photo
     * X" endpoint. `apps/web/src/storage/index.ts` opens by saying in capitals
     * that the app tier is handed a storage client with no method that returns
     * bytes, so that no photograph is ever routed through the Next.js origin —
     * and such an endpoint would be exactly that route. The download here is
     * client ↔ storage, straight to a presigned URL.
     */
    expect(COVER).toMatch(/await fetchForCover\(photo\.full, photoId\)/);
    expect(COVER).toMatch(/await sendCover\(file\.uri, framing, photoId\)/);
    const PLATFORM = read('src/platform.ts');
    expect(PLATFORM).toMatch(/export async function fetchForCover/);
    // One upload's worth of file, in the cache, deleted either way.
    expect(PLATFORM).toMatch(/new File\(Paths\.cache, `parea-cover-\$\{id\}\.jpg`\)/);
    expect(COVER).toMatch(/file\?\.delete\(\)/);
  });

  it('records what the cover was cut from, so the frame can reopen on it', () => {
    /*
     * Nothing about the finished JPEG says which photograph it came from or
     * where the window sat — it is the *result* of applying them. Without the
     * four columns, every visit to the frame would start from nothing.
     */
    const SCHEMA = readFileSync(
      fileURLToPath(new URL('../../../packages/core/src/schema.ts', import.meta.url).href),
      'utf8',
    );
    expect(SCHEMA).toMatch(/coverPhotoId: uuid\('cover_photo_id'\)/);
    expect(SCHEMA).toMatch(/coverX: real\('cover_x'\)/);
    // `set null`, because a cover outlives the photograph it was cut from.
    expect(SCHEMA).toMatch(/cover_photo_id'\)\.references\([\s\S]{0,80}onDelete: 'set null'/);
    expect(API).toMatch(/coverPhotoId: string \| null/);
    expect(API).toMatch(/if \(photoId\) query\.set\('photo', photoId\)/);
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
    expect(ROW).toMatch(/Album cover/);
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

  it('frames a picked photograph before sending it', () => {
    /*
     * The frame the create screen offers was missing from the one screen
     * somebody opens *because* the cover is wrong. Before, not after: there is
     * no undo on a cover, so an unframed upload is the version everybody else
     * sees until it is replaced.
     */
    expect(APP).toMatch(/setFramingCover\(picked\.assets\[0\]\.uri\)/);
    expect(APP).toMatch(/<CoverFramer/);
    expect(APP).toMatch(/void sendCover\(uri, framing\)/);
    // And the id goes with it where there is one, so next time the frame
    // reopens on this picture rather than on nothing.
    expect(APP).toMatch(/void sendAlbumCover\(id, framing\)/);
    // And nothing is sent if the frame is backed out of.
    expect(APP).toMatch(/onCancel=\{\(\) => setFramingCover\(null\)\}/);
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
