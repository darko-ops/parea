/**
 * The mark is drawn four times, and the four must be the same drawing.
 *
 * Once as the site's favicon, once as a React component the pages render
 * inline, once in `react-native-svg` for the phone, and once inside the
 * link-preview image. Nobody notices these drifting. All four keep working,
 * all four look like the logo, and the discrepancy surfaces in a screenshot
 * with one beside another a year later.
 *
 * It had already happened. This file used to check two of them, and the one
 * nobody was checking — the preview image — had invented its own palette:
 * three flat circles at 72% alpha in colours appearing nowhere else, letting
 * the browser composite the overlaps that every other copy paints explicitly.
 * The comment at the top of that file said the geometry was "the same six
 * numbers", and the geometry was; everything else was not. So the numbers are
 * compared rather than trusted.
 *
 * ## The app icon was a fifth, and is now its own drawing
 *
 * It is the same three circles on the same three centres, and everything else
 * about it is different: the circles are white holes punched out of a coloured
 * field rather than coloured shapes on white, and the radius is 163 rather
 * than 200 because a hole wants more field around it than a shape wants page.
 *
 * That is a deliberate split and not drift, which is why it is asserted below
 * rather than merely excused. What it costs is exactly what this file exists
 * to prevent — the icon beside the website no longer match — and the other
 * four have not been brought across because the mark they draw is used at
 * 16 to 48 points on white pages, where three white circles are nothing at
 * all. Carrying the new one over means making it a badge: the field, its
 * corners and all, wherever the bare glyph is today. That is a change to
 * every screen the mark appears on and wants deciding on its own.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MARK_CENTRES, MARK_FILLS, MARK_R, markSvg } from '../app/components/Mark';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/* The brand master, which the app's store assets are rendered from. */
const icon = read('../../../assets/branding/parea-icon.svg');
const favicon = read('../app/icon.svg');
const web = read('../app/components/Mark.tsx');
/** The fourth copy: the same mark in `react-native-svg`, for the phone. */
const native = read('../../mobile/src/Mark.tsx');
const og = read('../app/api/og/route.tsx');
/** What the preview image actually hands to the rasteriser. */
const preview = markSvg(400);

const FILLS = Object.values(MARK_FILLS);

/** Every `<circle>` in an SVG source, as numbers. */
function circlesIn(svg: string) {
  return [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)].map((m) => ({
    cx: Number(m[1]),
    cy: Number(m[2]),
    r: Number(m[3]),
  }));
}

