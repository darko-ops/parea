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
 *     The foreground is not scaled. At radius 163 on centres 132 apart the
 *     mark's furthest point is 0.28 of the canvas from the middle and the
 *     tightest mask keeps 0.33, so it already fits — shrinking it would only
 *     make the mark smaller than the artwork it is taken from.
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

async function render(name, { size, source = svg, opaque = false }) {
  const image = sharp(Buffer.from(source), { density: 384 }).resize(size, size);

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
await render('adaptive-icon.png', { size: 1024, source: half('mark') });
await render('favicon.png', { size: 196, opaque: true });
