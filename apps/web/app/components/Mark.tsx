/**
 * The mark: three photo sets from three people, overlapping into one.
 *
 * Inline SVG rather than an `<img>` because it is six numbers and one request
 * fewer, and because a mark that renders before the stylesheet does is a mark
 * that never flashes.
 *
 * The geometry is the same as `apps/mobile/assets/icon.svg` and is *checked*
 * against it — see `brand.test.ts`. Two drawings of the same logo drifting
 * apart is not a thing anyone notices until the app icon and the website
 * disagree in a screenshot.
 *
 * Two deliberate differences from the app icon. There is no background rect:
 * iOS requires a fully opaque square and rejects alpha, while on a page the
 * mark should sit on whatever is behind it. And the overlaps are painted as
 * explicit regions rather than produced by a blend mode, which is the icon's
 * reasoning too — multiply turns the pink-over-mint lens muddy, and that lens
 * is the one place the design wants warmth.
 */

/** Radius and centre offset, the only two numbers the shape depends on. */
export const MARK_R = 184;
export const MARK_CENTRES = [
  { cx: 512, cy: 398 },
  { cx: 396, cy: 599 },
  { cx: 628, cy: 599 },
] as const;

export function Mark({ size = 22 }: { size?: number }) {
  const [pink, blue, mint] = MARK_CENTRES;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      // Decorative: the wordmark beside it already says Parea, and a screen
      // reader announcing "Parea logo, Parea" is noise.
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="mark-blue">
          <circle cx={blue.cx} cy={blue.cy} r={MARK_R} />
        </clipPath>
        <clipPath id="mark-mint">
          <circle cx={mint.cx} cy={mint.cy} r={MARK_R} />
        </clipPath>
      </defs>

      <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill="#ffb3b8" />
      <circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill="#9db2f0" />
      <circle cx={mint.cx} cy={mint.cy} r={MARK_R} fill="#a5dcc6" />

      <g clipPath="url(#mark-blue)">
        <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill="#c79ad9" />
      </g>
      <g clipPath="url(#mark-mint)">
        <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill="#f3b584" />
      </g>
      <g clipPath="url(#mark-mint)">
        <circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill="#6fb6c4" />
      </g>

      {/* Everyone was there. Drawn last because the three lenses above each
          cover this region on their way past. */}
      <g clipPath="url(#mark-blue)">
        <g clipPath="url(#mark-mint)">
          <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill="#8c93c6" />
        </g>
      </g>
    </svg>
  );
}