describe.each([
  ['the favicon', favicon],
  ['the preview image', preview],
])('%s', (_name, svg) => {
  it('uses the same three centres and radius as the component', () => {
    const circles = circlesIn(svg);
    expect(circles.length, 'the extractor found nothing, which is not a pass')
      .toBeGreaterThan(2);

    for (const circle of circles) expect(circle.r).toBe(MARK_R);

    // Sorted, because declaration order is not part of the design: the icons
    // define their clip paths pink-blue-mint and the preview defines only the
    // two it needs, so the first circle each file mentions differs. Which
    // three points they are does not.
    const key = ({ cx, cy }: { cx: number; cy: number }) => `${cx},${cy}`;
    const distinct = [...new Set(circles.map(key))].sort();
    expect(distinct).toEqual([...MARK_CENTRES.map(key)].sort());
  });

  it('carries all seven fills', () => {
    // Three circles, three lenses, and the region where all three meet: seven
    // regions, seven fills, no exceptions. The seventh is the one that went
    // missing from this list once before, which is why the two drawings could
    // have disagreed about the centre without a failure.
    for (const fill of FILLS) {
      expect(svg, `${fill} missing`).toContain(fill);
    }
  });

  it('paints the overlaps rather than compositing them', () => {
    /*
     * No alpha anywhere. Transparency would decide those four regions for us —
     * and multiply in particular turns the pink-over-mint lens into a muddy
     * neutral, the one place the design wants warmth. It also softens every
     * edge, which is what made the mark look fragile at small sizes.
     */
    expect(svg).not.toMatch(/rgba\(|opacity=|fill-opacity|mix-blend-mode/);
    expect(svg).toMatch(/clip-path=/);
  });
});

/**
 * The app icon, which is the same geometry saying the opposite thing.
 *
 * Checked rather than skipped. An untested fifth copy is how the preview image
 * came to have its own palette, and "it is allowed to differ" is not the same
 * claim as "it differs in these ways" — the second is the one worth writing
 * down, because it is the one that fails when somebody changes the icon by
 * hand instead of re-rendering it.
 */
describe('the app icon', () => {
  it('keeps the three centres, on a radius of its own', () => {
    /*
     * The centres are the design — three points 132 from a middle at 120°
     * apart, first one straight up — and they have not moved. The radius has:
     * 200 was chosen when the mark was a small coloured shape that needed
     * every pixel of colour it could get at 16px, and here the colour is the
     * field and the circles are the absence of it, so tighter circles mean
     * less field showing and a mark that reads as one white blob with notches.
     */
    const path = icon.match(/id="mark"[\s\S]*?d="([\s\S]*?)"/)?.[1];
    expect(path, 'no path with id="mark" in the brand master').toBeDefined();

    // `M cx-r cy a r r 0 1 0 2r 0 …`, one subpath per circle.
    const subpaths = [...(path ?? '').matchAll(/M ([\d.]+) ([\d.]+) a ([\d.]+) [\d.]+/g)].map((m) => ({
      cx: Number(m[1]) + Number(m[3]),
      cy: Number(m[2]),
      r: Number(m[3]),
    }));
    expect(subpaths.length, 'the extractor found nothing, which is not a pass').toBe(3);

    /*
     * The three sit 132 from a point, 120° apart, first one straight up — the
     * design, unchanged. Where that point *is* has moved: the mark is placed
     * between the two defensible centrings rather than on the mass, so the
     * centres are 16.5 lower than the in-app mark's. Checked as a shape rather
     * than against `MARK_CENTRES`, which describes the other drawing.
     */
    const cx = subpaths.map((c) => c.cx).sort((a, b) => a - b);
    const cy = subpaths.map((c) => c.cy);
    expect(Math.round(((cx[0]! + cx[2]!) / 2) * 100) / 100).toBe(512);
    // Two low and level, one high and centred: an equilateral triangle, point up.
    expect(new Set(cy).size).toBe(2);
    const [high, low] = [Math.min(...cy), Math.max(...cy)];
    expect(low - high).toBeCloseTo(198, 0); // 1.5 × 132
    expect(cx[2]! - cx[0]!).toBeCloseTo(228.63, 1); // 2 × 132 × sin 60
    for (const circle of subpaths) expect(circle.r).toBe(180);
  });

  it('punches the circles out rather than painting seven regions', () => {
    /*
     * One path, three subpaths, `evenodd`. A region covered an odd number of
     * times is white and an even number is not painted at all, so the three
     * lenses are holes and the field shows through them — which is why no two
     * of them are the same colour and none of them had to be chosen.
     *
     * The seven explicit fills existed because the mark used to sit on white,
     * where a transparent overlap would have been white too and the lenses
     * would have vanished. There is nothing to invent on a field.
     */
    expect(icon).toMatch(/fill-rule="evenodd"/);
    expect(icon).not.toMatch(/clip-path=/);
    for (const fill of FILLS) {
      expect(icon, `${fill} should no longer be in the icon`).not.toContain(fill);
    }
  });

  it('is full bleed, with no corner of its own', () => {
    /*
     * iOS rounds the corners itself and App Store Connect rejects an alpha
     * channel. The artwork this came from was drawn with its corners already
     * rounded against black; rounding here would round them twice and put
     * black inside the mask.
     */
    /*
     * A base the field is painted over, and it is not white: the brief asks
     * for airy, and white showing through where nothing reaches full strength
     * reads as a vignette rather than as air.
     */
    expect(icon).toMatch(/<rect width="1024" height="1024" fill="#[0-9A-F]{6}"\/>/);
    expect(icon).not.toMatch(/\brx="/);
    // The corner lives in the preview and nowhere else.
    expect(read('../../../assets/branding/parea-icon-preview.svg')).toMatch(/rx="224"/);
  });

  it('names the two halves the Android layers are cut from', () => {
    // `render-icons.mjs` takes them apart by id. It used to pattern-match a
    // white fill and broke the first time this file changed.
    expect(icon).toMatch(/<g id="field">/);
    expect(icon).toMatch(/id="mark"/);
  });
});

/**
 * The native mark, which is JSX rather than an SVG document.
 *
 * Its own block because `circlesIn` cannot read it: the geometry is in the same
 * `MARK_CENTRES` literal the web component uses — `{ cx: 512, cy: 400 }` — not
 * in `<circle cx="512">`. The thing being checked is the same, and it is the
 * thing that matters: four drawings of one logo agreeing about where the
 * circles are and what colour the overlaps come out.
 */
describe('the native mark', () => {
  it('uses the same three centres and radius as the component', () => {
    const centres = [...native.matchAll(/\{ cx: (\d+), cy: (\d+) \}/g)].map((m) => ({
      cx: Number(m[1]),
      cy: Number(m[2]),
    }));
    expect(centres.length, 'the extractor found nothing, which is not a pass')
      .toBeGreaterThan(2);

    const key = ({ cx, cy }: { cx: number; cy: number }) => `${cx},${cy}`;
    expect([...new Set(centres.map(key))].sort()).toEqual([...MARK_CENTRES.map(key)].sort());
    expect(native).toMatch(new RegExp(`MARK_R = ${MARK_R}\\b`));
  });

  it('carries all seven fills', () => {
    for (const fill of FILLS) {
      expect(native, `${fill} missing`).toContain(fill);
    }
  });

  it('paints the overlaps rather than compositing them', () => {
    /*
     * No alpha on the *colours*, for the reason the other three give: multiply
     * turns the pink-over-mint lens muddy, and that lens is where the warmth
     * is. Every one of the seven is an explicit value.
     *
     * This asserted no alpha in the file at all, which was the same rule until
     * the spinner needed the mark in one colour. There, alpha is the only axis
     * left — the three circles sit on an equilateral arrangement, so a flat
     * silhouette is unchanged by a third of a turn and does not read as
     * turning. It cannot muddy anything, because there is one colour and
     * nothing for it to blend with.
     *
     * So the rule is stated where it applies: the branded mark composites
     * nothing, and the ramp exists only on the path that has no brand colours
     * in it.
     */
    expect(native).not.toMatch(/rgba\(|mixBlendMode/);
    // Drawn at full strength whenever it is drawn in its own colours.
    expect(native).toMatch(/: \{\s*pink: 1,\s*blue: 1,\s*mint: 1,/);
    expect(native).toMatch(/pinkOnBlue: 1,\s*pinkOnMint: 1,\s*blueOnMint: 1,\s*centre: 1,/);
    // And the ramp is reachable only through `tint`.
    expect(native).toMatch(/const mono = tint !== undefined;/);
    expect(native).toMatch(/clipPath=/);
  });

  it('gives each instance its own clip ids', () => {
    /*
     * `react-native-svg` does not scope `clipPath` ids per `Svg` on every
     * platform, so two marks mounted at once with hard-coded ids can clip
     * against each other's circles — which looks like one of them losing its
     * overlaps and nothing else.
     */
    expect(native).toMatch(/useId\(\)/);
    expect(native).toMatch(/\$\{id\}-blue/);
  });
});

describe('the component', () => {
  it('carries all seven fills', () => {
    for (const fill of FILLS) expect(web, `${fill} missing`).toContain(fill);
  });

  it('keeps the ratio the icon says the design depends on', () => {
    /*
     * icon.svg: "three circles of radius 200, centres 132 from a point". At
     * 0.66 the three meet in a curved triangle big enough to be a shape in its
     * own right, which is the subject. Spread them and it collapses to a
     * sliver and the mark stops meaning anything.
     *
     * It was 0.73, and tightening it is half of the answer to the mark being
     * too faint at 16 and 24px — the centre is the part carrying the meaning
     * and it needs to be a shape rather than a seam. The other half is the
     * radius and the chroma.
     */
    const [top] = MARK_CENTRES;
    const centre = { x: 512, y: 532 };
    const offset = Math.hypot(top.cx - centre.x, top.cy - centre.y);
    expect(offset / MARK_R).toBeCloseTo(0.66, 2);
  });

  it('is big enough in its own box to survive being drawn small', () => {
    // The complaint that started this: in the sidebar it almost disappeared.
    // The artwork has to occupy most of the canvas, or every size below 24px
    // is mostly margin.
    const span = 2 * (MARK_R + Math.hypot(MARK_CENTRES[0].cx - 512, MARK_CENTRES[0].cy - 532));
    expect(span / 1024).toBeGreaterThan(0.6);
    // And not so big that the app icon loses its margin, which iOS needs
    // because it rounds the corners itself.
    expect(span / 1024).toBeLessThan(0.72);
  });

  it('does not paint a background rect on the web', () => {
    // The icons need one — iOS rejects an alpha channel, and a favicon sits on
    // whatever chrome the browser draws — and the inline component must not,
    // or the mark sits in a white box on any other surface.
    expect(icon).toContain('<rect width="1024" height="1024"');
    expect(favicon).toContain('<rect width="1024" height="1024"');
    expect(web).not.toContain('<rect');
    expect(preview).not.toContain('<rect');
  });
});

describe('the wordmark', () => {
  const css = read('../app/globals.css');
  const rule = css.match(/\.wordmark \{[^}]*\}/)?.[0] ?? '';

  it('is set lowercase, and tracked in rather than out', () => {
    /*
     * `PAREA` at +.04em was clean and institutional — closer to an
     * architecture practice than to an app for the photographs from somebody's
     * evening — and holding the letters apart is the opposite of what the mark
     * beside it means.
     */
    expect(rule, 'the extractor found no .wordmark rule').not.toBe('');
    expect(rule).toMatch(/text-transform:\s*lowercase/);
    expect(rule).toMatch(/letter-spacing:\s*-\.02em/);
  });

  it('keeps the proper noun in the markup', () => {
    // Drawn lowercase, written as a name. A screen reader reads the DOM, and
    // the accessible name of this product is Parea.
    for (const path of ['../app/components/Rail.tsx', '../app/components/LoginScreen.tsx']) {
      expect(read(path)).toMatch(/className="wordmark[^"]*">Parea</);
    }
  });

  it('is drawn the same way in the link preview', () => {
    // The one place the wordmark is set outside this stylesheet. It said
    // `PAREA` with the letters spaced twelve pixels apart, which is where the
    // old treatment survived longest.
    expect(og).toContain('>parea<');
    expect(og).toMatch(/letterSpacing:\s*-/);
  });
});
