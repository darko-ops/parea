/**
 * Render every store asset from the brand master.
 *
 *   npm run icons --workspace @parea/mobile
 *
 * The master is `assets/branding/parea-icon-dark-refined.svg` at the root of
 * the repository, which `scripts/build-icon.mjs` generates.
 *
 * ## Three masters, and which one is the icon
 *
 * `parea-icon.svg` is the pale mark, and it is still what a Parea logo *drawn
 * in a page* means — the web's `Mark`, the rail, the OG image. It was the app
 * icon too, and it should not have been: a drawing on a page sits on that
 * page's background, where an app icon is a 60pt tile among sixty others seen
 * for a fifth of a second, and what wins there is colour.
 *
 * A supplied JPG held the job for a while and did that part well. The dark SVG
 * replaces it because it is the same picture with the one thing a flattened
 * raster cannot give: a field and a mark that come apart. Android wants them
 * apart — see below — and with the JPG the only honest answer was to put the
 * whole picture in the background and leave the foreground empty.
 *
 * Run it after changing the SVG. The PNGs are committed — EAS builds do not
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
 *     The field is the background and the mark is the foreground, which is
 *     what the two layers are actually for — and what a vector master makes
 *     possible again. The SVG names its halves, so this takes them apart by
 *     id rather than by cutting up pixels.
 *
 *     The foreground is scaled into the safe circle, and "it already fits" is
 *     not the same claim. The mark spans 57% of a square nothing is cut from;
 *     inside a circular mask the tightest launcher keeps two thirds, so
 *     shrinking to `ANDROID_SAFE` is what makes the two platforms read as one
 *     icon rather than as a logo and a crop of it.
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
const SOURCE = join(HERE, '..', '..', '..', 'assets', 'branding', 'parea-icon-dark-refined.svg');

/**
 * Fraction of the canvas Android's most aggressive mask keeps.
 *
 * Also, and not by coincidence, the factor that gives the mark the same weight
 * inside a circular mask that it has inside the iOS square: 54% of a full
 * bleed square is 54% of 66% once the launcher has finished with it, and
 * 0.54 × 0.66 is what the foreground has to span to match.
 */
const ANDROID_SAFE = 0.66;

const svg = await readFile(SOURCE, 'utf8');

/**
 * One half of the drawing, by id.
 *
 * `<defs>` goes with both, because the field's gradients live there and an
 * element referencing a paint that is not in the document renders as nothing —
 * silently, which is the failure worth designing against here.
 *
 * By id rather than by pattern-matching a fill. An id is a thing the SVG
 * declares on purpose; a fill is a thing that changes when somebody adjusts a
 * colour, and an extractor that breaks on a palette change is an extractor
 * that breaks without saying so.
 */
function half(id) {
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/);
  if (!defs) throw new Error('no <defs> in the icon');

  const open = svg.indexOf(`<g id="${id}">`);
  if (open < 0) throw new Error(`no <g id="${id}"> in the icon`);
  // Nothing in this file nests a `g` inside a `g`, so the first close is this
  // group's own.
  const close = svg.indexOf('</g>', open);
  if (close < 0) throw new Error(`no </g> closing id="${id}"`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
    `${defs[0]}${svg.slice(open, close + 4)}</svg>`
  );
}

async function render(name, { size, source = svg, safe = false, opaque = false }) {
  const art = safe ? Math.round(size * ANDROID_SAFE) : size;
  const pad = Math.round((size - art) / 2);

  let image = sharp(Buffer.from(source), { density: 384 }).resize(art, art);

  if (pad > 0) {
    image = sharp(await image.png().toBuffer()).extend({
      top: pad,
      bottom: size - art - pad,
      left: pad,
      right: size - art - pad,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    });
  }

  /*
   * Flattened onto the icon's own top-left colour rather than white.
   *
   * Only `icon.png` is opaque, and it is full bleed — so nothing of the
   * background shows and the colour is academic. It matters anyway: App Store
   * Connect refuses an alpha channel, and a white flatten under a dark
   * gradient is a white halo the day somebody changes the geometry and the art
   * stops reaching a corner.
   */
  const png = await (opaque ? image.flatten({ background: '#4A1E63' }) : image)
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(join(ASSETS, name), png);
  const { width, height, channels } = await sharp(png).metadata();
  console.log(`${name.padEnd(24)} ${width}x${height}  ${channels} channels`);
}

await mkdir(ASSETS, { recursive: true });
await render('icon.png', { size: 1024, opaque: true });
await render('adaptive-background.png', { size: 1024, source: half('field'), opaque: true });
await render('adaptive-icon.png', { size: 1024, source: half('mark'), safe: true });
await render('favicon.png', { size: 196, opaque: true });
