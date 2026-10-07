/**
 * The mark, in motion — the geometry both loading animations draw from.
 *
 * Two of them, from the design package's README: the launch, where the three
 * circles arrive one at a time and settle, and the slow-page spinner, where
 * the mark turns while its circles breathe apart and back. Both are the same
 * three circles on `MARK_CENTRES`, moved about their common centre and grown
 * or shrunk, so the arithmetic lives once, here.
 *
 * Drawn as one even-odd path rather than three shapes: where two circles
 * overlap the colour cancels and where all three do it comes back, which is
 * the mark's own figure — one person, two at the same evening, everyone there.
 */

import { MARK_CENTRES, MARK_R } from './Mark';

/** Where the three circles meet: the point they move toward and away from. */
const CENTROID = {
  x: (MARK_CENTRES[0].cx + MARK_CENTRES[1].cx + MARK_CENTRES[2].cx) / 3,
  y: (MARK_CENTRES[0].cy + MARK_CENTRES[1].cy + MARK_CENTRES[2].cy) / 3,
};

/**
 * The mark as one even-odd path in its 1024 box.
 *
 * `spread` is how far each circle sits from the centroid relative to where the
 * mark puts it (1 is the mark; 1.75 is the spinner's widest breath), and
 * `scale` is each circle's radius relative to `MARK_R`.
 */
export function markPath(spread: number, scale: readonly [number, number, number]): string {
  return MARK_CENTRES.map((c, i) => {
    const r = Math.max(MARK_R * scale[i]!, 0.1);
    const x = CENTROID.x + (c.cx - CENTROID.x) * spread;
    const y = CENTROID.y + (c.cy - CENTROID.y) * spread;
    // A circle as two arcs from its leftmost point.
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }).join(' ');
}

/** cubic-bezier(0.65, 0, 0.35, 1), the easing on every segment of both. */
export function ease(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  // Solve the bezier's x for its parameter by Newton's method, then read y.
  const p1x = 0.65, p2x = 0.35;
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * p1x + 3 * (1 - u) * u * u * p2x + u * u * u;
  const dbx = (u: number) =>
    3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x);
  let u = x;
  for (let i = 0; i < 6; i++) {
    const d = dbx(u);
    if (Math.abs(d) < 1e-6) break;
    u -= (bx(u) - x) / d;
    u = Math.min(Math.max(u, 0), 1);
  }
  // y control points are 0 and 1.
  return 3 * (1 - u) * u * u + u * u * u;
}

/** How far through `[from, to]` the moment `t` is, eased; 0 before, 1 after. */
const segment = (t: number, from: number, to: number) => ease((t - from) / (to - from));

/** One loop of the launch, in seconds. */
export const LAUNCH_LOOP = 3.0;

/**
 * The launch at `t` seconds into its loop.
 *
 * Pink, blue and mint grow in one after another (0, 0.42s, 0.84s, each taking
 * 0.42s), arriving a little wide of the mark and settling inward by 1.68s; the
 * mark holds until 2.52s, then all three shrink away by 3.0s.
 */
export function launchFrame(t: number): { spread: number; scale: [number, number, number] } {
  const out = 1 - segment(t, 2.52, 3.0);
  const scale = [0, 1, 2].map((i) => segment(t, i * 0.42, (i + 1) * 0.42) * out) as [
    number,
    number,
    number,
  ];
  const spread = 1.3 - 0.3 * segment(t, 1.26, 1.68);
  return { spread, scale };
}

/** The spinner's turn and breath, in seconds. */
export const SPIN_TURN = 2.4;
export const SPIN_BREATH = 1.6;

/**
 * The spinner at `t` seconds: how far round (degrees) and how wide.
 *
 * Out to 1.75× the mark's spacing and back, eased both ways, every 1.6s.
 */
export function spinnerFrame(t: number): { turn: number; spread: number } {
  const turn = ((t % SPIN_TURN) / SPIN_TURN) * 360;
  const phase = (t % SPIN_BREATH) / SPIN_BREATH;
  const breath = phase < 0.5 ? ease(phase * 2) : 1 - ease((phase - 0.5) * 2);
  return { turn, spread: 1 + 0.75 * breath };
}
