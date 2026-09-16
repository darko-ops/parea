/**
 * The half of the cover agreement that runs on the server.
 *
 * The phone shows somebody a frame over their photograph and lets them drag it.
 * Two numbers cross the wire — CSS `object-position` percentages — and this is
 * what turns them back into the same rectangle sharp has to cut.
 *
 * The frame is not one shape any more. A cover takes the picture's own, bounded
 * at 3:2 one way and 4:5 the other, so most photographs are no longer cut at
 * all and the ones that are lose far less.
 *
 * It is worth testing against real pixels rather than by reading the
 * arithmetic, because every way this can be wrong produces a perfectly valid
 * JPEG: an axis swapped, an orientation missed, a percentage applied to the
 * whole width instead of to the overhang. None of them fails, and all of them
 * quietly hand back a picture of somebody's ceiling.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  type CoverFraming,
  COVER_TALLEST,
  COVER_WIDEST,
  COVER_WIDTH,
  coverAspect,
  coverSize,
  framingOf,
  orientedSize,
  regionFor,
} from '../src/cover';

const url = (query: string) => new URL(`https://parea.test/api/events/e/cover${query}`);

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url).href), 'utf8');

const ROUTE = read('../app/api/events/[id]/cover/route.ts');

/**
 * What the server remembers about a cover, beyond the cover.
 *
 * None of it is needed to *draw* one — `coverKey` is the finished JPEG. It is
 * needed to edit one: nothing about the result of a crop says which photograph
 * it came from or how it was framed, so without these columns "change the
 * cover" could only ever open an empty picker, and nudging an existing cover
 * two inches to the left was not something the product could offer at all.
 */
