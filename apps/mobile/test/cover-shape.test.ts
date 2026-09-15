/**
 * A cover is as tall as its photograph, within bounds.
 *
 * Every cover was 3:2 — stored at 1200 × 800, drawn 260 high — which is a
 * landscape crop of a portrait photograph on a screen whose whole width was
 * going spare. A shelf of albums was a row of short wide crops of tall narrow
 * evenings, and the part of the picture somebody cared about was usually the
 * part outside the letterbox.
 *
 * The bounds are what keep it a shelf. Unbounded, a panorama is a hairline and
 * a screenshot is a card and a half tall.
 *
 * Source checks because there is no renderer in this suite. The arithmetic runs
 * against real pixels in `apps/web/test/cover-framing.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const FRAMER = read('src/CoverFramer.tsx');
const API = read('src/api.ts');
const SCHEMA = read('../../packages/core/src/schema.ts');
const COVER = read('../web/src/cover.ts');

describe('the bounds', () => {
  it('are the same two on both sides of the wire', () => {
    /*
     * Restated rather than shared: the only package both clients and the server
     * can import is `@parea/cards`, and this is a fact about storage rather
     * than about a card. Restated means they can drift, so they are pinned
     * together here — the one place that reads all three files.
     */
    for (const source of [COVER, FRAMER, EVENTS]) {
      expect(source).toMatch(/3 \/ 2/);
      expect(source).toMatch(/4 \/ 5/);
    }
  });

  it('clamp on the way out as well as on the way in', () => {
    // The encoder bounds it, and the clients bound it again: it arrives as a
    // number off the wire, and one bad row should cost a card its shape rather
    // than cost the screen its layout.
    expect(EVENTS).toMatch(/Math\.min\(WIDEST, Math\.max\(TALLEST, aspect\)\)/);
    expect(FRAMER).toMatch(
      /Math\.min\(COVER_WIDEST, Math\.max\(COVER_TALLEST, natural\.w \/ natural\.h\)\)/,
    );
  });
});

describe('what the card draws', () => {
  it('reserves the space before the picture arrives', () => {
    /*
     * The shape comes down with the listing. Measuring it in the client means a
     * list that lays itself out again as each cover loads, which is a shelf
     * that jumps under a thumb.
     */
    expect(SCHEMA).toMatch(/coverAspect: real\('cover_aspect'\)/);
    expect(API).toMatch(/coverAspect\?: number \| null;/);
    expect(EVENTS).toMatch(/height: coverHeight\(event, width\)/);
  });

  it('falls back to the shape every old cover actually is', () => {
    // Null is a cover stored before the column existed, or a photograph
    // standing in for one. Both are the old letterbox.
    expect(EVENTS).toMatch(/if \(!aspect \|\| !Number\.isFinite\(aspect\)\) return width \/ WIDEST;/);
  });

  it('no longer pins every cover to one height', () => {
    const style = EVENTS.slice(EVENTS.indexOf('cover: { marginHorizontal: -20'));
    expect(style.slice(0, 120)).not.toMatch(/height: 260/);
  });
});

describe('trying another photograph in the frame', () => {
  it('offers the album on the crop screen too', () => {
    /*
     * Which picture leads is a question you cannot answer from a grid of
     * thumbnails: the obvious choice there is often the wrong one once it is a
     * card, and finding that out used to mean backing out, tapping a different
     * tile, and coming in again to look.
     */
    expect(FRAMER).toMatch(/IN THIS ALBUM/);
    expect(FRAMER).toMatch(/onPress=\{\(\) => tryPhoto\(photo\)\}/);
    expect(FRAMER).toMatch(/photos\.length > 1 &&/);
  });

  it('changes nothing until Use', () => {
    // Trying one is not choosing it, so Cancel has to put back both the cover
    // and the framing this opened with — which it cannot do if trying one had
    // already changed the album.
    expect(FRAMER).toMatch(/onConfirm: \(coverId: string, framing: CoverFraming\) => void;/);
    expect(FRAMER).toMatch(/onConfirm\(cover\.id, framing\)/);
  });

  it('starts an untried photograph centred', () => {
    // The framing that arrived describes the photograph that arrived. Carrying
    // it to another is a crop somebody chose for a different picture.
    expect(FRAMER).toMatch(/setFraming\(photo\.id === coverId \? initial : CENTRED\)/);
  });

  it('does not offer to throw one out from here', () => {
    /*
     * The ⊗ stays on the form. This screen is about which picture leads and how
     * it sits; removing one from the album is a different outcome, and putting
     * the two a thumb's width apart on a black screen is how somebody loses a
     * photograph while choosing a cover.
     */
    const strip = FRAMER.slice(FRAMER.indexOf('IN THIS ALBUM'));
    expect(strip).not.toMatch(/removeMark|Remove photo/);
  });
});

describe('the frame somebody confirms', () => {
  it('is the shape the cover will be, not a fixed letterbox', () => {
    // Otherwise the frame is a promise the stored cover does not keep.
    expect(FRAMER).toMatch(/h: w \/ coverAspect\(natural\)/);
  });

  it('says so when there is nothing to decide', () => {
    /*
     * Most photographs now sit between the bounds, so the frame is the whole
     * picture and there is no overhang to move. Offering a drag that does
     * nothing is worse than saying there is nothing to drag.
     */
    expect(FRAMER).toMatch(/fits the card exactly/);
    expect(FRAMER).toMatch(/slackX > 0 \|\| shot\.slackY > 0/);
  });
});
