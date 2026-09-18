/**
 * The glyphs, and the one thing that makes them a set.
 *
 * The tab bar said Events / Groups / Find / You in words; it draws the web
 * rail's own pictures now. The risk in that is drift: a second hand redrawing
 * a group as two slightly different circles, so that the app and the site
 * point at the same thing with two pictures of it.
 *
 * These assertions are the path data, character for character, against
 * `RailIcon.tsx` and `SearchIcon.tsx` on the web. They are deliberately literal
 * — a glyph that has been "tidied" fails here, which is the point.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const GLYPH = read('src/Glyph.tsx');
const RAIL = readFileSync(
  fileURLToPath(new URL('../../web/app/components/RailIcon.tsx', import.meta.url).href),
  'utf8',
);
const SEARCH = readFileSync(
  fileURLToPath(new URL('../../web/app/components/SearchIcon.tsx', import.meta.url).href),
  'utf8',
);

describe('the shared drawings', () => {
  it('draws a group exactly as the web rail does', () => {
    for (const d of [
      'M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5',
      'M16 5.4a3.5 3.5 0 0 1 0 6.2',
      'M17.5 14.9c2.2.5 3.5 1.9 3.5 4.6',
    ]) {
      expect(RAIL).toContain(d);
      expect(GLYPH).toContain(d);
    }
    expect(GLYPH).toMatch(/<Circle cx=\{9\.5\} cy=\{8\.5\} r=\{3\.5\} \/>/);
  });

  it('draws a person exactly as the web rail does', () => {
    expect(RAIL).toContain('M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5');
    expect(GLYPH).toContain('M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5');
  });

  it('draws the magnifier exactly as the web search field does', () => {
    expect(SEARCH).toContain('cx="11" cy="11" r="7"');
    expect(GLYPH).toMatch(/<Circle cx=\{11\} cy=\{11\} r=\{7\} \/>/);
    expect(GLYPH).toMatch(/x1=\{16\.5\} y1=\{16\.5\} x2=\{21\} y2=\{21\}/);
  });
});

describe('the grid they are all on', () => {
  it('is 24 units at stroke 2, with round caps and joins', () => {
    // The convention `RailIcon` set, and the only thing that makes six
    // drawings by different hands read as one family.
    //
    // The weight is a prop now — the selected tab asks for a heavier cut of
    // the same drawing rather than for a second set of paths — so what is
    // pinned here is the default it falls back to when nobody asks.
    expect(GLYPH).toMatch(/viewBox="0 0 24 24"/);
    expect(GLYPH).toMatch(/weight = 2,/);
    expect(GLYPH).toMatch(/strokeWidth=\{weight\}/);
    expect(GLYPH).toMatch(/strokeLinecap="round"/);
    expect(GLYPH).toMatch(/strokeLinejoin="round"/);
  });

  it('makes the exception where a picture sits inside a frame', () => {
    // At the frame's weight the photo tile reads as a scribble at 20 points.
    // Held as a fraction of the frame rather than as 1.6 so that the picture
    // stays lighter than the frame in the bold cut too.
    expect(GLYPH).toMatch(/const light = weight \* 0\.8;/);
    expect(GLYPH).toMatch(/<Circle cx=\{12\} cy=\{8\} r=\{1\.05\} strokeWidth=\{light\} \/>/);
    expect(GLYPH).toMatch(/M8\.2 15\.1l3\.4-3\.2 2\.3 2\.1 1\.9-1\.6 4\.7 4\.1" strokeWidth=\{light\}/);
  });

  it('says the padlock’s two states with one stroke', () => {
    /*
     * The same lock with the shackle moved, which is why it works at 15 points
     * beside a line of type: the two states differ in one stroke and the
     * difference is the meaning.
     */
    expect(GLYPH).toContain('M8 11V7.5a4 4 0 0 1 7.6-1.7');
    expect(GLYPH).toContain('M8 11V7.5a4 4 0 0 1 8 0V11');
    const rects = GLYPH.match(/<Rect x=\{4\.5\} y=\{11\} width=\{15\} height=\{9\.5\} rx=\{2\} \/>/g);
    expect(rects).toHaveLength(2);
  });

  it('says the selected tab in value and weight, not in colour', () => {
    /*
     * The capsule under the selected glyph is a wash of the page's own value
     * through the glass — translucent, because over a blur an opaque fill
     * reads as a patch stuck on it, and grey because a filled blue capsule is
     * the loudest thing on a screen of other people's photographs. A tab bar
     * is chrome.
     *
     * What makes the selected one legible is the glyph: `fg` against four in
     * `dim`, plus half a unit of stroke, because at 22 points a change of
     * value alone is easy to miss on a bar sitting over a bright cover.
     */
    const APP = read('App.tsx');
    expect(APP).toMatch(
      /tab === id && \{ backgroundColor: dark \? '#ffffff1f' : '#0000000f' \}/,
    );
    expect(APP).toMatch(/color=\{tab === id \? t\.fg : t\.dim\}/);
    expect(APP).toMatch(/weight=\{tab === id \? 2\.5 : 2\}/);
    /*
     * No accent on the bubble, and no opaque colour standing in for one. The
     * pattern wants exactly six hex digits before the quote, so the two
     * eight-digit washes above — which are values at an alpha, not colours —
     * do not match it.
     */
    const BAR = APP.slice(APP.indexOf('<View style={styles.tabShell}>'), APP.indexOf('</BlurView>'));
    expect(BAR).not.toMatch(/t\.accent/);
    expect(BAR).not.toMatch(/#[0-9a-f]{6}['"]/i);
  });

  it('is drawn rather than imported from an icon set', () => {
    // An icon package is a font or a thousand paths for the six shapes this
    // product draws, and a borrowed set never quite matches the web's.
    expect(GLYPH).not.toMatch(/@expo\/vector-icons|react-native-vector-icons|lucide|feather/i);
  });
});

