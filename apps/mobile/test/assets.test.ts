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

  it('gives Android the mark as its foreground', async () => {
    const adaptive = await png(config.expo.android.adaptiveIcon.foregroundImage);

    expect(adaptive.width).toBe(1024);
    expect(adaptive.height).toBe(1024);
    /*
     * Transparent, because it is the mark and nothing else — the field is the
     * layer underneath.
     *
     * It was an empty square for a while. The icon was a supplied JPG then,
     * and a flattened raster cannot be taken apart: the field under those
     * circles does not exist to be recovered, and drawing the mark in both
     * layers lines up at rest and doubles the moment a launcher applies its
     * parallax. The master is a vector again and names its halves, so the two
     * layers are what they are for.
     */
    expect(adaptive.hasAlpha).toBe(true);
    expect(config.expo.android.adaptiveIcon.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives Android the field as its background layer', async () => {
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

  it('gives the mark the same weight on both platforms', async () => {
    /*
     * The one thing the split can get wrong that still looks fine on its own.
     *
     * A launcher shows the middle two thirds of an adaptive icon, so a
     * foreground drawn full size arrives cropped — and a foreground drawn
     * small arrives as a logo floating in a circle. Neither looks broken; both
     * look like a different app from the iOS one.
     *
     * So this measures the mark in each and compares what a person sees: its
     * width against the iOS square, and its width against the circle Android
     * actually shows. `ANDROID_SAFE` is what makes those agree, and this is
     * the assertion that says so.
     */
    const { default: sharp } = await import('sharp');
    const { readFile } = await import('node:fs/promises');

    const spanOf = async (relative: string, of: number) => {
      const { data, info } = await sharp(await readFile(join(ROOT, relative)))
        .raw()
        .toBuffer({ resolveWithObject: true });
      let min = info.width;
      let max = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * info.channels;
          // White, and opaque where there is an alpha channel to ask about.
          const lit =
            data[i]! > 240 &&
            data[i + 1]! > 240 &&
            data[i + 2]! > 240 &&
            (info.channels < 4 || data[i + 3]! > 240);
          if (lit) {
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
      }
      return (max - min) / of;
    };

    const onIos = await spanOf(config.expo.icon, 1024);
    // Against the circle, not the canvas: the middle two thirds is all of the
    // adaptive icon anybody ever sees.
    const onAndroid = await spanOf(
      config.expo.android.adaptiveIcon.foregroundImage,
      1024 * 0.667,
    );

    expect(onIos).toBeGreaterThan(0.5);
    expect(onAndroid).toBeGreaterThan(0.5);
    expect(Math.abs(onIos - onAndroid)).toBeLessThan(0.04);
  });

  it('have a favicon at all', async () => {
    const favicon = await png(config.expo.web.favicon);

    expect(favicon.width).toBe(favicon.height);
    expect(favicon.width).toBeGreaterThanOrEqual(48);
  });
});
