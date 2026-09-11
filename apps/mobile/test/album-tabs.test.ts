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
    expect(APP).toMatch(/const PAGE_TOP = 248/);
    expect(APP).toMatch(/page: \{ position: 'absolute', top: 248/);
    expect(SCREEN).toMatch(/keyboardOffset=\{PAGE_TOP\}/);
    expect(THREAD).toMatch(/keyboardVerticalOffset=\{keyboardOffset\}/);
  });

  it('keeps the new-message banner to the photographs', () => {
    // On the conversation it would announce what is directly beneath it, and
    // on the roster it would sit over the first two people.
    expect(SCREEN).toMatch(/\{pane === 'photos' && latest && unread > 0 && !bannerGone/);
  });
});

describe('the grid', () => {
  it('is one photograph per row, not a contact sheet', () => {
    /*
     * Three columns of 121pt squares is good for finding a photograph you
     * already know is in there and nothing like looking at one — and every
     * square was a crop, since `cover` on a 1:1 tile takes the ends off
     * anything shot in portrait.
     */
    expect(SCREEN).not.toMatch(/numColumns=\{3\}/);
    expect(SCREEN).not.toMatch(/columnWrapperStyle/);
    expect(APP).toMatch(/thumb: \{ width: '100%', aspectRatio: 4 \/ 5/);
    // Edge to edge, as the home cards are.
    expect(APP).toMatch(/gridContent: \{ paddingBottom: 12, gap: 3 \}/);
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
