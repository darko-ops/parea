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
const R = 175;
/*
 * 135, which is where two things the brief wants at once stop arguing.
 *
 * Further apart makes the three lens cutouts bigger and keeps them legible
 * further down — at 60 points they are the first thing to close up — but it
 * shrinks the white centre, and past about 150 the centre is gone at that size
 * and the mark reads as three separate discs. Closer together does the
 * reverse: a fat centre and lenses that vanish.
 *
 * Compared at 120 and 60 points before choosing. 135 also keeps both of the
 * brief's proportions in range, which 140 does not: it spans 57.0% of the
 * canvas across and 53.9% down, against 54–58 and 50–54.
 */
const D = 135;

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
  // Rose across the top, and the strongest of them: it is the first colour the
  // eye meets and the one the brief leads with. Tight enough to stay pink
  // rather than spreading into the violet and going mauve.
  ['rose', '#E8609B', 1, 512, 0, 540],
  ['rose-wide', '#D9508E', 0.6, 512, 150, 620],
  // Violet into the top-left corner, bridging the rose to the blue below it.
  ['violet', '#8A35CC', 1, 60, 130, 560],
  // Blue down the left and into the foot. Two of them, one deeper, because a
  // single blue over that much canvas goes flat through the middle.
  ['blue', '#1636C4', 1, 60, 780, 620],
  ['indigo', '#21308F', 0.85, 400, 1024, 560],
  // Teal up the right and aqua under it. The lightest corner, and what keeps
  // the whole thing from reading as one dark diagonal.
  ['teal', '#1EA9B4', 1, 1024, 540, 700],
  ['aqua', '#3FCFAE', 0.85, 880, 980, 500],
  /*
   * And one across the top right, where rose meets teal.
   *
   * Without it that corner is the base showing through with nothing over it —
   * a dead navy wedge between two of the brief's four colours, and the only
   * part of the field that does not belong to anything.
   */
  ['bridge', '#8C3FD0', 1, 970, 250, 470],
];

const DEFS = `<defs>
<linearGradient id="base" gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="874" y2="1024">
<stop offset="0%" stop-color="#4A1E63"/>
<stop offset="48%" stop-color="#1E2472"/>
<stop offset="100%" stop-color="#103A63"/>
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

const files = {
  'parea-symbol.svg': symbolSvg,
  'parea-icon-dark.svg': iconSvg,
  'parea-icon-dark-preview.svg': previewSvg,
};
for (const [name, body] of Object.entries(files)) {
  await writeFile(join(OUT, name), body);
  console.log(`${name.padEnd(30)} ${body.length} bytes`);
}

for (const px of [1024, 512, 256, 128]) {
  const name = `parea-icon-dark-${px}.png`;
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
