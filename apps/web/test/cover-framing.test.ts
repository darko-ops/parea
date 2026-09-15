/**
 * The half of the cover agreement that runs on the server.
 *
 * The phone shows somebody a 3:2 window over their photograph and lets them
 * drag it. Two numbers cross the wire — CSS `object-position` percentages — and
 * this is what turns them back into the same rectangle sharp has to cut.
 *
 * It is worth testing against real pixels rather than by reading the
 * arithmetic, because every way this can be wrong produces a perfectly valid
 * JPEG: an axis swapped, an orientation missed, a percentage applied to the
 * whole width instead of to the overhang. None of them fails, and all of them
 * quietly hand back a picture of somebody's ceiling.
 */

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  COVER_HEIGHT,
  COVER_WIDTH,
  framingOf,
  orientedSize,
  regionFor,
} from '../src/cover';

const url = (query: string) => new URL(`https://parea.test/api/events/e/cover${query}`);

describe('what the caller asked for', () => {
  it('reads a framing off the query', () => {
    expect(framingOf(url('?cx=25&cy=80'))).toEqual({ x: 25, y: 80 });
    expect(framingOf(url('?cx=0&cy=0'))).toEqual({ x: 0, y: 0 });
    expect(framingOf(url('?cx=100&cy=100'))).toEqual({ x: 100, y: 100 });
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

describe('the region', () => {
  /** A tall photograph: all the slack is vertical, which is the common case. */
  const portrait = { w: 3000, h: 4000 };

  it('cuts the shape the output is', () => {
    const region = regionFor(portrait, { x: 50, y: 50 })!;
    expect(region.width).toBe(3000);
    // 3000 wide at 3:2 is 2000 tall, and there are 4000 to choose it from.
    expect(region.height).toBe(2000);
  });

  it('puts the window where the percentage says', () => {
    // The percentage is of the overhang, not of the picture: 0 is flush to the
    // top, 100 flush to the bottom, and the middle of a 2000px slack is 1000.
    expect(regionFor(portrait, { x: 50, y: 0 })!.top).toBe(0);
    expect(regionFor(portrait, { x: 50, y: 50 })!.top).toBe(1000);
    expect(regionFor(portrait, { x: 50, y: 100 })!.top).toBe(2000);
    // And never past the bottom edge.
    const bottom = regionFor(portrait, { x: 50, y: 100 })!;
    expect(bottom.top + bottom.height).toBe(portrait.h);
  });

  it('moves the axis that has slack and leaves the one that does not', () => {
    // A tall photograph has nothing to give sideways. Dragging across it must
    // not creep, which is what applying the percentage to the full width would.
    for (const x of [0, 50, 100]) {
      expect(regionFor(portrait, { x, y: 50 })!.left).toBe(0);
    }

    const wide = { w: 6000, h: 2000 }; // 3:1, slack only across
    expect(regionFor(wide, { x: 0, y: 50 })!.left).toBe(0);
    expect(regionFor(wide, { x: 100, y: 50 })!.left).toBe(3000);
    expect(regionFor(wide, { x: 50, y: 50 })!.top).toBe(0);
  });

  it('is null when there is nothing to cut', () => {
    // Exactly 3:2 has no overhang on either axis, and an `extract` of the whole
    // image is a round trip that can only introduce a rounding error.
    expect(regionFor({ w: 1500, h: 1000 }, { x: 50, y: 50 })).toBeNull();
    expect(regionFor({ w: 300, h: 200 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('against real pixels', () => {
  /**
   * A photograph with a known landmark, cut the way the route cuts it.
   *
   * Three horizontal bands — red on top, green in the middle, blue at the
   * bottom — in a 3:1 portrait, so the 3:2 window sees roughly one band at a
   * time. What comes out says which band was chosen, which is the thing a
   * person is actually deciding on that screen.
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
  async function cut(input: Buffer, framing: { x: number; y: number } | null) {
    let pipeline = sharp(input, { failOn: 'error' }).rotate();
    const size = framing ? orientedSize(await sharp(input).metadata()) : null;
    const region = size && framing ? regionFor(size, framing) : null;
    if (region) pipeline = pipeline.extract(region);
    return pipeline
      .resize({
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        fit: 'cover',
        position: region ? 'centre' : 'attention',
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  /** The dominant channel at the middle of the output. */
  async function middle(jpeg: Buffer): Promise<'red' | 'green' | 'blue'> {
    const { data } = await sharp(jpeg)
      .extract({ left: COVER_WIDTH / 2 - 8, top: COVER_HEIGHT / 2 - 8, width: 16, height: 16 })
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

  it('shows the top of the picture at 0 and the bottom at 100', async () => {
    const photo = await banded();
    expect(await middle(await cut(photo, { x: 50, y: 0 }))).toBe('red');
    expect(await middle(await cut(photo, { x: 50, y: 50 }))).toBe('green');
    expect(await middle(await cut(photo, { x: 50, y: 100 }))).toBe('blue');
  }, 30_000);

  it('comes out the size a cover is, however it was framed', async () => {
    const photo = await banded();
    for (const framing of [null, { x: 0, y: 0 }, { x: 100, y: 100 }]) {
      const meta = await sharp(await cut(photo, framing)).metadata();
      expect([meta.width, meta.height], JSON.stringify(framing)).toEqual([
        COVER_WIDTH,
        COVER_HEIGHT,
      ]);
    }
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

    expect(await middle(await cut(sideways, { x: 50, y: 0 }))).toBe('red');
    expect(await middle(await cut(sideways, { x: 50, y: 100 }))).toBe('blue');
  }, 30_000);
});