describe('where a cover came from', () => {
  it('records the photograph and the framing, and verifies the photograph', () => {
    /*
     * The id decides nothing about the bytes — those arrived in the body and
     * are re-encoded either way — so a wrong one cannot produce a cover of
     * somebody else's photograph. What it would do is leave a row claiming
     * this album's cover came from an album the reader cannot see, and hand
     * back a presigned thumbnail of it the next time somebody opened the
     * frame. So it is checked against this event, and an id that does not
     * belong here is simply not written down.
     */
    expect(ROUTE).toMatch(/const claimed = url\.searchParams\.get\('photo'\)/);
    expect(ROUTE).toMatch(/eq\(schema\.photos\.eventId, event\.id\)/);
    // Shape-checked first: a `uuid` column raises on a string that is not one.
    expect(ROUTE).toMatch(/claimed && UUID\.test\(claimed\)/);
    /*
     * Written on every upload, including as nulls. A cover replaced from the
     * camera roll has no photograph behind it and the last one may have had,
     * and leaving the old row standing would reopen the frame on a picture
     * this cover was not made from — which is worse than offering nothing.
     */
    expect(ROUTE).toMatch(/coverPhotoId: from,\s*\n\s*coverX: framing\?\.x \?\? null,/);
    // And it all goes when the cover does.
    expect(ROUTE).toMatch(/coverKey: null,\s*\n\s*coverAspect: null,\s*\n\s*coverPhotoId: null,/);
  });

  it('hands both back on the feed, so a client can reopen the frame', () => {
    const FEED = read('../app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/coverPhotoId: event\.coverPhotoId,/);
    /*
     * An id rather than a URL: the client already holds every photograph in
     * that response, so this is a key into it — presigning a second copy would
     * be a second capability granted for a picture already granted.
     */
    expect(FEED).toMatch(
      /coverFraming:\s*\n\s*event\.coverX === null \|\| event\.coverY === null/,
    );
  });

  it('keeps the photograph’s bytes off the origin', () => {
    /*
     * There is deliberately no "make the cover out of photo X" endpoint.
     * `storage/index.ts` opens by saying in capitals that the app tier is
     * handed a client with no method that returns bytes, so that no photograph
     * is ever routed through the Next.js origin — and such an endpoint would
     * be exactly that route. The phone downloads the photograph straight from
     * storage and sends it back, which is client ↔ storage in both directions.
     */
    expect(ROUTE).toMatch(/await request\.arrayBuffer\(\)/);
    expect(ROUTE).not.toMatch(/presignGet|getStorage\(\)\.get\b/);
  });
});

describe('what the caller asked for', () => {
  it('reads a framing off the query', () => {
    // Zoom defaults to 1 when it is not asked for, which is what every client
    // that predates it is asking for.
    expect(framingOf(url('?cx=25&cy=80'))).toEqual({ x: 25, y: 80, zoom: 1 });
    expect(framingOf(url('?cx=0&cy=0'))).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(framingOf(url('?cx=100&cy=100&cz=2.5'))).toEqual({ x: 100, y: 100, zoom: 2.5 });
  });

  it('refuses a zoom it cannot use, having been sent one', () => {
    // Absent is a client that never knew about zoom. Present and unusable is a
    // bug, and answering it with a plausible crop is how the bug survives.
    for (const bad of ['?cx=50&cy=50&cz=0', '?cx=50&cy=50&cz=99', '?cx=50&cy=50&cz=x']) {
      expect(framingOf(url(bad)), bad).toBeNull();
    }
  });

  it('is null for a caller that cannot frame', () => {
    // The web has no such screen, and null is what keeps `attention` alive
    // for it. Not a failure, and it must never become one.
    expect(framingOf(url(''))).toBeNull();
    expect(framingOf(url('?cx=50'))).toBeNull();
  });

  it('refuses nonsense rather than clamping it', () => {
    /*
     * A caller sending 400 has a bug. Clamping to the right edge would answer
     * it with a plausible picture, which is how the bug survives to production
     * — falling back to `attention` at least crops it sensibly while being
     * visibly not what was asked for.
     */
    for (const bad of ['?cx=-1&cy=50', '?cx=50&cy=101', '?cx=x&cy=50', '?cx=&cy=']) {
      expect(framingOf(url(bad)), bad).toBeNull();
    }
  });
});

describe('the size to cut against', () => {
  it('is the displayed size, not the stored one', () => {
    /*
     * Orientations 5 through 8 are the quarter turns, and `metadata()` reports
     * what is in the file rather than what a viewer sees. Cropping a portrait
     * photograph as though it were landscape is the failure this prevents, and
     * it shows up only on pictures taken sideways — which is most of them.
     */
    expect(orientedSize({ width: 4000, height: 3000, orientation: 1 })).toEqual({
      w: 4000,
      h: 3000,
    });
    expect(orientedSize({ width: 4000, height: 3000, orientation: 6 })).toEqual({
      w: 3000,
      h: 4000,
    });
  });

  it('is null for a header that said nothing useful', () => {
    expect(orientedSize({})).toBeNull();
    expect(orientedSize({ width: 0, height: 100 })).toBeNull();
  });
});

describe('the shape a cover comes out', () => {
  /*
   * Every cover used to be 3:2, which is a landscape crop of a portrait
   * photograph on a screen whose whole width was going spare — a shelf of short
   * wide crops of tall narrow evenings. The picture decides now, within bounds
   * that stop a panorama becoming a hairline or a screenshot becoming a card
   * and a half tall.
   */
  it('follows the picture between the bounds', () => {
    expect(coverAspect({ w: 4000, h: 3000 })).toBeCloseTo(4 / 3);
    expect(coverAspect({ w: 3000, h: 3000 })).toBeCloseTo(1);
  });

  it('refuses to be wider than a card or taller than 4:5', () => {
    // A panorama and a screenshot are the two that would break a shelf.
    expect(coverAspect({ w: 9000, h: 1000 })).toBeCloseTo(COVER_WIDEST);
    expect(coverAspect({ w: 1000, h: 9000 })).toBeCloseTo(COVER_TALLEST);
  });

  it('is always the same width, whatever the shape', () => {
    // The height moves; the width is what a retina card needs and no more.
    for (const size of [{ w: 4000, h: 3000 }, { w: 3000, h: 4000 }, { w: 9000, h: 1000 }]) {
      expect(coverSize(size).width, JSON.stringify(size)).toBe(COVER_WIDTH);
    }
    expect(coverSize({ w: 1000, h: 9000 })).toEqual({ width: 1200, height: 1500 });
  });
});

describe('the region', () => {
  /** Taller than 4:5, so it is cut down to it — the common phone case. */
  const portrait = { w: 3000, h: 4000 };
  /** Position only. Zoom has a describe of its own below. */
  const at = (x: number, y: number) => ({ x, y, zoom: 1 });

  it('cuts the shape the output is', () => {
    const region = regionFor(portrait, at(50, 50))!;
    // 4:5 of a 3000-wide picture is 3750 tall, and there are 4000 to take it
    // from — far less thrown away than the 2000 a 3:2 cover used to keep.
    expect(region.width).toBe(3000);
    expect(region.height).toBe(3750);
  });

  it('puts the window where the percentage says', () => {
    // The percentage is of the overhang, not of the picture: 0 is flush to the
    // top, 100 flush to the bottom, and half of a 250px slack is 125.
    expect(regionFor(portrait, at(50, 0))!.top).toBe(0);
    expect(regionFor(portrait, at(50, 50))!.top).toBe(125);
    expect(regionFor(portrait, at(50, 100))!.top).toBe(250);
    // And never past the bottom edge.
    const bottom = regionFor(portrait, at(50, 100))!;
    expect(bottom.top + bottom.height).toBe(portrait.h);
  });

  it('moves the axis that has slack and leaves the one that does not', () => {
    // A tall photograph has nothing to give sideways. Dragging across it must
    // not creep, which is what applying the percentage to the full width would.
    for (const x of [0, 50, 100]) {
      expect(regionFor(portrait, at(x, 50))!.left).toBe(0);
    }

    // 3:1 is wider than a card may be, so it is cut across and not down.
    const wide = { w: 6000, h: 2000 };
    expect(regionFor(wide, at(0, 50))!.left).toBe(0);
    expect(regionFor(wide, at(100, 50))!.left).toBe(3000);
    expect(regionFor(wide, at(50, 50))!.top).toBe(0);
  });

  it('is null when there is nothing to cut', () => {
    /*
     * Anything already between the bounds keeps its whole self, which is most
     * photographs now and was almost none of them before. An `extract` of the
     * entire image is a round trip that can only introduce a rounding error.
     */
    expect(regionFor({ w: 1500, h: 1000 }, at(50, 50))).toBeNull();
    expect(regionFor({ w: 300, h: 200 }, at(0, 0))).toBeNull();
    // 4:3 — a perfectly ordinary phone photograph, uncut either way now.
    expect(regionFor({ w: 4000, h: 3000 }, at(0, 0))).toBeNull();
    expect(regionFor({ w: 3000, h: 3000 }, at(100, 100))).toBeNull();
  });
});

describe('against real pixels', () => {
  /**
   * A photograph with a known landmark, cut the way the route cuts it.
   *
   * Three horizontal bands — red on top, green in the middle, blue at the
   * bottom — in a 3:1 portrait, which is taller than a cover may be even now,
   * so the window sees roughly one band at a time. What comes out says which
   * band was chosen, which is the thing a person is deciding on that screen.
   */
  async function banded() {
    const w = 900;
    const band = 900;
    const bands = await Promise.all(
      (['#ff0000', '#00ff00', '#0000ff'] as const).map((colour) =>
        sharp({ create: { width: w, height: band, channels: 3, background: colour } })
          .png()
          .toBuffer(),
      ),
    );
    return sharp({
      create: { width: w, height: band * 3, channels: 3, background: '#000' },
    })
      .composite(bands.map((input, i) => ({ input, top: i * band, left: 0 })))
      .jpeg({ quality: 100 })
      .toBuffer();
  }

  /** What the route does, in the order the route does it. */
  async function cut(input: Buffer, framing: CoverFraming | null) {
    const size = orientedSize(await sharp(input).metadata())!;
    const target = coverSize(size);
    let pipeline = sharp(input, { failOn: 'error' }).rotate();
    const region = framing ? regionFor(size, framing) : null;
    if (region) pipeline = pipeline.extract(region);
    return pipeline
      .resize({
        width: target.width,
        height: target.height,
        fit: 'cover',
        position: region ? 'centre' : 'attention',
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  /** The dominant channel at the middle of the output, whatever shape it is. */
  async function middle(jpeg: Buffer): Promise<'red' | 'green' | 'blue'> {
    const meta = await sharp(jpeg).metadata();
    const { data } = await sharp(jpeg)
      .extract({
        left: Math.round(meta.width! / 2) - 8,
        top: Math.round(meta.height! / 2) - 8,
        width: 16,
        height: 16,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 3) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    return r > g && r > b ? 'red' : g > b ? 'green' : 'blue';
  }

  const at = (x: number, y: number, zoom = 1) => ({ x, y, zoom });

  /** The dominant channel a few rows down from the top of the output. */
  async function topEdge(jpeg: Buffer): Promise<'red' | 'green' | 'blue'> {
    const meta = await sharp(jpeg).metadata();
    const strip = await sharp(jpeg)
      .extract({ left: Math.round(meta.width! / 2) - 8, top: 4, width: 16, height: 16 })
      .jpeg()
      .toBuffer();
    return middle(strip);
  }

  it('shows the top of the picture at 0 and the bottom at 100', async () => {
    const photo = await banded();
    expect(await middle(await cut(photo, at(50, 0)))).toBe('red');
    expect(await middle(await cut(photo, at(50, 50)))).toBe('green');
    expect(await middle(await cut(photo, at(50, 100)))).toBe('blue');
  }, 30_000);

  it('comes out the shape the picture earned, however it was framed', async () => {
    // 900 × 2700 is far taller than 4:5, so it is cut to 4:5 — 1200 × 1500 —
    // rather than to the 1200 × 800 letterbox every cover used to be. Zooming
    // takes a smaller window of the same picture and does not change that: the
    // shape is the photograph's, and the zoom is how close you stand to it.
    const photo = await banded();
    for (const framing of [null, at(0, 0), at(100, 100), at(50, 50, 3)]) {
      const meta = await sharp(await cut(photo, framing)).metadata();
      expect([meta.width, meta.height], JSON.stringify(framing)).toEqual([1200, 1500]);
    }
  }, 30_000);

  it('takes a smaller window of the same picture as it zooms', async () => {
    /*
     * The arithmetic could be wrong in a way that still produces a valid JPEG
     * of the right size — dividing the wrong term, or the position twice — so
     * this measures what actually comes out: at 1× the middle band fills the
     * frame and its neighbours crowd the edges; at 3× there is nothing but the
     * middle band, edge to edge.
     */
    const photo = await banded();

    const plain = await cut(photo, at(50, 50));
    const close = await cut(photo, at(50, 50, 3));

    // Both still centred on green, or the zoom has moved the window as well as
    // resized it.
    expect(await middle(plain)).toBe('green');
    expect(await middle(close)).toBe('green');

    // The corner is the test. Zoomed out, the top of the frame is red; zoomed
    // in, it is green all the way up.
    expect(await topEdge(plain)).toBe('red');
    expect(await topEdge(close)).toBe('green');
  }, 30_000);

  it('follows the picture a viewer sees, not the one on disk', async () => {
    /*
     * The same bands, tagged as needing a quarter turn. `rotate()` runs before
     * the extract, so the region has to be computed against the rotated shape
     * — and the band a person picked has to be the band they get.
     */
    const upright = await banded();
    const sideways = await sharp(upright)
      .rotate(270)
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);

    expect(await middle(await cut(sideways, at(50, 0)))).toBe('red');
    expect(await middle(await cut(sideways, at(50, 100)))).toBe('blue');
  }, 30_000);
});
