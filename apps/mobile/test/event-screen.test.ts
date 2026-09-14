/**
 * The album view, after the slabs came off it.
 *
 * Opening an event used to show, in order: a back link, the name, a count, an
 * Add photos button, a Save all button, a "who can see it" card, a cover row,
 * an invite card and an offer to start a group — eight full-width things
 * before the first photograph, on the screen whose entire subject is
 * photographs. And the conversation that shipped on the web was not reachable
 * from here at all.
 *
 * Now the cover is the screen's head, everything that was a slab is behind one
 * `⋯`, and the thread is one of three panes. Nothing it *does* changed: the
 * checks below are mostly that the same calls are still made by the same
 * people, from somewhere else.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const GLYPH = read('src/Glyph.tsx');

/**
 * Comments out.
 *
 * Several assertions below are that a phrase is no longer *drawn* on the
 * screen, and every one of those phrases is also named in a comment explaining
 * where it went — which is exactly the note that should survive the move.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The screen, without the rest of the file. */
const SCREEN = code(
  APP.slice(APP.indexOf('function EventScreen'), APP.indexOf('function Segmented')),
);
/** The sheet everything moved into. */
const SHEET = code(
  APP.slice(APP.indexOf('function HostSheet'), APP.indexOf('/** One action in the sheet')),
);

