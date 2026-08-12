/**
 * The mark is drawn twice — once as an SVG the stores raster, once as a React
 * component the site renders inline — and the two must be the same drawing.
 *
 * Nobody notices this drifting. Both keep working, both look like the logo,
 * and the discrepancy surfaces in a screenshot with the app icon beside the
 * website a year later. So the numbers are compared rather than trusted.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MARK_CENTRES, MARK_R } from '../app/components/Mark';

const icon = readFileSync(
  fileURLToPath(new URL('../../mobile/assets/icon.svg', import.meta.url)),
  'utf8',
);

const web = readFileSync(
  fileURLToPath(new URL('../app/components/Mark.tsx', import.meta.url)),
  'utf8',
);

describe('the mark, drawn twice', () => {
  it('uses the same three centres and radius as the app icon', () => {
    const circles = [...icon.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)].map(
      (m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }),
    );
    expect(circles.length, 'the extractor found nothing, which is not a pass')
      .toBeGreaterThan(2);

    for (const circle of circles) expect(circle.r).toBe(MARK_R);

    const distinct = [
      ...new Map(circles.map((c) => [`${c.cx},${c.cy}`, c])).values(),
    ].map(({ cx, cy }) => ({ cx, cy }));
    expect(distinct).toEqual(MARK_CENTRES.map(({ cx, cy }) => ({ cx, cy })));
  });

  it('keeps the ratio the icon says the design depends on', () => {
    // icon.svg: "three circles of radius 184, centres 134 from a point". At
    // 0.73 the three meet in a curved triangle big enough to be a shape in its
    // own right, which is the subject. Spread them and it collapses to a
    // sliver and the mark stops meaning anything.
    const [top] = MARK_CENTRES;
    const centre = { x: 512, y: 532 };
    const offset = Math.hypot(top.cx - centre.x, top.cy - centre.y);
    expect(offset / MARK_R).toBeCloseTo(0.73, 2);
  });

  it('carries the same seven fills', () => {
    // The seventh is the centre, and it was the one missing from this list —
    // which is why the two drawings could have disagreed about it without a
    // failure. Three circles, three lenses, and the region where all three
    // meet: seven regions, seven fills, no exceptions.
    for (const fill of [
      '#ffb3b8', '#9db2f0', '#a5dcc6',
      '#c79ad9', '#f3b584', '#6fb6c4',
      '#b084c5',
    ]) {
      expect(icon, `${fill} missing from the app icon`).toContain(fill);
      expect(web, `${fill} missing from the web mark`).toContain(fill);
    }
  });

  it('does not paint a background rect on the web', () => {
    // The icon needs one — iOS rejects an alpha channel — and the page must
    // not have one, or the mark sits in a white box on any other surface.
    expect(icon).toContain('<rect width="1024" height="1024"');
    expect(web).not.toContain('<rect');
  });
});
