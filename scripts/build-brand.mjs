/**
 * The Parea mark and icon, constructed rather than drawn.
 *
 *   node scripts/build-brand.mjs
 *
 * Everything under `assets/branding/` is emitted by this file. Nothing there
 * should be edited by hand: the geometry is six numbers and the gradient is a
 * table, and a hand-edit to either is a change nobody can find again.
 *
 * ## The mark
 *
 * Three identical circles on the vertices of an equilateral triangle, point
 * up, filled as one compound path with `fill-rule="evenodd"`. Parity does the
 * work: a region covered an odd number of times is white, an even number is
 * not painted at all. So the three pairwise lenses are holes and the centre —
 * covered three times — comes back white.
 *
 * That is the whole of it, and it is why there is no opacity anywhere in the
 * mark. The colour inside the lenses is the background showing through a hole,
 * not white at 60% over it. Three translucent circles would give every lens
 * the same washed tint; holes give each one whatever the field happens to be
 * underneath, which is what makes the mark look interlocked rather than
 * stacked.
 *
 * ## Optical centring, which is between two measurements rather than either
 *
 * There are two defensible answers and they are 33 units apart.
 *
 * The painted area balances at the triangle's own centre — necessarily, since
 * three circles 120° apart give the shape 3-fold rotational symmetry, and
 * `centroidOf` confirms it by parity over a fine grid rather than by argument.
 * Centre on that and the mass is even.
 *
 * But the extents are not: one circle reaches up and two reach down, so the
 * bounding box runs 312 above the middle and 246 below. Rendered and looked
 * at, that sits visibly high — the eye reads the gap under the mark as slack.
 * Centre the bounding box instead and it settles, a shade heavily.
 *
 * So the mark is placed halfway between them. Neither measurement is wrong and
 * the difference is small; splitting it is the judgement, and it is written
 * down here rather than folded into a coordinate so that changing the radius
 * re-derives it instead of inheriting a number nobody can explain.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'branding');

/** The artboard. Square, and every number below is in its units. */
const SIZE = 1024;

/**
 * The circle, and how far each centre sits from the middle of the triangle.
 *
 * `D` is the circumradius of the triangle the three centres sit on, and 132 is
 * inherited from the mark this replaces — it is the number that decides how
 * much the circles overlap, and therefore how big the three lenses and the
 * centre come out.
 *
 * `R` is 180 rather than the brief's 172, and the 40px render is why. A lens
 * is `2R - D√3` thick along the line joining two centres, so at 172 it was
 * 115 units — four and a half pixels at 40, which is a smudge rather than a
 * hole. 180 makes it 131, and five pixels is a shape.
 *
 * What the pair produces, both inside the brief's targets:
 *
 *   width   2 × (D·sin60 + R)  = 588.6  →  57.5% of the artboard
 *   height  1.5D + 2R          = 558.0  →  54.5%
 *
 * The ratio is what actually matters: D/R = 0.733. Spread them and the lenses
 * thin to slivers and the mark stops reading as interlocked; close them and
 * the centre swells until it reads as one blob with notches taken out. 186
 * would give a thicker lens still and puts the height at 55.7%, outside the
 * brief; 126 would too and grows the middle by a third. This is the band where
 * all three regions survive at the smallest size anybody sees.
 */
const R = 180;
const D = 132;

/** 120° apart, first one straight up. */
const ANGLES = [-90, 30, 150];

function centres(cx, cy) {
  return ANGLES.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { cx: cx + D * Math.cos(rad), cy: cy + D * Math.sin(rad) };
  });
}

/**
 * Where the painted area balances, by parity.
 *
 * Sampled rather than integrated: the even-odd region is three circles minus
 * three lenses plus a Reuleaux-ish middle, and the closed form is a page of
 * trigonometry to answer a question a grid answers exactly well enough. 2000
 * steps across the mark is a quarter of a pixel at 1024.
 */
function centroidOf(circles) {
  const STEPS = 2000;
  const minX = Math.min(...circles.map((c) => c.cx)) - R;
  const maxX = Math.max(...circles.map((c) => c.cx)) + R;
  const minY = Math.min(...circles.map((c) => c.cy)) - R;
  const maxY = Math.max(...circles.map((c) => c.cy)) + R;

  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (let i = 0; i < STEPS; i++) {
    const y = minY + ((i + 0.5) * (maxY - minY)) / STEPS;
    for (let j = 0; j < STEPS; j++) {
      const x = minX + ((j + 0.5) * (maxX - minX)) / STEPS;
      let covered = 0;
      for (const c of circles) {
        if ((x - c.cx) ** 2 + (y - c.cy) ** 2 <= R * R) covered++;
      }
      if (covered % 2 === 1) {
        sumX += x;
        sumY += y;
        n++;
      }
    }
  }
  return { x: sumX / n, y: sumY / n, area: (n / (STEPS * STEPS)) * (maxX - minX) * (maxY - minY) };
}

