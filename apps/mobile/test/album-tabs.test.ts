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
    expect(SCREEN).toMatch(/<People roster=/);
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

  it('opens on the grid, and the grid is the left-hand page', () => {
    // Somebody opening an album they have already seen is looking for a
    // particular photograph, and a screenful of nine beats a screenful of one.
    expect(APP).toMatch(/useState<'grid' \| 'column'>\('grid'\)/);
    const pager = SCREEN.slice(SCREEN.indexOf('ref={pager}'));
    expect(pager.indexOf('renderItem={renderTile}')).toBeLessThan(
      pager.indexOf('renderItem={renderColumn}'),
    );
  });

  it('spaces both views by the same number', () => {
    // A gap that differed between them would read as the swipe having changed
    // the spacing rather than the layout — and `getItemLayout` adds it to a
    // row's height, so the two have to agree by construction.
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

  it('lands on the same photographs it left', () => {
    /*
     * A swipe at photograph 90 of 200 arriving at the top of the other view
     * reads as the gesture having reloaded the album. `getItemLayout` on both
     * is what lets either be scrolled to an index it has not drawn yet.
     */
    expect(APP).toMatch(/list\.scrollToIndex\(\{ index: anchor\.current, animated: false \}\)/);
    expect(SCREEN).toMatch(/getItemLayout=\{gridLayout\}/);
    expect(SCREEN).toMatch(/getItemLayout=\{columnLayout\}/);
    expect(SCREEN).toMatch(/onViewableItemsChanged=\{onSeen\}/);
  });

  it('names the two views with a drawing of each, and lets you press one', () => {
    /*
     * It was two 4pt bars with the one you were on filled — an indicator
     * rather than a control, on the reasoning that the gesture is the swipe
     * and this only had to say the swipe existed. It never did say that: a
     * short mark under a row of tabs reads as a tab underline, which is a
     * thing that *reports* where you are, so nobody learned there was a second
     * view to reach.
     *
     * Each glyph is a small drawing of the layout it opens. The literal icon
     * is the right one here for once: both views hold the same photographs and
     * differ only in how they are laid out, so a diagram of the layout is a
     * complete description of the difference.
     */
    const GLYPH = read('src/Glyph.tsx');
    expect(GLYPH).toMatch(/case 'grid':/);
    expect(GLYPH).toMatch(/case 'portrait':/);
    // Four squares, not nine: a 3×3 at 18 points is a texture, not a grid.
    expect((GLYPH.match(/<Rect x=\{(?:4|13)\} y=\{(?:4|13)\} width=\{7\} height=\{7\}/g) ?? []))
      .toHaveLength(4);

    expect(APP).toMatch(/\['grid', 'grid', 'Grid'\]/);
    expect(APP).toMatch(/\['column', 'portrait', 'One at a time'\]/);
    expect(APP).toMatch(/onPress=\{\(\) => showView\(which\)\}/);
    // Still says which one you are on, in the pairing the tab bubble uses.
    expect(APP).toMatch(/color=\{view === which \? t\.fg : t\.dim\}/);
    expect(APP).toMatch(/weight=\{view === which \? 2\.4 : 1\.8\}/);
    // A target rather than a picture: 34 against an 18pt glyph.
    expect(APP).toMatch(/viewSegment: \{ flex: 1, height: 34/);
    expect(APP).not.toMatch(/viewBar: \{ backgroundColor/);
  });

  it('presses and swipes into the same code path', () => {
    /*
     * The button scrolls the pager rather than setting the state directly, so
     * the animation lands on `onPaged` — which is what carries the anchor
     * across to the list arriving. Otherwise the press would be a shortcut that
     * skipped the half of the work somebody would notice missing.
     */
    expect(APP).toMatch(
      /pager\.current\?\.scrollTo\(\{ x: which === 'column' \? width : 0, animated: true \}\)/,
    );
    const SHOW = APP.slice(APP.indexOf('const showView ='), APP.indexOf('const onPaged ='));
    expect(SHOW).not.toMatch(/setView\(/);
  });

  it('says whose photograph each one is, in both views', () => {
    /*
     * The column has said it for a while — a face and a handle in the top-left
     * corner. The grid said nothing, which is the view that makes the question
     * hardest to answer: a contact sheet of two hundred photographs by five
     * people gives no clue which are whose.
     *
     * The face alone there, because a tile is a third of the screen and a
     * handle does not fit — at 129 points "kostopoulou" is either four pixels
     * tall or most of the picture. What survives is the part that works at
     * that size: five colours repeating down a sheet is a pattern legible long
     * before any single face is.
     */
    expect(APP).toMatch(/gridFace: \{ width: 16, height: 16, borderRadius: 4 \}/);
    const TILE = APP.slice(APP.indexOf('const renderTile'), APP.indexOf('const renderColumn'));
    expect(TILE).toMatch(/const who = item\.by \? byline\.get\(item\.by\) : undefined;/);
    // The letter on their own lens where there is no picture, which is the
    // rule every face in this product follows — never a silhouette.
    expect(TILE).toMatch(/backgroundColor: lensFor\(who\.key\)\.fill/);
    // And no handle beside it.
    expect(TILE).not.toMatch(/who\.handle/);
    /*
     * Decoration, not a control. A 16pt target inside a 129pt tile is a place
     * where the tile stops opening the photograph for no reason a thumb can
     * predict.
     */
    expect(TILE).toMatch(/<View pointerEvents="none" style=\{styles\.gridBy\}>/);
    /*
     * And it holds its own edge. The column's face needs no shadow because its
     * handle has one and the two read together; alone on a bright sky a pale
     * avatar is a smudge. On the wrapper rather than the image, so the picture
     * keeps its clipped corners while the shadow falls outside them.
     */
    expect(APP).toMatch(/gridBy: \{[\s\S]*?shadowOpacity: 0\.35,/);
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
    expect(APP).toMatch(/tileFace: \{ width: 24, height: 24, borderRadius: 6 \}/);
    expect(APP).toMatch(/gridFace: \{ width: 16, height: 16, borderRadius: 4 \}/);
    const EVENTS = read('src/Events.tsx');
    expect(EVENTS).toMatch(/bylineFace: \{ width: 28, height: 28, borderRadius: 7/);
    /*
     * The overlapping crowd over a cover stays circular: that row only reads as
     * a crowd because the circles overlap, which squares do not do.
     */
    expect(EVENTS).toMatch(/borderRadius: 12,\s*\n\s*borderWidth: 1\.5,\s*\n\s*marginRight: -6,/);
  });

  it('draws the 1280 now that a row is the whole screen', () => {
    // 393 points is 1179 device pixels on a 3× phone, which the 640 that was
    // right for a third of a row cannot fill.
    expect(SCREEN).toMatch(/source=\{\{ uri: item\.grid \?\? item\.card \?\? item\.src \}\}/);
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