describe('what is above the first photograph', () => {
  it('found both slices at all', () => {
    // Every assertion below is over one of these, and a rename upstream would
    // empty it and pass all of them silently.
    expect(SCREEN).not.toBe('');
    expect(SHEET).not.toBe('');
  });

  it('is the cover, the name and the tabs — nothing else', () => {
    // The grid starts 248 points down, under a 232pt cover and a row of tabs.
    expect(SCREEN).toMatch(/styles\.cover\b/);
    expect(SCREEN).toMatch(/styles\.coverTitle/);
    expect(APP).toMatch(/page: \{ position: 'absolute', top: 248/);
    expect(APP).toMatch(/cover: \{ position: 'absolute', top: 0, left: 0, right: 0, height: 232 \}/);
  });

  it('keeps no slab where a setting used to be', () => {
    /*
     * The point of the redesign: none of these is on the screen any more. They
     * are asserted against the screen's own slice rather than the file, because
     * every one of them still exists — in the sheet, doing the same thing.
     */
    for (const gone of [
      // The sheet's three actions run across the top as icons now — this is
      // the label under the second one.
      'Download Album',
      'Who can see it',
      // The cover's row, not its handler: `editCover` still lives on the
      // screen, because the sheet calls it and the screen owns the refresh.
      'styles.coverRow',
      '<InviteCard',
      'Create group from this event',
    ]) {
      expect(SCREEN).not.toContain(gone);
      expect(SHEET).toContain(gone);
    }
  });

  it('says who can see it as a padlock, in the line before the link is sent', () => {
    /*
     * It used to be a paragraph three slabs down, which is not where somebody
     * is looking when they are about to hand the link on. Open and closed are
     * the same drawing with the shackle moved.
     */
    expect(SCREEN).toMatch(/name=\{visible === 'private' \? 'locked' : 'unlocked'\}/);
    expect(GLYPH).toMatch(/case 'unlocked'/);
    expect(GLYPH).toMatch(/case 'locked'/);
  });
});

describe('the three panes', () => {
  it('is one screen, not three routes', () => {
    /*
     * Client state rather than a route: an event's link must open on its
     * photographs, never on its roster or halfway down somebody's
     * conversation. And the thread pushed as its own screen would give the
     * conversation a back button to the album it is already inside.
     */
    expect(APP).toMatch(/type Pane = 'photos' \| 'talk' \| 'people'/);
    /*
     * The default carries the rule now that the Groups tab can open an album
     * on its conversation: `initialPane` is optional, nothing sets it but an
     * in-app row that is itself a thread, and a link reaches none of them.
     */
    expect(SCREEN).toMatch(/useState<Pane>\(initialPane \?\? 'photos'\)/);
    expect(APP).toMatch(/pane\?: Pane;/);
    expect(APP).not.toMatch(/screen: 'thread'/);
  });

  it('carries the count on the tab rather than only in a banner', () => {
    // A banner takes itself away; a count on a tab is the thing that is still
    // true a minute later.
    expect(APP).toMatch(/id === 'talk' && unread > 0/);
  });
});

describe('somebody said something while you were looking at the photographs', () => {
  it('does not call the history you arrived with new', () => {
    // The mark is set to whatever was already there on the first feed, so
    // opening an event cannot announce the whole conversation.
    expect(SCREEN).toMatch(/if \(feed && seen === null\) setSeen\(feed\.messages\.length\)/);
  });

  it('takes itself away', () => {
    // A notification, not the conversation: it drops in and goes, and the
    // count stays on the Talk tab.
    expect(SCREEN).toMatch(/setTimeout\(\(\) => setBannerGone\(true\), 6000\)/);
    expect(SCREEN).toMatch(/unread > 0 && !bannerGone/);
  });

  it('dismissing it does not mark the thread read', () => {
    // Only reaching the bottom of the list does that.
    expect(SCREEN).not.toMatch(/setBannerGone\(true\)[\s\S]{0,80}setSeen\(/);
  });
});

describe('the account', () => {
  it('is asked for when somebody reaches for what needs one, not in front of it', () => {
    /*
     * The card used to sit permanently above the grid for anybody not signed
     * in — a sign-in form in front of the photographs, which are the thing
     * that needs no account at all. It opens on pressing `+` now.
     */
    expect(SCREEN).toMatch(/if \(signedIn === false\) return setGateOpen\(true\)/);
    expect(SCREEN).toMatch(/gate\s*\n\s*why="Adding photos needs an account/);
  });
});

/**
 * Where the cover meets the page, as a panel of leaded glass.
 *
 * Three of the cover's four sides are the screen's own edges. Only the bottom
 * borders anything, and that is the seam anybody notices — a picture stops, a
 * line, and then the app. Softening all four was a vignette nobody asked for.
 *
 * What is worth guarding is the shape of the thing rather than the look of it.
 * A single `BlurView` trades the hard edge of the photograph for the hard edge
 * of the blur half an inch higher up — the same line drawn somewhere else — and
 * that is exactly what a later simplification collapses this into.
 */
describe('the glass under the cover', () => {
  const GLASS = readFileSync(
    fileURLToPath(new URL('../src/CoverEdges.tsx', import.meta.url).href),
    'utf8',
  );

  it('is the bottom edge and nothing else', () => {
    expect(GLASS).toMatch(/glass: \{ position: 'absolute', left: 0, right: 0, bottom: 0 \}/);
    // No top, and no sides: the other three edges are the screen's.
    expect(GLASS).not.toMatch(/top: \{ top: 0/);
    expect(GLASS).not.toMatch(/styles\.left|styles\.right/);
  });

  it('ramps, rather than drawing one band with an edge of its own', () => {
    const sizes = [...GLASS.matchAll(/at: ([\d.]+)/g)].map((m) => Number(m[1]));
    const strengths = [...GLASS.matchAll(/intensity: (\d+)/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(2);
    // Tallest and weakest first, so each band sits inside the one before it.
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(strengths).toEqual([...strengths].sort((a, b) => a - b));
    // Every band shares the bottom edge; only how far up it reaches differs.
    expect(GLASS).toMatch(/band: \{ position: 'absolute', left: 0, right: 0, bottom: 0 \}/);
  });

  it('is glass rather than frost', () => {
    /*
     * `systemUltraThinMaterial` is the thinnest material iOS has: it blurs what
     * is behind it and keeps most of its colour. A `light` or `dark` tint would
     * wash the photograph grey, and a grey band under a photograph is a band,
     * not a window.
     */
    expect(GLASS).toMatch(/tint="systemUltraThinMaterial"/);
    expect(GLASS).not.toMatch(/tint=\{?['"]?(light|dark)['"]?\}?[\s/>]/);
  });

  it('is leaded into uneven lights', () => {
    /*
     * Equal divisions read as a progress bar or a segmented control — both
     * things this product has elsewhere, and neither of them a window.
     */
    const lights = GLASS.match(/const LIGHTS = \[([^\]]+)\]/)?.[1];
    expect(lights).toBeDefined();
    const widths = lights!.split(',').map((n) => Number(n.trim()));
    expect(widths.length).toBeGreaterThan(2);
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('draws the came between lights, not around the window', () => {
    // A line on the outside edge would be a border on a photograph, which is
    // the opposite of an edge dissolving into the page.
    expect(GLASS).toMatch(/\{i > 0 && \(/);
    // And it fades upward, so the lights arrive out of the photograph rather
    // than being ruled onto it.
    expect(GLASS).toMatch(/colors=\{\['rgba\(12,14,18,0\)', LEAD\]\}/);
  });

  it('is the same window every time the album opens', () => {
    // A random set of widths would make the glass rearrange itself on every
    // render, which is a photograph that will not sit still.
    expect(GLASS).not.toMatch(/Math\.random/);
  });

  it('sits above the photograph and below the scrim', () => {
    /*
     * Above, or it has nothing to blur. Below, because the gradient carries the
     * back button and the title and was tuned against the same forty points —
     * putting the glass over it would change what it is sitting on.
     */
    const cover = APP.slice(APP.indexOf('<View style={styles.cover}>'));
    const image = cover.indexOf('contentFit="cover"');
    const edges = cover.indexOf('<CoverEdges');
    const scrim = cover.indexOf('<LinearGradient');
    expect(image).toBeLessThan(edges);
    expect(edges).toBeLessThan(scrim);
  });

  it('lets touches through', () => {
    expect(GLASS).toMatch(/pointerEvents="none"/);
  });
});
