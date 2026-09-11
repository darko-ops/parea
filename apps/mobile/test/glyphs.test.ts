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
    expect(GLYPH).toMatch(/viewBox="0 0 24 24"/);
    expect(GLYPH).toMatch(/strokeWidth=\{2\}/);
    expect(GLYPH).toMatch(/strokeLinecap="round"/);
    expect(GLYPH).toMatch(/strokeLinejoin="round"/);
  });

  it('makes the exception where a picture sits inside a frame', () => {
    // At the frame's weight the photo tile reads as a scribble at 20 points.
    expect(GLYPH).toMatch(/<Circle cx=\{12\} cy=\{8\} r=\{1\.05\} strokeWidth=\{1\.6\} \/>/);
    expect(GLYPH).toMatch(/M8\.2 15\.1l3\.4-3\.2 2\.3 2\.1 1\.9-1\.6 4\.7 4\.1" strokeWidth=\{1\.6\}/);
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

  it('is drawn rather than imported from an icon set', () => {
    // An icon package is a font or a thousand paths for the six shapes this
    // product draws, and a borrowed set never quite matches the web's.
    expect(GLYPH).not.toMatch(/@expo\/vector-icons|react-native-vector-icons|lucide|feather/i);
  });
});
