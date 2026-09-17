/**
 * Render every store asset from the brand master.
 *
 *   npm run icons --workspace @parea/mobile
 *
 * The master is `assets/branding/parea-icon-color.jpg` at the root of the
 * repository: the mark on a saturated field, supplied as artwork rather than
 * generated. It replaced `parea-icon.svg`, which this built from until now.
 *
 * ## Why the app icon stopped being the vector
 *
 * The SVG is still the master everywhere a Parea mark is *drawn* — the web's
 * `Mark`, the rail, the OG image — and `build-brand.mjs` still produces it.
 * What it is no longer is the app icon, because the two are not the same
 * problem. A drawing in a page sits on that page's background and has to work
 * in one ink at any size. An app icon is a 60pt tile on somebody's home screen
 * competing with sixty others, seen for a fifth of a second, and the thing
 * that wins there is colour. The field on this raster is doing work the
 * vector's pale wash could not.
 *
 * So: one file, rendered into four, and the SVG keeps the jobs it is better at.
 *
 * Run it after changing the JPG. The PNGs are committed — EAS builds do not
 * run this, and an icon that only exists on the machine of whoever last
 * touched it is how the Expo default ends up shipping.
 *
 * The four outputs are not four sizes of the same picture:
 *
 *   - `icon.png` is what iOS shows. Fully opaque and square, because App
 *     Store Connect rejects an alpha channel and because iOS applies its own
 *     corner mask — round the corners here and they get rounded twice.
 *
 *   - `adaptive-icon.png` is the Android *foreground* and `adaptive-background
 *     .png` is what it sits on. The launcher masks the pair to a circle, a
 *     squircle or a squarish blob depending on the device, so the background
 *     runs full bleed and the foreground keeps everything that matters inside
 *     the middle ~66%.
 *
 *     The whole picture is the background here, and the foreground is empty.
 *     That is deliberate and it is what a single raster allows.
 *
 *     Splitting the two needs the field without the mark on it, and this is
 *     one flattened image — the field under those circles does not exist to
 *     be recovered. Putting the mark in the foreground *and* leaving it in the
 *     background aligns exactly at rest and doubles the moment a launcher
 *     applies its parallax, which is the artefact you cannot unsee once you
 *     have. An empty foreground has nothing to shift and is therefore right in
 *     both states.
 *
 *     It survives the mask because of where the mark sits: it spans 54% of the
 *     square, centred, and the tightest mask keeps the middle 66%. Measured
 *     off the file rather than assumed — see `assets.test.ts`, which reads the
 *     pixels and fails if new artwork pushes the mark outside the safe circle.
 *
 *   - `favicon.png` is for `expo start --web`, which is not the product, but
 *     the alternative is Expo's default in a browser tab.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'assets');
/** The brand master, two levels up at the root of the repository. */
const SOURCE = join(HERE, '..', '..', '..', 'assets', 'branding', 'parea-icon-color.jpg');

/**
 * Fraction of the canvas Android's most aggressive mask keeps.
 *
 * Also, and not by coincidence, the factor that gives the mark the same weight
 * inside a circular mask that it has inside the iOS square: 54% of a full
 * bleed square is 54% of 66% once the launcher has finished with it, and
 * 0.54 × 0.66 is what the foreground has to span to match.
 */
const ANDROID_SAFE = 0.66;

const master = await readFile(SOURCE);

/**
 * A transparent square, which is what Android's foreground layer gets.
 *
 * See the note at the top: the whole picture is the background, because a
 * flattened raster cannot be taken apart into a field and a mark, and drawing
 * the mark in both layers doubles it under parallax.
 */
const EMPTY = { create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };

async function render(name, { size, source = master, safe = false, opaque = false }) {
  const art = safe ? Math.round(size * ANDROID_SAFE) : size;
  const pad = Math.round((size - art) / 2);

  let image = (Buffer.isBuffer(source) ? sharp(source) : sharp(source)).resize(art, art);

  if (pad > 0) {
    image = sharp(await image.png().toBuffer()).extend({
      top: pad,
      bottom: size - art - pad,
      left: pad,
      right: size - art - pad,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    });
  }

  const png = await (opaque ? image.flatten({ background: '#ffffff' }) : image)
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(join(ASSETS, name), png);
  const { width, height, channels } = await sharp(png).metadata();
  console.log(`${name.padEnd(24)} ${width}x${height}  ${channels} channels`);
}

await mkdir(ASSETS, { recursive: true });
await render('icon.png', { size: 1024, opaque: true });
// Full bleed, mark and all. The launcher's mask keeps the middle; the mark is
// inside it.
await render('adaptive-background.png', { size: 1024, opaque: true });
await render('adaptive-icon.png', { size: 1024, source: EMPTY });
await render('favicon.png', { size: 196, opaque: true });
