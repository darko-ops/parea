/**
 * The store assets exist, are the right shape, and are actually referenced.
 *
 * Expo ships a default icon when none is configured. It is a perfectly good
 * icon of somebody else's product, and nothing about a build going out with it
 * looks like a failure — `eas build` succeeds, the app installs, the launcher
 * shows a picture. You find out from the store listing.
 *
 * The rejections this guards against are the ones that cost a review cycle
 * rather than a minute:
 *
 *   - an icon that is not exactly 1024×1024;
 *   - an icon with an alpha channel, which App Store Connect refuses outright;
 *   - `app.json` naming a file that is not there, which silently falls back to
 *     the default rather than erroring.
 *
 * Read out of the PNG header rather than with an image library, because the
 * native client has no image dependency and adding one to assert two integers
 * would be a worse trade than eighteen lines of parser.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import config from '../app.json';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Colour types that carry alpha, from the PNG spec's IHDR. */
const WITH_ALPHA = new Set([4, 6]);

type Png = { width: number; height: number; hasAlpha: boolean };

/**
 * IHDR is fixed-layout and always the first chunk, so the numbers are at known
 * offsets: width and height as big-endian 32-bit at 16 and 20, colour type as
 * one byte at 25.
 */
async function png(relative: string): Promise<Png> {
  const bytes = await readFile(join(ROOT, relative));
  expect(bytes.subarray(0, 8), `${relative} is not a PNG`).toEqual(PNG_MAGIC);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: WITH_ALPHA.has(bytes.readUInt8(25)),
  };
}

describe('store assets', () => {
  it('are the ones app.json points at', () => {
    // Not a hardcoded list of paths — whatever the config claims is what gets
    // checked below, so renaming a file cannot quietly leave this passing
    // against the old one.
    expect(config.expo.icon).toBe('./assets/icon.png');
    expect(config.expo.android.adaptiveIcon.foregroundImage).toBe(
      './assets/adaptive-icon.png',
    );
    expect(config.expo.android.adaptiveIcon.backgroundImage).toBe(
      './assets/adaptive-background.png',
    );
    expect(config.expo.web.favicon).toBe('./assets/favicon.png');
  });

  it('give iOS a square opaque 1024', async () => {
    const icon = await png(config.expo.icon);

    expect(icon.width).toBe(1024);
    expect(icon.height).toBe(1024);
    // The one that is a hard rejection rather than a resize.
    expect(icon.hasAlpha).toBe(false);
  });

  it('give Android an empty foreground, because the picture is one layer', async () => {
    const adaptive = await png(config.expo.android.adaptiveIcon.foregroundImage);

    expect(adaptive.width).toBe(1024);
    expect(adaptive.height).toBe(1024);
    /*
     * Transparent, and transparent all the way through.
     *
     * The artwork is a flattened raster: the field underneath those circles
     * does not exist to be recovered, so it cannot be split into a field and a
     * mark. Drawing the mark in the foreground *and* leaving it in the
     * background lines up exactly at rest and doubles the moment a launcher
     * applies its parallax. An empty foreground has nothing to shift.
     */
    expect(adaptive.hasAlpha).toBe(true);
    expect(config.expo.android.adaptiveIcon.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives Android the whole picture as the background layer', async () => {
    /*
     * Full bleed and opaque, because the mask can be a circle and a background
     * that stops short of the corners loses its edges on the devices that
     * round hardest.
     */
    const background = await png(config.expo.android.adaptiveIcon.backgroundImage);

    expect(background.width).toBe(1024);
    expect(background.height).toBe(1024);
    expect(background.hasAlpha).toBe(false);
  });

  it('keeps the mark inside the tightest mask a launcher applies', async () => {
    /*
     * The one thing carrying the whole picture in one layer depends on, and
     * the one thing a new piece of artwork could quietly break.
     *
     * Android masks the background to a circle, a squircle or a blob, and the
     * tightest of those keeps the middle 66%. Nothing holds the mark inside
     * that any more — there is no `ANDROID_SAFE` scale applied to a foreground
     * — so it is a property of where the mark happens to sit in the file. This
     * reads the pixels and finds out.
     *
     * Near-white and near-neutral is the mark; the field is saturated
     * everywhere. Measured off `icon.png` because that is the square Android
     * masks, not off the JPG it came from.
     */
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(join(ROOT, config.expo.icon));
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });

    /*
     * The furthest mark *pixel* from the centre, not the furthest corner of
     * its bounding box.
     *
     * The first version of this measured the box and failed at 0.38, which was
     * the test being wrong rather than the artwork: three circles do not fill
     * their box, and the corner it was measuring is field. The mask is a
     * circle about the centre, so the only question is how far the drawing
     * actually reaches.
     */
    const half = info.width / 2;
    let reach = 0;
    let found = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const low = Math.min(r, g, b);
        const high = Math.max(r, g, b);
        if (low > 235 && high - low < 12) {
          found++;
          reach = Math.max(reach, Math.hypot(x - half, y - half));
        }
      }
    }

    // It found a mark at all, rather than an all-saturated square — without
    // this the assertion below passes on a reach of zero.
    expect(found).toBeGreaterThan(info.width * info.height * 0.1);

    // 0.33 of the canvas is the radius the tightest mask keeps. This sits at
    // about 0.30, so there is room but not a great deal of it.
    expect(reach / info.width).toBeLessThan(0.33);
  });

  it('have a favicon at all', async () => {
    const favicon = await png(config.expo.web.favicon);

    expect(favicon.width).toBe(favicon.height);
    expect(favicon.width).toBeGreaterThanOrEqual(48);
  });
});