/** A circle as a closed subpath: two half-arcs, which is how a path draws one. */
const circlePath = ({ cx, cy }) =>
  `M ${round(cx - R)} ${round(cy)} ` +
  `a ${R} ${R} 0 1 0 ${R * 2} 0 ` +
  `a ${R} ${R} 0 1 0 ${-R * 2} 0 Z`;

const round = (n) => Number(n.toFixed(2));

/**
 * The field: seven blooms over a base, and the anchors are the brief's.
 *
 * Three of them are the structure — pink across the top, periwinkle into the
 * lower left, mint into the lower right — and the other four are the
 * transitions the brief names: lavender where pink meets blue, peach where
 * pink meets mint, cyan along the bottom where blue meets mint, and a second
 * mint holding the right edge.
 *
 * `ease` is the reason none of them shows an edge. A stop list that runs alpha
 * straight from 1 to 0 puts a visible ring at the radius, because the slope
 * changes abruptly where the fade ends; these stops approach zero gently
 * enough that the boundary has nowhere to appear. The centres are also placed
 * well outside the middle, so the only part of each bloom on the artboard is
 * its broad shoulder.
 */
const EASE = [
  [0, 1],
  [0.32, 0.86],
  [0.56, 0.58],
  [0.76, 0.27],
  [0.9, 0.08],
  [1, 0],
];

const BLOOMS = [
  /*
   * The three fields, and their radii are larger than the artboard on purpose.
   *
   * At 0.72 each one's shoulder had faded to about 45% by the time it reached
   * the middle, so the centre of the picture was mostly `BASE` — and the
   * centre of the picture is exactly where the mark's three lenses are. They
   * came out grey. A fade wider than the canvas is flatter across it: the
   * colour still moves from corner to corner, but no part of the field is
   * starved, and the lenses have something to show.
   */
  { id: 'pink', color: '#FFA0B4', cx: 0.5, cy: -0.02, r: 1.02 },
  { id: 'blue', color: '#76A7FF', cx: 0.0, cy: 0.76, r: 1.06 },
  { id: 'mint', color: '#83EFCB', cx: 1.0, cy: 0.78, r: 1.06 },
  /*
   * The transitions, and they are kept small on purpose.
   *
   * At half the artboard the lavender owned the upper left and the peach owned
   * the upper right, which left the pink as a band between two louder colours
   * — three fields of pink, blue and green with a fourth and a fifth arguing
   * over the top edge. The brief calls these a transition and a *very subtle*
   * warmth, and that is a size as much as a colour.
   */
  { id: 'lavender', color: '#D99BEF', cx: 0.04, cy: 0.14, r: 0.42 },
  { id: 'peach', color: '#FFD29A', cx: 0.98, cy: 0.1, r: 0.34 },
  { id: 'cyan', color: '#63D8EF', cx: 0.44, cy: 1.02, r: 0.5 },
  { id: 'green', color: '#8CEEC0', cx: 1.04, cy: 0.44, r: 0.38 },
];

/**
 * What shows where nothing reaches full strength, which is the four corners.
 *
 * A corner is 1.41 times as far from the middle as an edge is and a circular
 * fade does not know the difference, so without this the corners come out the
 * most saturated part of the picture. Pale rather than white: the brief asks
 * for airy, and white corners on a pastel field read as a vignette rather than
 * as air.
 */
const BASE = '#FBF6FA';

function gradientDefs() {
  return BLOOMS.map(
    ({ id, color, cx, cy, r }) => `    <radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">
${EASE.map(
  ([offset, opacity]) =>
    `      <stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`,
).join('\n')}
    </radialGradient>`,
  ).join('\n');
}

const fieldRects = () =>
  [`    <rect width="${SIZE}" height="${SIZE}" fill="${BASE}"/>`]
    .concat(BLOOMS.map(({ id }) => `    <rect width="${SIZE}" height="${SIZE}" fill="url(#${id})"/>`))
    .join('\n');

// --- geometry ----------------------------------------------------------------

// Measure both centres from one trial placement, then sit between them. One
// pass is exact for each: translating the shape translates both by the same
// amount.
const trial = centres(SIZE / 2, SIZE / 2);
const balance = centroidOf(trial);
const trialBox = {
  top: Math.min(...trial.map((c) => c.cy)) - R,
  bottom: Math.max(...trial.map((c) => c.cy)) + R,
};
/** What centring the mass would ask for, and what centring the extents would. */
const byMass = SIZE / 2 - balance.y;
const byBox = SIZE / 2 - (trialBox.top + trialBox.bottom) / 2;

const CX = SIZE / 2 + (SIZE / 2 - balance.x);
const CY = SIZE / 2 + (byMass + byBox) / 2;
const CIRCLES = centres(CX, CY).map(({ cx, cy }) => ({ cx: round(cx), cy: round(cy) }));

