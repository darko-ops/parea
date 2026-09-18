/**
 * The dark app icon, built rather than drawn.
 *
 *   node scripts/build-icon.mjs
 *
 * Every number here is derived from three: the circle radius, the distance
 * from the mark's centroid to each circle's centre, and the canvas. Nothing is
 * traced and nothing is nudged by hand — which is the point, because an icon
 * that was nudged by hand cannot be re-derived at a different size or with a
 * different palette without being nudged again.
 *
 * It sits beside `build-brand.mjs`, which makes the pale version. Two icons,
 * one geometry: `MARK` below is the only place the shape exists, and both the
 * symbol-only file and the full icon read it.
 *
 * ## The parity, which is the whole mark
 *
 * Three circles as three subpaths of one `<path>` with `fill-rule="evenodd"`.
 * Even-odd counts crossings, so a point inside one circle is odd and painted,
 * inside two is even and cut away, inside all three is odd and painted again.
 * That is the rule the brief asks for, and it falls straight out of the fill
 * rule — there is no boolean geometry to compute and no second shape laid over
 * the first to fake the holes. Three lobes, three lens-shaped cutouts, and a
 * curved triangle in the middle.
 *
 * ## The gradient
 *
 * A base that runs violet at the top to blue at the foot, and five radial
 * blooms over it for the corners the brief names: rose at the top, violet at
 * the top left, blue down the left, teal at the right, aqua at the foot.
 *
 * Each bloom fades out over eight stops following a smoothstep rather than the
 * two a radial gradient needs. Two stops fade linearly, and a linear fade to
 * transparent has a visible edge where it lands — a faint ring, which on a flat
 * colour field is the one artefact the eye finds immediately. The extra stops
 * cost nothing and are what makes this read as one surface rather than as five
 * lights pointed at a wall.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'branding');

const SIZE = 1024;

/**
 * The corner radius of the *preview* only.
 *
 * Never baked into `parea-icon-dark.svg`. iOS applies its own mask to whatever
 * an asset catalog is given, so a rounded source is a source that gets rounded
 * twice — the corners come out thin and slightly wrong in a way nobody can
 * name. The preview exists because a flat square is not what anybody is
 * deciding about.
 */
const CORNER = 224;

/** The circle radius, and the distance from the mark's centroid to each centre. */
const R = 182;
/*
 * 182 and 132, and the pair of them is a decision rather than two numbers.
 *
 * The refinement asked for two things that cannot both happen: smaller lens
 * cutouts and a larger shared centre. For three identical circles under strict
 * parity they are locked together — eliminating the radius gives
 *
 *     lens depth = 0.072 × width + 1.856 × centre radius
 *
 * with a positive coefficient at every width, so there is no radius and no
 * spacing that shrinks one while growing the other. Sampled the areas across a
 * range of both to be sure it was not an artefact of the algebra; the lens
 * share and the centre share moved together in every row.
 *
 * So it follows the goals rather than the line item. What reads as a flower is
 * petals around a speck, and the speck was the centre: 3.7% of the white. A
 * Venn reads as three circles with a shared middle worth noticing. The centre
 * is 5.5% now, the lobes are fatter, and the whole mark is heavier — which is
 * the rest of what was asked. The lenses are slightly larger in absolute terms
 * and that is the price; going the other way makes a thinner mark around a
 * smaller speck, which is more flower rather than less.
 *
 * 57.9% of the canvas across, against 57.0% before: similar, very slightly
 * larger, never smaller.
 */
const D = 132;

/**
 * Where the three circles sit, before the mark is placed on the canvas.
 *
 * Measured from the centroid, at -90°, 30° and 150° — one at the top, two
 * below. Equal angles and one distance is what makes the three pairwise gaps
 * identical; the brief's starting coordinates were a degree or two off that,
 * which is invisible until the three lens cutouts come out different sizes.
 */
const ANGLES = [-90, 30, 150];
const OFFSETS = ANGLES.map((a) => [
  D * Math.cos((a * Math.PI) / 180),
  D * Math.sin((a * Math.PI) / 180),
]);

