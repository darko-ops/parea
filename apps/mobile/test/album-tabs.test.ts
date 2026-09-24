/**
 * One head over all three of an album's tabs, and a grid that is not soft.
 *
 * Two things that were wrong on the album screen and are unrelated except that
 * both are about what you see when you open one.
 *
 * The photographs had the cover; the conversation and the roster had a
 * folded-up version of it — a 38pt thumbnail, the name and a count, on a bar.
 * So moving between an album's own tabs rebuilt the top of the screen and the
 * album read as a different screen depending on which tab was up.
 *
 * And the grid was drawing the 320px thumbnail into a tile a third of a phone
 * wide, which is 390 device pixels on every 3× iPhone — a quality-72 JPEG
 * scaled *up* by a fifth, which is the blur people reported.
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
const THREAD = read('src/Thread.tsx');
const VIEWER = read('src/PhotoViewer.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The screen, without the rest of the file. */
const SCREEN = code(
  APP.slice(APP.indexOf('function EventScreen'), APP.indexOf('function Segmented')),
);

describe('one header, three panes', () => {
  it('does not choose a header off the pane', () => {
    /*
     * The tell for the old shape was the cover being inside a `pane ===
     * 'photos'` branch. It is unconditional now, and the ternary that is left
     * chooses only what goes *below* the tabs.
     */
    expect(SCREEN).not.toMatch(/\{pane === 'photos' \? \(\s*<>\s*\{?\/?\*?[\s\S]{0,200}StatusBar/);
    // The cover, the title and the page are all reached without asking.
    const beforeSwitch = SCREEN.slice(0, SCREEN.indexOf("{pane === 'photos' ? ("));
    expect(beforeSwitch).toMatch(/styles\.cover\b/);
    expect(beforeSwitch).toMatch(/styles\.coverTitle/);
    expect(beforeSwitch).toMatch(/styles\.coverBack/);
    expect(beforeSwitch).toMatch(/styles\.page/);
    expect(beforeSwitch).toMatch(/styles\.tabRow/);
  });

  it('has no second, folded-up header left in it', () => {
    // The compact bar and everything only it used.
    for (const gone of [
      'styles.head,',
      'styles.headRow',
      'styles.headThumb',
      'styles.headName',
      'styles.headMeta',
      'styles.headTabs',
    ]) {
      expect(SCREEN).not.toContain(gone);
    }
  });

  it('switches only what is under the tabs', () => {
    // The three panes, chosen inside the page rather than around it.
    expect(SCREEN).toMatch(/\{pane === 'photos' \? \([\s\S]*?\) : pane === 'talk' \? \([\s\S]*?\) : \(/);
    expect(SCREEN).toMatch(/<People\s*\n\s*roster=/);
    expect(SCREEN).toMatch(/<Thread/);
  });

  it('keeps the composer off the keyboard now that the pane starts lower', () => {
    /*
     * `KeyboardAvoidingView` measures its own frame from `onLayout`, which is
     * relative to its parent — and the thread's parent is now pinned below the
     * cover rather than at the top of the screen. Without the offset the
     * composer is lifted by exactly the height of the header too little.
     */
    /*
     * The number moved when the header got shorter, which is the point of it
     * being a name: `PAGE_TOP` is the header's height, the page is pinned to
     * it, and the offset is the same value rather than a third copy of it.
     */
    expect(APP).toMatch(/const PAGE_TOP = COVER;/);
    expect(APP).toMatch(/page: \{ position: 'absolute', top: PAGE_TOP,/);
    expect(SCREEN).toMatch(/keyboardOffset=\{PAGE_TOP\}/);
    expect(THREAD).toMatch(/keyboardVerticalOffset=\{keyboardOffset\}/);
  });

  it('keeps the new-message banner to the photographs', () => {
    // On the conversation it would announce what is directly beneath it, and
    // on the roster it would sit over the first two people.
    expect(SCREEN).toMatch(/\{pane === 'photos' && latest && unread > 0 && !bannerGone/);
  });
});

describe('the corners', () => {
  it('are the same disc as every other corner in the product', () => {
    /*
     * Back was `‹ All events` — words on a photograph with nothing behind them
     * — and the options were a dark blur circle. The blur was the careful
     * answer to sitting on somebody's picture, and its trouble is that it only
     * works while the ink is white, so these two could never match the two on
     * the profile.
     */
    expect(SCREEN).toMatch(/<RoundButton[\s\S]{0,160}styles\.coverBack/);
    expect(SCREEN).toMatch(/<RoundButton[\s\S]{0,160}styles\.coverMore/);
    expect(SCREEN).toMatch(/<Back color=\{t\.fg\} \/>/);
    expect(SCREEN).toMatch(/<More color=\{t\.fg\} \/>/);
    // The blur and its white glyph are gone with it.
    expect(APP).not.toMatch(/coverMoreBlur|coverMoreGlyph|coverBackText/);
  });

  it('says nothing about where back goes', () => {
    // Which is the one thing a back button never needs to say.
    expect(SCREEN).not.toMatch(/‹ All events/);
  });

  it('sit level with each other, and lower than either was', () => {
    // They were at 46 and 40 — close enough to look like a mistake rather than
    // a decision.
    expect(APP).toMatch(/coverBack: \{ position: 'absolute', top: 52, left: 16/);
    expect(APP).toMatch(/coverMore: \{ position: 'absolute', top: 52, right: 16/);
  });
});

describe('the two views', () => {
  /*
   * Both of these shipped at different times as *the* view, and the argument
   * for each was right about a different moment.
   *
   * The contact sheet went first: three columns of 121pt squares is good for
   * finding a photograph you already know is in there, nothing like looking at
   * one, and every square was a crop since `cover` on a 1:1 tile takes the ends
   * off anything shot in portrait. The column replaced it whole, and this file
   * asserted the sheet was gone.
   *
   * Which was right about opening an album for the first time and wrong about
   * opening one you have already seen, where you are looking for one particular
   * picture among two hundred. So both are here, a swipe apart, and what these
   * check is that neither has quietly become the other.
   */
  it('keeps the column at one photograph per row', () => {
    expect(APP).toMatch(/thumb: \{ width: '100%', aspectRatio: 4 \/ 5/);
    // Edge to edge, as the home cards are.
    expect(APP).toMatch(/gridContent: \{ paddingBottom: 12, gap: PHOTO_GAP \}/);
  });

  it('puts the grid back beside it, three across', () => {
    expect(APP).toMatch(/const GRID_COLUMNS = 3;/);
    expect(SCREEN).toMatch(/numColumns=\{GRID_COLUMNS\}/);
    expect(SCREEN).toMatch(/columnWrapperStyle=\{styles\.gridRow\}/);
    /*
     * Square, which is the trade a contact sheet makes — and sized rather than
     * flexed.
     *
     * The tile was `flex: 1`, which is right for every row but the last one and
     * wrong there: `numColumns` does not pad a short final row, so an album of
     * seven ended with a single tile taking the whole width of the screen, a
     * square the size of three at the foot of the sheet. A width makes the last
     * row start at the left and stop where it runs out, which is what a grid
     * does.
     */
    expect(APP).toMatch(
      /const gridTile = \(width - PHOTO_GAP \* \(GRID_COLUMNS - 1\)\) \/ GRID_COLUMNS;/,
    );
    expect(APP).toMatch(/style=\{\{ width: gridTile, height: gridTile \}\}/);
    expect(APP).toMatch(/gridShot: \{ width: '100%', height: '100%'/);
    expect(APP).not.toMatch(/gridTile: \{ flex: 1 \}/);
  });

  it('is the only way of looking, and it is the grid', () => {
    /*
     * There were two, a horizontal pager apart: this grid, and a column of
     * full-width photographs. Both answered "how do I look at this" at
     * different sizes, and looking at one photograph has a screen of its own
     * now — full bleed, pinch, and a swipe between pictures — which is what
     * the column was standing in for.
     *
     * There is a pager here again and it is not that one. Its second page is
     * the same grid over a different set: everything, or what this person
     * kept. One page answers "what is in here" and the other "what did I keep
     * of it", which are two questions rather than one question twice.
     */
    expect(SCREEN).toMatch(/renderItem=\{renderTile\}/);
    expect(SCREEN).not.toMatch(/renderColumn|columnList|columnLayout/);
    expect(APP).not.toMatch(/useState<'grid' \| 'column'>/);
    // Both pages draw the same tile, which is what says they are one view of
    // two sets rather than two views.
    expect((SCREEN.match(/renderItem=\{renderTile\}/g) ?? []).length).toBe(2);
    expect(SCREEN).toMatch(/data=\{kept\}/);
  });

  it('keeps the shortlist to a filter over what is already in hand', () => {
    /*
     * `favourite` is on every photograph the feed returns, so the second page
     * is a pass over a list already loaded. A request of its own would be a
     * second source of truth about the same album, and would lag the star by
     * a round trip.
     */
    expect(APP).toMatch(/\(feed\?\.photos \?\? \[\]\)\.filter\(\(photo\) => photo\.favourite\)/);
  });

  it('keeps the layout the grid needs to be scrolled into', () => {
    // `getItemLayout` lets the list be sent to an index it has not drawn. It
    // survives the column because it was never the column's.
    expect(SCREEN).toMatch(/getItemLayout=\{gridLayout\}/);
  });

  it('spaces the grid by one number', () => {
    // `getItemLayout` adds the gap to a row's height, so the number the
    // layout promises and the number the tiles take have to be one value.
    expect(APP).toMatch(/const PHOTO_GAP = 3;/);
    expect(APP).toMatch(/gridRow: \{ gap: PHOTO_GAP, justifyContent: 'flex-start' \}/);
    /*
     * And the row height the layout promises is the one the tiles actually
     * take. It was `width / 3 + PHOTO_GAP` against an actual `(width - 2 *
     * PHOTO_GAP) / 3` — five points of drift per row, compounding down a long
     * album until `scrollToIndex` landed somewhere else.
     */
    expect(APP).toMatch(/const gridRowHeight = gridTile \+ PHOTO_GAP;/);
  });



  it('says whose photograph each one is, on the tile and in the viewer', () => {
    /*
     * The column carried a face and a handle beside every row; the grid
     * attributed none of them. With the column gone the tile keeps the face —
     * a contact sheet of two hundred photographs by five people is five
     * colours repeating down it, and that pattern is legible long before any
     * single face is — and the handle moved to the viewer, which is the only
     * screen with room for one.
     */
    expect(APP).toMatch(/const who = item\.by \? byline\.get\(item\.by\) : undefined;/);
    expect(APP).toMatch(/styles\.gridFace/);
    expect(VIEWER).toMatch(/\{uploader\.handle \?\? uploader\.name\}/);
  });

  it('draws those faces as rounded squares, like every other face', () => {
    /*
     * A quarter of the box, which is the proportion the profile's own picture
     * sets at 104 by 26 and the home card's byline repeats at 28 by 7. One
     * decision at four sizes rather than four.
     *
     * The album's face was a circle, and the album is reached *from* the card
     * that draws the same person square — two shapes for one thing, a screen
     * apart.
     */
    /*
     * The column's 24pt face went with the column. The proportion did not:
     * the viewer's square is 34 by 9, which is the same quarter at the size
     * that screen draws one.
     */
    expect(APP).toMatch(/gridFace: \{ width: 16, height: 16, borderRadius: 4 \}/);
    expect(VIEWER).toMatch(/whoFace: \{ width: 34, height: 34, borderRadius: 9/);
    const EVENTS = read('src/Events.tsx');
    expect(EVENTS).toMatch(/bylineFace: \{ width: 28, height: 28, borderRadius: 7/);
    /*
     * The overlapping crowd over a cover stays circular: that row only reads as
     * a crowd because the circles overlap, which squares do not do.
     */
    expect(EVENTS).toMatch(/borderRadius: 12,\s*\n\s*borderWidth: 1\.5,\s*\n\s*marginRight: -6,/);
  });

  it('draws the 1280 on the screen that is now full width', () => {
    /*
     * `grid` is the 1280 rendition, named for the view it was added for — a
     * column row was the width of the screen, which the 640 `card` cannot fill
     * on a 3× phone without being scaled up.
     *
     * That row is gone and the rendition is not wasted: the viewer opens on it
     * while the 2560 loads, which is the same argument at the same size. The
     * tiles stay on `card`, which is what a third of a screen actually needs.
     */
    expect(APP).toMatch(/item\.card \?\? item\.src/);
    expect(VIEWER).toMatch(/photo\.grid|photo\.full/);
  });

  it('still has something to draw before the deriver has run', () => {
    // Both are null until the derivatives exist, and `src` is then the only
    // thing there is.
    expect(API).toMatch(/card: string \| null/);
    expect(API).toMatch(/grid: string \| null/);
  });

  it('leaves the one being looked at on the 2560', () => {
    // The viewer was never the problem and is not re-pointed at a smaller
    // rendition. It lives in its own file now; the album only opens it.
    const VIEWER = read('src/PhotoViewer.tsx');
    expect(VIEWER).toMatch(/source=\{\{ uri: photo\.full \}\}/);
    expect(VIEWER).toMatch(/contentFit="contain"/);
  });
});
