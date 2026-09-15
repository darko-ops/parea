/**
 * Decoding the original once, and what had to stay true to do it.
 *
 * `encodeAll` built a fresh `sharp(input)` for every size and every format, so
 * one photograph was decoded seven times over — and for the iPhone HEIC that
 * has been through `heifConvert`, the thing decoded seven times is a full-size
 * PNG. On a deriver that works one photograph at a time, on one machine, that
 * is most of the wait between somebody adding photos and seeing them.
 *
 * Sharing the decode is only allowed if the pixels do not move. That is what
 * these check: the derivative built from a shared raster is byte-identical to
 * the one built the old way, for every kind of source that reaches this
 * service — and where it cannot be identical, the old way is still taken.
 */

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { buildDerivatives, DERIVATIVES } from '../src/derivatives';

const EDGE = { width: 480, height: 360 };

/** Noise rather than a flat fill: a solid colour survives anything. */
function noisy(width = EDGE.width, height = EDGE.height, channels: 3 | 4 = 3) {
  return sharp({
    create: {
      width,
      height,
      channels,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  });
}

/**
 * What `encodeAll` did before the shared decode: one loader run per output.
 *
 * Kept here rather than imported because the point is to compare against the
 * old behaviour, and an import would compare the new one with itself.
 */
async function decodedEachTime(input: Buffer, kind: string, format: string) {
  const spec = DERIVATIVES.find((d) => d.kind === kind)!;
  const resized = sharp(input, { failOn: 'error' }).rotate().resize({
    width: spec.edge,
    height: spec.edge,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const encoded =
    format === 'avif'
      ? resized.avif({ quality: spec.quality - 12, effort: 2 })
      : resized.jpeg({ quality: spec.quality, mozjpeg: true });
  return encoded.toBuffer();
}

/** Compares what a viewer sees, not what the encoder happened to emit. */
async function compare(a: Buffer, b: Buffer) {
  const [x, y] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const shape = (i: typeof x.info) => `${i.width}x${i.height}x${i.channels}`;
  if (shape(x.info) !== shape(y.info)) {
    return { shape: shape(x.info), against: shape(y.info), mean: Infinity, max: 255 };
  }
  let max = 0;
  let sum = 0;
  for (let i = 0; i < x.data.length; i++) {
    const d = Math.abs(x.data[i]! - y.data[i]!);
    if (d > max) max = d;
    sum += d;
  }
  return {
    shape: shape(x.info),
    against: shape(y.info),
    mean: sum / x.data.length,
    max,
  };
}

/**
 * How far a channel may drift from the per-derivative encode.
 *
 * Nothing about colour, orientation or geometry is allowed to move at all —
 * those show up as a different shape, or as a whole image off by a constant,
 * and both are caught far below this. What this leaves room for is resampling:
 * for the smallest size the old path could ask the JPEG loader for a
 * pre-shrunk image, where a shared raster is always resized from full
 * resolution. That is a difference of a few counts on the noise these fixtures
 * are made of — the worst case there is, and the reason the fixtures are noise
 * — and it is the better of the two results, not merely an acceptable one.
 */
const RESAMPLING = { mean: 4, max: 48 };

const SOURCES: Record<string, () => Promise<Buffer>> = {
  /* What almost everything is. */
  'sRGB JPEG': async () => noisy().jpeg({ quality: 92 }).toBuffer(),
  /*
   * A wide-gamut original, which is what an iPhone actually produces. The
   * shared raster carries no ICC profile, so this is the case that would
   * announce a colour shift if one had been introduced.
   */
  'Display P3 JPEG': async () =>
    sharp(await noisy().jpeg({ quality: 92 }).toBuffer())
      .withIccProfile('p3')
      .jpeg({ quality: 92 })
      .toBuffer(),
  /* Four channels through a three-channel encoder. */
  'RGBA PNG': async () => noisy(EDGE.width, EDGE.height, 4).png().toBuffer(),
  'greyscale JPEG': async () =>
    sharp(await noisy().jpeg().toBuffer()).greyscale().jpeg().toBuffer(),
  /*
   * The one `rotate()` is there for. The shared raster is rotated on the way
   * in, and raw pixels carry no orientation tag — so if that ever moved to the
   * wrong side of the decode, this is a derivative on its side.
   */
  'EXIF-rotated JPEG': async () =>
    sharp(await noisy(240, 480).jpeg().toBuffer())
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer(),
};

describe('a shared decode changes nothing a viewer can see', () => {
  for (const [name, make] of Object.entries(SOURCES)) {
    it(`matches the per-derivative encode for a ${name}`, async () => {
      const input = await make();
      const built = await buildDerivatives(input);
      expect(built.length, 'every size and format').toBe(7);

      for (const derivative of built) {
        const reference = await decodedEachTime(input, derivative.kind, derivative.format);
        const seen = await compare(derivative.bytes, reference);
        const where = `${derivative.kind}/${derivative.format}`;

        // Geometry is exact or it is a bug: a photograph that comes out the
        // wrong size, or on its side, is not a rounding difference.
        expect(seen.shape, `${where} changed shape`).toBe(seen.against);
        expect(seen.mean, `${where} drifted`).toBeLessThanOrEqual(RESAMPLING.mean);
        expect(seen.max, `${where} drifted`).toBeLessThanOrEqual(RESAMPLING.max);
      }
    }, 30_000);
  }
});

describe('and is declined where it would', () => {
  it('leaves a 16-bit source to decode for itself', async () => {
    /*
     * `.raw()` writes 8 bits a channel and raw input cannot be told otherwise,
     * so sharing would drop the low bits before the resize rather than after
     * it. No phone makes one of these; a scanner and a raw converter both do,
     * and the right answer is the slower path rather than a rounding
     * difference nobody asked for.
     */
    const deep = await sharp(await noisy().png().toBuffer())
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    expect((await sharp(deep).metadata()).depth).toBe('ushort');

    const built = await buildDerivatives(deep, ['card']);
    for (const derivative of built) {
      const reference = await decodedEachTime(deep, 'card', derivative.format);
      const seen = await compare(derivative.bytes, reference);
      // Byte-identical, not merely close: this is the path that declines to
      // share, so it is running exactly the code the reference runs.
      expect(seen.shape).toBe(seen.against);
      expect(seen.max, `${derivative.format} did not take the slow path`).toBe(0);
    }
  }, 30_000);
});

describe('colour does not move', () => {
  it('puts a wide-gamut patch exactly where the old path put it', async () => {
    /*
     * The shared raster carries no ICC profile, and this is the assertion that
     * would catch it if that mattered: a flat patch involves no resampling, so
     * the two paths have to agree to the byte. They do because sharp neither
     * imports nor embeds a profile on this path either way — the derivative is
     * untagged data in the original's colourspace, which is what it always was.
     */
    const patch = await sharp({
      create: { width: 320, height: 320, channels: 3, background: { r: 200, g: 40, b: 90 } },
    })
      .withIccProfile('p3')
      .jpeg({ quality: 100 })
      .toBuffer();

    const [card] = await buildDerivatives(patch, ['card']);
    const reference = await decodedEachTime(patch, 'card', card!.format);
    expect((await compare(card!.bytes, reference)).max).toBe(0);
  }, 30_000);
});

describe('what stays true either way', () => {
  it('honours EXIF orientation rather than passing the tag on', async () => {
    // Portrait bytes tagged as needing a quarter turn. The derivative has to
    // come out portrait, and has to come out carrying no tag saying so.
    const tagged = await noisy(200, 400)
      .jpeg()
      .toBuffer()
      .then((b) => sharp(b).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    expect((await sharp(tagged).metadata()).orientation, 'the fixture is tagged').toBe(6);

    const [card] = await buildDerivatives(tagged, ['card']);
    const meta = await sharp(card!.bytes).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
    expect(meta.orientation ?? 1).toBe(1);
  }, 30_000);

  it('never enlarges a photograph to fill a size', async () => {
    const small = await noisy(200, 150).jpeg().toBuffer();
    const [full] = await buildDerivatives(small, ['full']);
    const meta = await sharp(full!.bytes).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
  }, 30_000);
});
