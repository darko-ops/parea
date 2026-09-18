/**
 * The dark app icon, checked as geometry and as pixels.
 *
 * `build-icon.mjs` derives the whole thing from three numbers, so most of what
 * could go wrong is arithmetic — and arithmetic is worth asserting, because the
 * failure mode is an icon that looks *almost* right and nobody can say why.
 *
 * The last two tests read the rendered PNG. The parity is the mark: inside one
 * circle is white, inside two is cut away, inside three is white again. That is
 * a claim about what a renderer does with `fill-rule="evenodd"`, and no amount
 * of reading the `d` attribute checks it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const SYMBOL = read('../../../assets/branding/parea-symbol-refined.svg');
const ICON = read('../../../assets/branding/parea-icon-dark-refined.svg');
const PREVIEW = read('../../../assets/branding/parea-icon-dark-refined-preview.svg');
const SCRIPT = read('../../../scripts/build-icon.mjs');

/** The three circles, read back out of the symbol's own path. */
const circles = [...SYMBOL.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+) [\d.]+ 0 1 0 ([\d.]+) 0/g)].map(
  (m) => ({ cx: Number(m[1]) + Number(m[3]), cy: Number(m[2]), r: Number(m[3]) }),
);

describe('the geometry', () => {
  it('is three identical circles', () => {
    expect(circles).toHaveLength(3);
    expect(new Set(circles.map((c) => c.r)).size).toBe(1);
  });

  it('places them at equal distances from each other', () => {
    /*
     * The brief's starting coordinates were a degree or two off equilateral,
     * which is invisible until the three lens cutouts come out different sizes
     * — and then it is the kind of wrongness somebody feels without locating.
     */
    const gaps = [
      Math.hypot(circles[0]!.cx - circles[1]!.cx, circles[0]!.cy - circles[1]!.cy),
      Math.hypot(circles[1]!.cx - circles[2]!.cx, circles[1]!.cy - circles[2]!.cy),
      Math.hypot(circles[2]!.cx - circles[0]!.cx, circles[2]!.cy - circles[0]!.cy),
    ];
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 1);
  });

  it('is symmetrical about the vertical', () => {
    // One circle above, two below, and the two below the same distance either
    // side of the middle. Anything else is a mark that leans.
    const [top, right, left] = [...circles].sort((a, b) => a.cy - b.cy);
    expect(top!.cx).toBeCloseTo(512, 1);
    expect(right!.cy).toBeCloseTo(left!.cy, 1);
    expect((right!.cx + left!.cx) / 2).toBeCloseTo(512, 1);
  });

  it('overlaps enough for a triple, and not so much that there are no lobes', () => {
    const gap = Math.hypot(
      circles[0]!.cx - circles[1]!.cx,
      circles[0]!.cy - circles[1]!.cy,
    );
    const r = circles[0]!.r;
    // Pairs meet at all.
    expect(gap).toBeLessThan(2 * r);
    // And all three meet: the centres' circumradius has to be inside one.
    expect(gap / Math.sqrt(3)).toBeLessThan(r);
  });

  it('is the size a home screen needs, and never smaller', () => {
    /*
     * The first brief gave ranges — 54–58% across and 50–54% down. The
     * refinement replaced them with a direction: similar, or at most slightly
     * larger, and never smaller. So the floor is the old geometry and the
     * ceiling is a hand's width above it, which is what "slightly" has to mean
     * if it is going to be checkable at all.
     */
    const xs = circles.flatMap((c) => [c.cx - c.r, c.cx + c.r]);
    const ys = circles.flatMap((c) => [c.cy - c.r, c.cy + c.r]);
    const width = (Math.max(...xs) - Math.min(...xs)) / 1024;
    const height = (Math.max(...ys) - Math.min(...ys)) / 1024;
    expect(width).toBeGreaterThanOrEqual(0.57);
    expect(width).toBeLessThanOrEqual(0.6);
    expect(height).toBeGreaterThanOrEqual(0.54);
    expect(height).toBeLessThanOrEqual(0.57);
  });

  it('gives the shared middle enough of the mark to be a feature', () => {
    /*
     * The thing the refinement was actually about. A flower is petals around a
     * speck; a Venn is three circles with a middle worth noticing, and the
     * middle was 3.7% of the white.
     *
     * Measured rather than inferred, by the same parity the fill rule uses.
     * The floor is where it stops disappearing at 60 points, which is where
     * the icon spends most of its life.
     */
    const r = circles[0]!.r;
    const inside = (x: number, y: number) =>
      circles.filter((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= r ** 2).length;

    let white = 0;
    let centre = 0;
    for (let y = 0; y < 1024; y += 2) {
      for (let x = 0; x < 1024; x += 2) {
        const n = inside(x, y);
        if (n === 1 || n === 3) white++;
        if (n === 3) centre++;
      }
    }
    expect(centre / white).toBeGreaterThan(0.045);
  });

  it('sits between the two ways of being centred', () => {
    /*
     * Two circles below the centroid and one above, so the bounding box and
     * the painted area disagree about the middle. Both are true; the script
     * splits them, which puts the box centre a little above 512 and the area
     * centre a little below.
     */
    const ys = circles.flatMap((c) => [c.cy - c.r, c.cy + c.r]);
    const box = (Math.max(...ys) + Math.min(...ys)) / 2;
    const area = circles.reduce((n, c) => n + c.cy, 0) / 3;
    expect(box).toBeLessThan(512);
    expect(area).toBeGreaterThan(512);
  });
});