const markPath = CIRCLES.map(circlePath).join('\n    ');

const bounds = {
  left: Math.min(...CIRCLES.map((c) => c.cx)) - R,
  right: Math.max(...CIRCLES.map((c) => c.cx)) + R,
  top: Math.min(...CIRCLES.map((c) => c.cy)) - R,
  bottom: Math.max(...CIRCLES.map((c) => c.cy)) + R,
};

// --- the three documents ------------------------------------------------------

const MARK = `<!--
  The Parea mark: three circles, one compound path, even-odd.

  Generated by scripts/build-brand.mjs. Do not edit by hand.

  Odd coverage is white and even coverage is not painted, so the three pairwise
  lenses are holes and the centre — covered three times — is white again. There
  is no opacity anywhere: whatever shows through a lens is whatever is behind
  the mark, which is what makes three circles read as interlocked rather than
  as stacked and translucent.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <path id="mark" fill="#FFFFFF" fill-rule="evenodd" d="
    ${markPath}
  "/>
</svg>
`;

const ICON = `<!--
  The Parea app icon: the mark over the pastel field.

  Generated by scripts/build-brand.mjs. Do not edit by hand.

  Full bleed and no corner radius, deliberately. iOS applies its own mask and
  App Store Connect refuses an alpha channel, so rounding here would round
  twice and put a transparent corner inside the mask. See
  parea-icon-preview.svg for the intended presentation.

  The two halves are named so a renderer can take them apart: Android composites
  an adaptive icon from a background and a foreground and masks the pair, so the
  field goes in one and the mark in the other.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
${gradientDefs()}
  </defs>

  <g id="field">
${fieldRects()}
  </g>

  <path id="mark" fill="#FFFFFF" fill-rule="evenodd" d="
    ${markPath}
  "/>
</svg>
`;

/**
 * The corner the platforms apply, drawn here only so the intended presentation
 * can be looked at. 224 of 1024 is the superellipse iOS approximates, to the
 * nearest value a rounded rect can express.
 */
const PREVIEW_RADIUS = 224;

const PREVIEW = `<!--
  The Parea icon as a platform presents it — a preview, not an asset.

  Generated by scripts/build-brand.mjs. Do not edit by hand.

  The corner is here and nowhere else. Shipping a rounded icon is the classic
  mistake: iOS masks it again and the baked corner shows as a dark notch inside
  the real one.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
${gradientDefs()}
    <clipPath id="squircle">
      <rect width="${SIZE}" height="${SIZE}" rx="${PREVIEW_RADIUS}" ry="${PREVIEW_RADIUS}"/>
    </clipPath>
  </defs>

  <g clip-path="url(#squircle)">
${fieldRects()}
    <path fill="#FFFFFF" fill-rule="evenodd" d="
      ${markPath}
    "/>
  </g>
</svg>
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'parea-mark.svg'), MARK);
await writeFile(join(OUT, 'parea-icon.svg'), ICON);
await writeFile(join(OUT, 'parea-icon-preview.svg'), PREVIEW);

for (const px of [1024, 512, 256, 128]) {
  const png = await sharp(Buffer.from(ICON), { density: 512 })
    .resize(px, px)
    // Opaque, because this is the app-icon master and App Store Connect
    // refuses an alpha channel. The field covers the artboard anyway.
    .flatten({ background: BASE })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, `parea-icon-${px}.png`), png);
}

console.log('radius        ', R);
console.log('spread (D)    ', D, ` — D/R ${(D / R).toFixed(3)}`);
console.log('centres       ', CIRCLES.map((c) => `(${c.cx}, ${c.cy})`).join('  '));
console.log(
  'mark bounds   ',
  `x ${round(bounds.left)}..${round(bounds.right)}  y ${round(bounds.top)}..${round(bounds.bottom)}`,
);
console.log(
  'mark size     ',
  `${round(bounds.right - bounds.left)} × ${round(bounds.bottom - bounds.top)}` +
    `  (${((bounds.right - bounds.left) / SIZE * 100).toFixed(1)}% × ${((bounds.bottom - bounds.top) / SIZE * 100).toFixed(1)}%)`,
);
console.log(
  'centring      ',
  `mass would sit at ${round(SIZE / 2 + byMass - byMass)} + ${round(byMass)}, ` +
    `extents at + ${round(byBox)} — placed at + ${round((byMass + byBox) / 2)}`,
);
console.log(
  'margins       ',
  `${round(bounds.top)} above the mark, ${round(SIZE - bounds.bottom)} below`,
);
console.log('files         ', 'parea-mark.svg  parea-icon.svg  parea-icon-preview.svg');
console.log('              ', [1024, 512, 256, 128].map((p) => `parea-icon-${p}.png`).join('  '));
