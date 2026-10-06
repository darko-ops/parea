/**
 * The copy of a photograph the child-safety provider is sent.
 *
 * PhotoDNA reads JPEG, PNG, GIF, BMP and TIFF, up to 4 MB and at least 160
 * pixels a side. An iPhone shoots HEIC. Sending one as it is would make every
 * photo from a phone a scan that could not be done — so the deriver sends a
 * JPEG of it, and these check that the copy is one the provider takes.
 */

import { PHOTODNA_LIMITS } from '@parea/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { canDecode, canDecodeViaHeifConvert, scanRendition } from '../src/derivatives';
import { HEVC_HEIC_SAMPLE } from '../src/fixture';

const image = (width: number, height: number, format: 'jpeg' | 'webp' | 'png') =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    [format]()
    .toBuffer();

const fitsPhotoDna = async (copy: { bytes: Buffer; mime: string }) => {
  expect(PHOTODNA_LIMITS.types).toContain(copy.mime);
  expect(copy.bytes.length).toBeLessThanOrEqual(PHOTODNA_LIMITS.maxBytes);
  const { width, height } = await sharp(copy.bytes).metadata();
  expect(Math.min(width!, height!)).toBeGreaterThanOrEqual(PHOTODNA_LIMITS.minSide);
  return { width: width!, height: height! };
};

describe('the copy sent for scanning', () => {
  it('is the photograph itself when it already fits', async () => {
    const jpeg = await image(800, 600, 'jpeg');
    const copy = await scanRendition(jpeg, 'image/jpeg', PHOTODNA_LIMITS);
    expect(copy.bytes).toBe(jpeg);
    expect(copy.mime).toBe('image/jpeg');
  });

  it('is untouched for a provider with no limits', async () => {
    const webp = await image(100, 100, 'webp');
    expect((await scanRendition(webp, 'image/webp', undefined)).bytes).toBe(webp);
  });

  it('turns a format the provider cannot read into a JPEG', async () => {
    const copy = await scanRendition(await image(1200, 900, 'webp'), 'image/webp', PHOTODNA_LIMITS);
    expect(copy.mime).toBe('image/jpeg');
    expect(await fitsPhotoDna(copy)).toEqual({ width: 1200, height: 900 });
  });

  it('enlarges one too small to be hashed, keeping its shape', async () => {
    const copy = await scanRendition(await image(120, 60, 'png'), 'image/png', PHOTODNA_LIMITS);
    expect(await fitsPhotoDna(copy)).toEqual({ width: 320, height: 160 });
  });

  it('shrinks one over the byte limit to the scan edge', async () => {
    // Noise, because a flat colour compresses to nothing and fits as it is.
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 60 } },
    })
      .png()
      .toBuffer();
    expect(big.length).toBeGreaterThan(PHOTODNA_LIMITS.maxBytes);
    const copy = await scanRendition(big, 'image/png', PHOTODNA_LIMITS);
    expect(copy.mime).toBe('image/jpeg');
    const { width } = await fitsPhotoDna(copy);
    expect(width).toBe(2048);
  });

  it('reads an iPhone HEIC, through libheif where sharp cannot', async (ctx) => {
    const readable =
      (await canDecode(HEVC_HEIC_SAMPLE)) || (await canDecodeViaHeifConvert(HEVC_HEIC_SAMPLE));
    if (!readable) ctx.skip();
    const copy = await scanRendition(HEVC_HEIC_SAMPLE, 'image/heic', PHOTODNA_LIMITS);
    expect(copy.mime).toBe('image/jpeg');
    await fitsPhotoDna(copy);
  });

  it('throws on bytes that are not an image, which the pipeline treats as no scan', async () => {
    await expect(
      scanRendition(Buffer.from('not a picture'), 'image/jpeg', PHOTODNA_LIMITS),
    ).rejects.toThrow();
  });
});