describe('the fill rule', () => {
  it('is one compound path, not three shapes', () => {
    // Three `<circle>` elements cannot share a fill rule, and three separate
    // paths would simply stack — the holes only exist because the crossings
    // are counted across all three at once.
    expect(SYMBOL.match(/<path/g) ?? []).toHaveLength(1);
    expect(SYMBOL).toMatch(/fill-rule="evenodd"/);
    expect(SYMBOL).not.toMatch(/<circle/);
    expect(SYMBOL.match(/M-?[\d.]+ -?[\d.]+a/g) ?? []).toHaveLength(3);
  });

  it('paints solid white, never a translucent one', () => {
    // A white at 90% over the gradient is a way of faking a cutout that
    // survives a screenshot and fails a colour picker.
    expect(SYMBOL).toMatch(/fill="#FFFFFF"/);
    expect(SYMBOL).not.toMatch(/fill-opacity/);
    expect(SYMBOL).not.toMatch(/opacity="0?\.\d/);
  });
});

describe('the files', () => {
  it('keeps the symbol on nothing at all', () => {
    expect(SYMBOL).not.toMatch(/<rect/);
    expect(SYMBOL).not.toMatch(/linearGradient|radialGradient/);
  });

  it('leaves the corner off the icon and puts it on the preview', () => {
    /*
     * iOS masks whatever an asset catalog is given, so a rounded source is
     * rounded twice — the corners come out thin in a way nobody can name. The
     * preview exists because a flat square is not what anybody is deciding
     * about.
     */
    expect(ICON).not.toMatch(/rx="/);
    expect(PREVIEW).toMatch(/rx="224"/);
    expect(PREVIEW).toMatch(/clip-path="url\(#squircle\)"/);
  });

  it('has none of the effects the brief rules out', () => {
    for (const svg of [SYMBOL, ICON, PREVIEW]) {
      expect(svg).not.toMatch(/<filter|feGaussianBlur|feTurbulence|feDropShadow/);
      expect(svg).not.toMatch(/blur|noise|grain/i);
    }
  });

  it('fades every bloom over more than two stops', () => {
    // Two stops fade linearly and a linear fade to transparent lands on a
    // visible ring, which is the one artefact the eye finds on a flat field.
    const blooms = [...ICON.matchAll(/<radialGradient[\s\S]*?<\/radialGradient>/g)];
    expect(blooms.length).toBeGreaterThan(3);
    for (const [bloom] of blooms) {
      expect((bloom.match(/<stop/g) ?? []).length).toBeGreaterThanOrEqual(9);
    }
  });
});

describe('what a renderer actually draws', () => {
  let pixel: (x: number, y: number) => [number, number, number];

  beforeAll(async () => {
    const { data, info } = await sharp(Buffer.from(ICON), { density: 384 })
      .resize(1024, 1024)
      .raw()
      .toBuffer({ resolveWithObject: true });
    pixel = (x, y) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
  });

  /** How many of the three circles a point falls inside. */
  const inside = (x: number, y: number) =>
    circles.filter((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 < c.r ** 2).length;

  const white = ([r, g, b]: [number, number, number]) => r > 248 && g > 248 && b > 248;

  it('paints one, cuts two, and paints three again', () => {
    /*
     * The whole mark in one assertion, swept rather than sampled: every point
     * on a grid is classified by the geometry and checked against the pixel.
     * Points near an edge are skipped — antialiasing there is neither white
     * nor field and asserting on it would be asserting about the renderer.
     */
    const near = (x: number, y: number) =>
      circles.some((c) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < 3);

    let ones = 0;
    let twos = 0;
    let threes = 0;
    for (let y = 2; y < 1024; y += 3) {
      for (let x = 2; x < 1024; x += 3) {
        if (near(x, y)) continue;
        const n = inside(x, y);
        if (n === 0) continue;
        const lit = white(pixel(x, y));
        if (n === 1) {
          expect(lit, `inside one circle at ${x},${y}`).toBe(true);
          ones++;
        } else if (n === 2) {
          expect(lit, `inside two circles at ${x},${y}`).toBe(false);
          twos++;
        } else {
          expect(lit, `inside all three at ${x},${y}`).toBe(true);
          threes++;
        }
      }
    }
    // And all three regions exist to have been checked.
    expect(ones).toBeGreaterThan(1000);
    expect(twos).toBeGreaterThan(200);
    expect(threes).toBeGreaterThan(100);
  });

  it('keeps a field nobody would call muddy', () => {
    /*
     * The one thing the brief asks for that a hex list cannot guarantee.
     * Rose and teal are near-opposite hues, so anywhere they meet directly the
     * blend runs toward grey — which is why a violet sits between them up the
     * right-hand side rather than letting them average.
     *
     * Measured over the visible field only: the white mark is skipped, and so
     * is everything within a few pixels of its edge.
     */
    const near = (x: number, y: number) =>
      circles.some((c) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < 6);

    let worst = 1;
    for (let y = 6; y < 1018; y += 8) {
      for (let x = 6; x < 1018; x += 8) {
        if (near(x, y) || inside(x, y) % 2 === 1) continue;
        const [r, g, b] = pixel(x, y);
        const max = Math.max(r, g, b);
        worst = Math.min(worst, max === 0 ? 0 : (max - Math.min(r, g, b)) / max);
      }
    }
    expect(worst).toBeGreaterThan(0.4);
  });

  it('is dark enough for the white to carry', () => {
    // The pale icon this sits beside puts a white mark on a near-white field,
    // which works on a page and not on a home screen. Every corner here has to
    // be a colour the white stands off.
    for (const [x, y] of [
      [40, 40],
      [984, 40],
      [40, 984],
      [984, 984],
      [512, 24],
    ] as const) {
      const [r, g, b] = pixel(x, y);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance, `corner ${x},${y}`).toBeLessThan(0.66);
    }
  });
});

describe('the script', () => {
  it('derives the mark once and hands it to every file', () => {
    // Two icons, one geometry. A second copy of the path is how the dark icon
    // and the pale one come to disagree about the shape.
    expect(SCRIPT).toMatch(/const MARK = CIRCLES\.map\(circlePath\)\.join\(''\)/);
    expect(SCRIPT.match(/const SYMBOL = /g) ?? []).toHaveLength(1);
  });
});
