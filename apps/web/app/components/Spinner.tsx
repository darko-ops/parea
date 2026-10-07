/**
 * The slow-page spinner — the mark turning and breathing.
 *
 * From the design package: the mark turns once every 2.4s while its three
 * circles drift apart to 1.75× their spacing and back every 1.6s, on
 * cubic-bezier(0.65, 0, 0.35, 1). On the light theme the icon's colour field
 * shows through the moving shape; on dark it is a white cutout. The app draws
 * the same thing in `apps/mobile/src/Waiting.tsx`.
 *
 * ## No JavaScript
 *
 * SMIL on the SVG itself: the path's `d` is animated between the mark and its
 * widest breath — the two have the same commands, so every browser
 * interpolates them — and the rotation is an `animateTransform`. A server
 * component, then, which is what a `loading.tsx` wants: it is on screen
 * precisely while the page's JavaScript is not.
 *
 * ## What CSS decides
 *
 * Which of the three drawings shows. Both themes' spinners are in the markup
 * and the theme picks one — the theme is a cookie read by an inline script,
 * and asking which in render would mean the server guessing. Nothing shows for
 * the first 400ms, so a fast load never flashes it. Under
 * `prefers-reduced-motion` the still mark replaces the moving ones.
 */

import { MARK_CENTRES, MARK_R } from './Mark';

const CENTROID = {
  x: (MARK_CENTRES[0].cx + MARK_CENTRES[1].cx + MARK_CENTRES[2].cx) / 3,
  y: (MARK_CENTRES[0].cy + MARK_CENTRES[1].cy + MARK_CENTRES[2].cy) / 3,
};

/** The mark as one even-odd path, its circles at `spread` × their spacing. */
function markPath(spread: number): string {
  return MARK_CENTRES.map((c) => {
    const x = CENTROID.x + (c.cx - CENTROID.x) * spread;
    const y = CENTROID.y + (c.cy - CENTROID.y) * spread;
    const r = MARK_R;
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }).join(' ');
}

const REST = markPath(1);
const WIDE = markPath(1.75);
const EASE = '0.65 0 0.35 1';

/** The breath and the turn, as SMIL children of the path that carries them. */
function Motion() {
  return (
    <>
      <animate
        attributeName="d"
        values={`${REST};${WIDE};${REST}`}
        dur="1.6s"
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes="0;0.5;1"
        keySplines={`${EASE};${EASE}`}
      />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from={`0 ${CENTROID.x} ${CENTROID.y}`}
        to={`360 ${CENTROID.x} ${CENTROID.y}`}
        dur="2.4s"
        repeatCount="indefinite"
      />
    </>
  );
}

/** The icon's field: six washes over a deep blue. Same as the app's. */
const WASHES: [string, number, number, number, [string, string, number][]][] = [
  ['pink', 700, 40, 820, [['0%', '#F79AB6', 1], ['34%', '#EB78A0', 0.92], ['68%', '#D86196', 0.42], ['100%', '#D86196', 0]]],
  ['purple', 130, 170, 620, [['0%', '#8F46DA', 0.78], ['36%', '#7B39C8', 0.5], ['72%', '#6E35BE', 0.12], ['100%', '#6E35BE', 0]]],
  ['blue', 80, 780, 780, [['0%', '#1337B7', 1], ['36%', '#1945C6', 0.96], ['70%', '#1D49C9', 0.42], ['100%', '#1D49C9', 0]]],
  ['cyan', 520, 1040, 560, [['0%', '#25BCE6', 0.92], ['38%', '#21AEDD', 0.68], ['72%', '#1E9FD5', 0.18], ['100%', '#1E9FD5', 0]]],
  ['seam', 1010, 330, 640, [['0%', '#7D37CC', 0.62], ['45%', '#7D37CC', 0.5], ['86%', '#7D37CC', 0]]],
  ['teal', 1030, 760, 760, [['0%', '#66E7C6', 0.95], ['34%', '#46D8C1', 0.84], ['70%', '#39CDBD', 0.34], ['100%', '#39CDBD', 0]]],
];

export function Spinner({ size = 56, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <div className="spinner" role="progressbar" aria-label={label} style={{ width: size, height: size }}>
      {/* Light: the field, seen through the moving mark. */}
      <svg className="spinner-light spinner-moving" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
        <defs>
          {WASHES.map(([key, cx, cy, r, stops]) => (
            <radialGradient key={key} id={`spin-${key}`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r}>
              {stops.map(([offset, color, opacity]) => (
                <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
              ))}
            </radialGradient>
          ))}
          <mask id="spin-mark" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
            <path fill="#fff" fillRule="evenodd" d={REST}>
              <Motion />
            </path>
          </mask>
        </defs>
        <g mask="url(#spin-mark)">
          <rect width="1024" height="1024" fill="#173EA8" />
          {WASHES.map(([key]) => (
            <rect key={key} width="1024" height="1024" fill={`url(#spin-${key})`} />
          ))}
        </g>
      </svg>
      {/* Dark: a white cutout. */}
      <svg className="spinner-dark spinner-moving" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
        <path fill="#fff" fillRule="evenodd" d={REST}>
          <Motion />
        </path>
      </svg>
      {/* Reduced motion: the mark, still, in the theme's ink. */}
      <svg className="spinner-still" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
        <path fill="currentColor" fillRule="evenodd" d={REST} />
      </svg>
    </div>
  );
}
