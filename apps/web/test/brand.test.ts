/**
 * The mark is drawn four times, and the four must be the same drawing.
 *
 * Once as the app icon the stores raster, once as the site's favicon, once as
 * a React component the pages render inline, and once inside the link-preview
 * image. Nobody notices these drifting. All four keep working, all four look
 * like the logo, and the discrepancy surfaces in a screenshot with the app
 * icon beside the website a year later.
 *
 * It had already happened. This file used to check two of the four, and the
 * one nobody was checking — the preview image — had invented its own palette:
 * three flat circles at 72% alpha in colours appearing nowhere else, letting
 * the browser composite the overlaps that every other copy paints explicitly.
 * The comment at the top of that file said the geometry was "the same six
 * numbers", and the geometry was; everything else was not. So the numbers are
 * compared rather than trusted, and now all four are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MARK_CENTRES, MARK_FILLS, MARK_R, markSvg } from '../app/components/Mark';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const icon = read('../../mobile/assets/icon.svg');
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
  ['the app icon', icon],
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
    // No alpha anywhere, for the reason the other three give: multiply turns
    // the pink-over-mint lens muddy, and that lens is where the warmth is.
    expect(native).not.toMatch(/rgba\(|opacity=|fillOpacity|mixBlendMode/);
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
