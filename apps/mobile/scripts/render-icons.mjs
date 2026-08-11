/**
 * Render every store asset from `assets/icon.svg`.
 *
 *   npm run icons --workspace parea-mobile
 *
 * Run it after changing the SVG. The PNGs are committed — EAS builds do not
 * run this, and an icon that only exists on the machine of whoever last
 * touched it is how the Expo default ends up shipping.
 *
 * The three outputs are not three sizes of the same picture:
 *
 *   - `icon.png` is what iOS shows. Fully opaque and square, because App
 *     Store Connect rejects an alpha channel and because iOS applies its own
 *     corner mask — round the corners here and they get rounded twice.
 *
 *   - `adaptive-icon.png` is only the Android *foreground*, composited over
 *     `android.adaptiveIcon.backgroundColor`, and the launcher may mask it to
 *     a circle, a squircle or a squarish blob depending on the device. Only
 *     the middle ~66% survives all of them, so the artwork is scaled into that
 *     safe circle and the rest is transparent. Shipping the full-bleed icon
 *     here is the classic mistake: it looks right in the emulator and loses
 *     its edges on a phone that masks to a circle.
 *
 *   - `favicon.png` is for `expo start --web`, which is not the product, but
 *     the alternative is Expo's default in a browser tab.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SOURCE = join(ASSETS, 'icon.svg');

/** Fraction of the canvas Android's most aggressive mask keeps. */
const ANDROID_SAFE = 0.66;

const svg = await readFile(SOURCE, 'utf8');

/**
 * The same drawing without its white backing square.
 *
 * Only the Android foreground wants this. Leaving the square in would put a
 * white tile inside the launcher's mask — the circles floating on a rounded
 * white card, on top of whatever background colour the launcher composites —
 * which is the exact bug the safe-zone inset is there to avoid.
 */
function transparent(source) {
  const stripped = source.replace(/<rect[^>]*fill="#ffffff"[^>]*\/>/, '');
  if (stripped === source) throw new Error('background rect not found — did icon.svg change?');
  return stripped;
}

async function render(name, { size, safe = false, opaque = false }) {
  const art = safe ? Math.round(size * ANDROID_SAFE) : size;
  const pad = Math.round((size - art) / 2);

  let image = sharp(Buffer.from(safe ? transparent(svg) : svg), { density: 384 })
    .resize(art, art);

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
  console.log(`${name.padEnd(20)} ${width}x${height}  ${channels} channels`);
}

await mkdir(ASSETS, { recursive: true });
await render('icon.png', { size: 1024, opaque: true });
await render('adaptive-icon.png', { size: 1024, safe: true });
await render('favicon.png', { size: 196, opaque: true });