/**
 * One bubble and two, which are two different ideas.
 *
 * A single bubble is a remark *about a thing* — an album's comments, which
 * mostly hang off individual photographs. A pair overlapping is people going
 * back and forth, which is a chat. The distinction has to survive at 22
 * points, because that is the size both are drawn at in a bar.
 *
 * Both replaced a paper aeroplane, which is gone from this file. An aeroplane
 * is *send*: one message leaving for somebody not in front of you. Neither
 * place it sat sends anything — the Chats tab and a group's own button both
 * open a room where talking is already going on.
 */
describe('the bubbles', () => {
  it('is the Chats tab and a group\'s own button', () => {
    const APP = read('App.tsx');
    const GROUPS = read('src/Groups.tsx');
    expect(APP).toContain("['chats', 'bubbles', 'Chats']");
    expect(GROUPS).toMatch(/<Glyph name="bubbles"/);
  });

  it('left no aeroplane behind', () => {
    // A case in this switch that nothing draws is a drawing nobody maintains
    // and everybody trusts. It is in the history if it is wanted back.
    expect(GLYPH).not.toMatch(/'plane'/);
    expect(read('App.tsx')).not.toMatch(/'plane'/);
    expect(read('src/Groups.tsx')).not.toMatch(/"plane"/);
  });

  it('is two bubbles, and the single one is still one', () => {
    /*
     * The anchors are the two cases in the order the file has them, and they
     * carry their colons on purpose: `case 'bubble':` would otherwise match
     * inside `case 'bubbles':`, and the first version of this read both cases
     * as one and counted three paths.
     */
    const many = GLYPH.slice(GLYPH.indexOf("case 'bubbles':"), GLYPH.indexOf("case 'bubble':"));
    expect(many).not.toBe('');
    expect((many.match(/<Path/g) ?? [])).toHaveLength(2);

    const one = GLYPH.slice(GLYPH.indexOf("case 'bubble':"), GLYPH.indexOf("case 'group':"));
    expect(one).not.toBe('');
    expect((one.match(/<Path/g) ?? [])).toHaveLength(1);
  });
});

/**
 * The activity tray, where an envelope used to be.
 *
 * An envelope is one thing arriving addressed to you. Half of what lands in
 * Lately is that — somebody asking you into an album, asking to be friends —
 * and the other half is addressed to nobody: photographs added to an album you
 * are in, an answer to something you asked. A tray is where all of it
 * accumulates, which is what the screen is.
 */
describe('the tray', () => {
  it('is the control and the empty state it opens', () => {
    // The door and the room. A disc showing one picture that opens a screen
    // illustrated with another is two screens as far as anybody can tell.
    expect(read('src/PageHead.tsx')).toMatch(/<Glyph name="tray"/);
    expect(read('src/Lately.tsx')).toMatch(/<Glyph name="tray"/);
  });

  it('left no envelope behind in the app', () => {
    expect(GLYPH).not.toMatch(/case 'envelope':/);
    expect(read('src/PageHead.tsx')).not.toMatch(/"envelope"/);
    expect(read('src/Lately.tsx')).not.toMatch(/"envelope"/);
  });

  it('knowingly disagrees with the web rail', () => {
    /*
     * The web still draws an envelope for the same idea, and this file exists
     * to catch exactly that kind of drift — so it is written down rather than
     * left to be discovered in a screenshot a year from now. The two clients
     * already disagree about where groups live; one picture is the smaller of
     * the two arguments.
     */
    expect(RAIL).toMatch(/invites/);
    expect(GLYPH).toMatch(/The web rail still draws an envelope/);
  });
});

/**
 * The bubble, which is the album's comment board.
 *
 * A comment is a remark about a photograph, written under one or on the board
 * — one thread either way. It shared the aeroplane with the Chats tab until
 * the two verbs came apart: that one is *send*, this one is *say about*.
 */
describe('the bubble', () => {
  it('is one closed path, tail included', () => {
    /*
     * The tail is what makes it a bubble rather than a rounded rectangle, so
     * it is part of the same outline — a separate tail would be a second
     * stroke to align, and the two would come apart at the join the first time
     * the weight changed.
     */
    const bubble = GLYPH.slice(GLYPH.indexOf("case 'bubble':"), GLYPH.indexOf("case 'group':"));
    expect(bubble).not.toBe('');
    expect((bubble.match(/<Path/g) ?? [])).toHaveLength(1);
    expect(bubble).toMatch(/z" \/>/);
  });

  it('is drawn on the same 24-unit grid as the rest', () => {
    // Every glyph here is authored at 24 and scaled by the viewBox, which is
    // what lets a 22pt tab glyph and a 15pt one be the same drawing.
    const bubble = GLYPH.slice(GLYPH.indexOf("case 'bubble':"), GLYPH.indexOf("case 'group':"));
    const numbers = [...bubble.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(numbers.length).toBeGreaterThan(8);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(24);
  });
});