/**
 * Where the centroid goes, which is not the middle of the canvas.
 *
 * Two circles sit below the centroid and one above, so the painted area is
 * bottom-heavy: centring the bounding box leaves the mark looking high, and
 * centring the area centroid leaves it looking low. Both are true and they
 * disagree, which is what optical centring always is.
 *
 * So this splits them, and the split is computed rather than guessed —
 * `centroidOf` below samples the parity to find where the paint actually is.
 */
function centroidOf(offsets, radius) {
  // A grid fine enough that the answer is stable to a fraction of a pixel, and
  // coarse enough to run in a blink. Parity is evaluated exactly as the fill
  // rule does: count the circles a point is inside, paint it if that is odd.
  const STEP = 0.5;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = -radius - D; y <= radius + D; y += STEP) {
    for (let x = -radius - D; x <= radius + D; x += STEP) {
      let inside = 0;
      for (const [ox, oy] of offsets) {
        if ((x - ox) ** 2 + (y - oy) ** 2 <= radius ** 2) inside++;
      }
      if (inside % 2 === 1) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return { x: sx / n, y: sy / n, area: n * STEP * STEP };
}

const centroid = centroidOf(OFFSETS, R);
const top = Math.min(...OFFSETS.map(([, oy]) => oy)) - R;
const bottom = Math.max(...OFFSETS.map(([, oy]) => oy)) + R;
const boxMiddle = (top + bottom) / 2;

/** Halfway between the two truths. See the note above. */
const CX = SIZE / 2;
const CY = SIZE / 2 - (boxMiddle + centroid.y) / 2;

const CIRCLES = OFFSETS.map(([ox, oy]) => ({ cx: CX + ox, cy: CY + oy, r: R }));

/**
 * One circle as a subpath, drawn with two half arcs.
 *
 * `<circle>` elements cannot be subpaths of a compound path, and the fill rule
 * has to apply across all three at once — so each becomes `M` plus two arcs
 * and a close, and the three run together in one `d`.
 *
 * Both arcs sweep the same way, which matters: even-odd does not care about
 * winding, but a reader comparing this to the pale mark's own path should not
 * have to work out whether the difference is meaningful.
 */
const round = (n) => Number(n.toFixed(2)).toString();

const circlePath = ({ cx, cy, r }) =>
  `M${round(cx - r)} ${round(cy)}` +
  `a${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0` +
  `a${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0Z`;

const MARK = CIRCLES.map(circlePath).join('');

const SYMBOL = `<path d="${MARK}" fill="#FFFFFF" fill-rule="evenodd"/>`;

/**
 * One bloom: a radial gradient that fades out on a smoothstep.
 *
 * `stops` is how many; eight is where a ring stops being findable on a large
 * flat area. The curve is `t²(3 − 2t)` inverted, so the colour holds near the
 * middle and lets go gently at the edge rather than falling off a line.
 */
function bloom(id, colour, peak, cx, cy, r, stops = 8) {
  const marks = Array.from({ length: stops + 1 }, (_, i) => {
    const t = i / stops;
    const eased = 1 - t * t * (3 - 2 * t);
    return `<stop offset="${(t * 100).toFixed(2)}%" stop-color="${colour}" stop-opacity="${(
      peak * eased
    ).toFixed(4)}"/>`;
  }).join('');
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${marks}</radialGradient>`;
}

/*
 * The palette, from the brief, with the base darkened so the white has
 * somewhere to sit. A pastel field and a white mark are two light things, and
 * the mark stops being the subject.
 */
const BLOOMS = [
  /*
   * Four, anchored outside the canvas, each one wider than the icon.
   *
   * The version this refines had seven blooms inside the frame, and that is
   * what made it look segmented: a radial gradient whose centre is on the
   * canvas has its brightest point *on* the canvas, so each one reads as a
   * lamp and the places where two of them meet read as a seam.
   *
   * Put the centre beyond the edge and give it a radius half again as wide as
   * the icon, and what falls inside the frame is the gentle middle of the
   * falloff — no hot spot, no visible edge, and a transition that takes the
   * whole width to happen. Four of them, one per corner the brief names, and
   * the whole field is their sum.
   */
  ['rose', '#E95A9E', 1, 512, -190, 930],
  ['violet', '#8635D4', 1, -180, -130, 830],
  ['cobalt', '#1637CE', 1, -130, 1140, 1080],
  ['teal', '#15AEC0', 1, 1140, 1060, 1010],
  /*
   * And one more, which is not a corner.
   *
   * Rose and teal are near-opposite hues, so up the right-hand side where the
   * top colour meets the right one the sum runs toward grey. This is a violet
   * sitting in that seam so the transition goes the short way round the wheel
   * instead of straight across it. Weak and very wide: it is correcting a
   * blend, not adding a fifth colour.
   */
  ['bridge', '#7A46D6', 0.75, 1120, 60, 980],
];

const DEFS = `<defs>
<linearGradient id="base" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1024">
<stop offset="0%" stop-color="#2E1A56"/>
<stop offset="100%" stop-color="#10204F"/>
</linearGradient>
${BLOOMS.map(([id, colour, peak, cx, cy, r]) => bloom(id, colour, peak, cx, cy, r)).join('\n')}
</defs>`;

const FIELD = `<rect width="${SIZE}" height="${SIZE}" fill="url(#base)"/>
${BLOOMS.map(([id]) => `<rect width="${SIZE}" height="${SIZE}" fill="url(#${id})"/>`).join('\n')}`;

const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;

const symbolSvg = `${head}
${SYMBOL}
</svg>
`;

const iconSvg = `${head}
${DEFS}
<g id="field">
${FIELD}
</g>
<g id="mark">
${SYMBOL}
</g>
</svg>
`;

/*
 * The preview, which is the icon with the corner iOS would give it.
 *
 * A clip rather than a rounded rect behind the art, so the gradient runs to
 * the corner and is cut there — a rounded rect with the square art on top
 * would show the square's corners over it.
 */
const previewSvg = `${head}
${DEFS}
<clipPath id="squircle"><rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}"/></clipPath>
<g clip-path="url(#squircle)">
${FIELD}
${SYMBOL}
</g>
</svg>
`;

await mkdir(OUT, { recursive: true });

/*
 * `-refined`, which is what the brief that produced this version asked them to
 * be called. It is a name about when the file was made rather than about what
 * is in it, and a second pass would have to be `-refined-refined` — so it is
 * worth folding back to the plain names at some point, and there is exactly
 * one set of these so that folding is a rename and not a merge.
 */
const files = {
  'parea-symbol-refined.svg': symbolSvg,
  'parea-icon-dark-refined.svg': iconSvg,
  'parea-icon-dark-refined-preview.svg': previewSvg,
};
for (const [name, body] of Object.entries(files)) {
  await writeFile(join(OUT, name), body);
  console.log(`${name.padEnd(30)} ${body.length} bytes`);
}

for (const px of [1024, 512, 256, 128]) {
  const name = px === 1024 ? 'parea-icon-dark-refined.png' : `parea-icon-dark-refined-${px}.png`;
  await writeFile(
    join(OUT, name),
    await sharp(Buffer.from(iconSvg), { density: 384 })
      .resize(px, px)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  console.log(`${name.padEnd(30)} ${px}x${px}`);
}

console.log('');
console.log('radius', R, ' centroid offset', D, ' angles', ANGLES.join(', '));
for (const [i, c] of CIRCLES.entries()) {
  console.log(`  circle ${i + 1}  cx ${c.cx.toFixed(2)}  cy ${c.cy.toFixed(2)}  r ${c.r}`);
}
const width = D * Math.sqrt(3) + 2 * R;
console.log(
  `  spans ${width.toFixed(1)} x ${(bottom - top).toFixed(1)} ` +
    `= ${((width / SIZE) * 100).toFixed(1)}% x ${(((bottom - top) / SIZE) * 100).toFixed(1)}%`,
);
console.log(
  `  painted area centroid ${centroid.y.toFixed(2)} below the circles' centroid, ` +
    `box middle ${boxMiddle.toFixed(2)} — placed at ${CY.toFixed(2)}`,
);
