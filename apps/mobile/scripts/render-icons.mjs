/**
 * Render every store asset from `assets/icon.svg`.
 *
 *   npm run icons --workspace @parea/mobile
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
 *     Which half gets what changed with the mark. It used to be the whole
 *     drawing shrunk into the safe circle over a flat `backgroundColor`,
 *     because the mark was a small coloured shape and the page around it was
 *     white. The mark is a hole in a field now: white circles on white would
 *     be nothing at all, so the field is the background and the mark is the
 *     foreground, which is also what the two layers are actually for.
 *
 *     The foreground is scaled into the safe circle, and "it already fits" is
 *     not the same claim. At radius 163 on centres 132 apart the mark's
 *     furthest point is 0.28 of the canvas from the middle and the tightest
 *     mask keeps 0.33 — so it survives, and it survives filling four fifths of
 *     everything the launcher shows. The iOS icon puts the same mark across
 *     54% of a square nothing is cut from. Shrinking to `ANDROID_SAFE` is what
 *     makes the two read as one icon rather than as a logo and a crop of it.
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
 * By id rather than by pattern-matching a fill, which is what this did before
 * and which broke the first time the file changed: it looked for the white
 * backing rect and threw when the rect stopped being the only white one. An id
 * is a thing the SVG declares on purpose.
 */
function half(id) {
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/);
  if (!defs) throw new Error('no <defs> in icon.svg');

  const open = svg.indexOf(`id="${id}"`);
  if (open < 0) throw new Error(`no element with id="${id}" in icon.svg`);
  const start = svg.lastIndexOf('<', open);
  const tag = svg.slice(start + 1).match(/^[a-z]+/)?.[0];
  if (!tag) throw new Error(`could not read the tag of id="${id}"`);

  /*
   * Where the opening tag ends decides which kind of element this is.
   *
   * Looking for the first `/>` after the id does not: `<g id="field">` has
   * eight self-closing rects inside it, so the first `/>` in the document
   * after the id belongs to a child and the group is cut off at its first
   * line. Read the opening tag to its own `>` and ask whether that `>` was
   * preceded by a slash.
   */
  const openEnd = svg.indexOf('>', open);
  if (openEnd < 0) throw new Error(`unterminated opening tag for id="${id}"`);
  const selfClosing = svg[openEnd - 1] === '/';

  let end;
  if (selfClosing) {
    end = openEnd + 1;
  } else {
    // Nothing in this file nests an element inside another of the same tag,
    // so the first matching close is the right one.
    const pairClose = svg.indexOf(`</${tag}>`, openEnd);
    if (pairClose < 0) throw new Error(`no </${tag}> closing id="${id}"`);
    end = pairClose + `</${tag}>`.length;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${
    defs[0]
  }${svg.slice(start, end)}</svg>`;
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

  const png = await (opaque ? image.flatten({ background: '#ffffff' }) : image)
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
