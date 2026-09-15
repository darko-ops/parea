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
    // Square, which is the trade a contact sheet makes.
    expect(APP).toMatch(/gridShot: \{ width: '100%', aspectRatio: 1/);
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
    expect(APP).toMatch(/gridRow: \{ gap: PHOTO_GAP \}/);
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

  it('says which view is showing, and says it once', () => {
    /*
     * The indicator is what tells somebody the swipe exists at all, and that is
     * the whole of its job. It had a white strip behind it — three pieces of
     * chrome between the tabs and the photographs where two will do, and a
     * white one in dark mode besides — and it drew the half you are *not* on as
     * a track, which said the same thing twice.
     *
     * Only the side you are on is drawn now. The other half still takes its
     * space, so the mark reads as which side rather than as a bar that moved.
     */
    expect(APP).toMatch(/viewBar: \{ paddingTop: 10, paddingBottom: 8 \}/);
    expect(APP).not.toMatch(/viewBar: \{ backgroundColor/);
    expect(APP).toMatch(/backgroundColor: view === which \? t\.fg : 'transparent'/);
    expect(APP).toMatch(/viewSegment: \{ flex: 1, height: 4/);
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
