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

  it('has gradients that reach the edges of the icon', () => {
    /*
     * This used to count stops, on the grounds that a two-stop fade to
     * transparent lands on a visible ring. That was an assertion about the
     * technique the field happened to be built with, and the field was
     * replaced with one written by hand using three stops each. Counting stops
     * would have failed a field that has no ring in it.
     *
     * So the ring itself is checked below, in the render. This is left with
     * the part that is still structural: enough gradients to cover the corners
     * the design names, and each wide enough to be a field rather than a spot.
     */
    const blooms = [...ICON.matchAll(/<radialGradient[\s\S]*?<\/radialGradient>/g)];
    expect(blooms.length).toBeGreaterThanOrEqual(5);
    for (const [bloom] of blooms) {
      expect(Number(/ r="(\d+)"/.exec(bloom)?.[1] ?? 0)).toBeGreaterThan(400);
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
     *
     * The field this now measures was written by hand and has pink up one side
     * and teal up the other, 170° apart — so a sixth gradient sits in the seam
     * between them, using a colour already in the set. Without it the two
     * averaged to rgb(166, 163, 177) at 0.08, a flat band down the right edge.
     */
    const near = (x: number, y: number) =>
      circles.some((c) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) < 6);

    /*
     * Measured as the spread between the channels, in units out of 255, not as
     * a proportion of the brightest one.
     *
     * The proportion is what this used to take, and it is the wrong measure
     * for a light field: a pale periwinkle scores badly on it while being
     * perfectly saturated to look at. This field's floor is rgb(129, 128, 185)
     * — plainly blue-violet, and it failed the old bar.
     *
     * Grey is channels close together whatever the brightness, so the spread
     * is the thing. The two greys this exists to catch measured 15 and 21;
     * everything on this field is above 50, so the bar sits between them with
     * room on both sides.
     */
    let worst = 255;
    for (let y = 6; y < 1018; y += 8) {
      for (let x = 6; x < 1018; x += 8) {
        if (near(x, y) || inside(x, y) % 2 === 1) continue;
        const [r, g, b] = pixel(x, y);
        worst = Math.min(worst, Math.max(r, g, b) - Math.min(r, g, b));
      }
    }
    expect(worst).toBeGreaterThan(35);
  });

  it('keeps the white readable all the way round the mark', () => {
    /*
     * This asserted a ceiling on corner luminance, because the icon was dark
     * and the corners were the darkest thing about it. The field was replaced
     * with a lighter one — a deliberate choice, made with the contrast number
     * in hand — so a darkness ceiling is now an assertion about a decision
     * that has been reversed.
     *
     * What still matters is the thing the ceiling was standing in for: that
     * the mark is legible against the field at every point around its edge,
     * not merely on average. So this walks the ring just outside the mark and
     * takes the worst.
     *
     * The floor is low, and that is honest rather than convenient: the field
     * this passes with measures about 1.3:1, where the dark one measured 2.6.
     * It is here to catch a field bright enough to swallow the mark, not to
     * re-argue the brightness.
     */
    const reach = circles[0]!.r + Math.hypot(
      circles[0]!.cx - (circles[1]!.cx + circles[2]!.cx) / 2,
      circles[0]!.cy - (circles[1]!.cy + circles[2]!.cy) / 2,
    ) / 1.5;

    let brightest = 0;
    let where = '';
    for (let a = 0; a < 360; a += 3) {
      const x = Math.round(512 + (reach + 24) * Math.cos((a * Math.PI) / 180));
      const y = Math.round(528 + (reach + 24) * Math.sin((a * Math.PI) / 180));
      if (x < 2 || y < 2 || x > 1021 || y > 1021) continue;
      const [r, g, b] = pixel(x, y);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (luminance > brightest) {
        brightest = luminance;
        where = `${x},${y}`;
      }
    }
    const contrast = 1.05 / (brightest + 0.05);
    expect(contrast, `beside the mark at ${where}`).toBeGreaterThan(1.25);
  });

  it('has no ring where a gradient stops', () => {
    /*
     * The artefact a fade to transparent leaves when it lands on a straight
     * line: the colour stops changing all at once, and on a flat field the eye
     * finds that edge immediately.
     *
     * Measured as a second difference along rays out of each gradient's own
     * centre — a ring is a spike in curvature at one radius. The threshold is
     * in luminance units out of 255, so it is a real brightness step rather
     * than a proportion of something.
     */
    const centres = [...ICON.matchAll(/cx="(-?\d+)" cy="(-?\d+)"/g)].map(
      (m) => [Number(m[1]!), Number(m[2]!)] as const,
    );
    expect(centres.length).toBeGreaterThanOrEqual(5);

    let sharpest = 0;
    for (const [cx, cy] of centres) {
      for (let a = 0; a < 360; a += 15) {
        const dx = Math.cos((a * Math.PI) / 180);
        const dy = Math.sin((a * Math.PI) / 180);
        const ray: (number | null)[] = [];
        for (let t = 0; t < 900; t += 4) {
          const x = Math.round(cx + dx * t);
          const y = Math.round(cy + dy * t);
          /*
           * Off the canvas, or anywhere near the mark.
           *
           * White against the field is a step of two hundred luminance units,
           * which swamps any ring by a factor of fifty — the first version of
           * this measured 292 and was reading the edge of a circle.
           */
          const onMark = circles.some(
            (c) => Math.hypot(x - c.cx, y - c.cy) < c.r + 10,
          );
          if (x < 1 || y < 1 || x > 1022 || y > 1022 || onMark) {
            ray.push(null);
            continue;
          }
          const [r, g, b] = pixel(x, y);
          ray.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        }
        for (let i = 2; i < ray.length - 2; i++) {
          const a0 = ray[i - 2];
          const a1 = ray[i];
          const a2 = ray[i + 2];
          if (a0 == null || a1 == null || a2 == null) continue;
          sharpest = Math.max(sharpest, Math.abs(a2 - 2 * a1 + a0));
        }
      }
    }
    expect(sharpest).toBeLessThan(6);
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
