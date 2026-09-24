/**
 * The mark: three photo sets from three people, overlapping into one.
 *
 * Inline SVG rather than an `<img>` because it is six numbers and one request
 * fewer, and because a mark that renders before the stylesheet does is a mark
 * that never flashes.
 *
 * This is the *pale* mark, which is one of the product's two drawings — the
 * other being the app icon, a white even-odd cutout on a gradient field, which
 * `appIcon.ts` holds and which the favicon and the link-preview card wear. The
 * split is deliberate: this one is drawn at 22 to 48px on a white page, where
 * the icon would have to arrive as a badge with its own corners in the middle
 * of a sheet of white.
 *
 * The geometry is the same as the native mark's and is *checked* against it —
 * see `brand.test.ts`. Drawings of one logo drifting apart is not a thing
 * anyone notices until two of them meet in a screenshot; it had already
 * happened once, in the link-preview image, which had invented its own
 * colours while claiming in a comment to share these numbers.
 *
 * There is no background rect, unlike the icon: iOS requires a fully opaque
 * square and rejects alpha, while on a page the mark should sit on whatever is
 * behind it. And the overlaps are painted as explicit regions rather than
 * produced by a blend mode — multiply turns the pink-over-mint lens muddy, and
 * that lens is the one place the design wants warmth.
 */

/**
 * Radius and centre offset, the only two numbers the shape depends on.
 *
 * Was 184 with centres 134 out — a ratio of 0.73 — and both moved for one
 * complaint: at the size a sidebar draws it, the mark nearly disappeared.
 * Bigger circles put more colour on the screen; the tighter 0.66 makes the
 * centre triangle, which is the part carrying the meaning, a shape you can
 * still see at 16px rather than a sliver between three discs.
 */
export const MARK_R = 200;
export const MARK_CENTRES = [
  { cx: 512, cy: 400 },
  { cx: 398, cy: 598 },
  { cx: 626, cy: 598 },
] as const;

/**
 * Seven regions, seven fills: three circles, three lenses, and the middle.
 *
 * Every one gained 18% chroma in OKLCH with its hue and lightness held, so
 * this is the same drawing turned up rather than a different palette — the
 * complaint was that it was faint, not that it was the wrong colour. Two
 * exceptions worth recording:
 *
 *   - the pink already sat on the sRGB boundary at its old lightness, so the
 *     only way for it to become more colourful was to become slightly less
 *     pale;
 *   - the centre went darker as well, and more than the rest. It is the only
 *     part of the mark that has to read as a distinct shape rather than as a
 *     tint, and at 16px a middle only a shade off its neighbours is a smudge.
 *
 * Not the same list as the avatar lens palette, which happens to share three
 * values and is a separate decision — those are stand-ins for people without
 * a picture, and they are not the logo.
 */
export const MARK_FILLS = {
  pink: '#ffa6ad',
  blue: '#99b1fa',
  mint: '#9cdec5',
  pinkOnBlue: '#cb96e1',
  pinkOnMint: '#fbb277',
  blueOnMint: '#61b8c9',
  /** Everyone was there. The subject of the whole mark. */
  centre: '#a16eb9',
} as const;

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

      <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={MARK_FILLS.pink} />
      <circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill={MARK_FILLS.blue} />
      <circle cx={mint.cx} cy={mint.cy} r={MARK_R} fill={MARK_FILLS.mint} />

      <g clipPath="url(#mark-blue)">
        <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={MARK_FILLS.pinkOnBlue} />
      </g>
      <g clipPath="url(#mark-mint)">
        <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={MARK_FILLS.pinkOnMint} />
      </g>
      <g clipPath="url(#mark-mint)">
        <circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill={MARK_FILLS.blueOnMint} />
      </g>

      {/* Everyone was there. Drawn last because the three lenses above each
          cover this region on their way past. */}
      <g clipPath="url(#mark-blue)">
        <g clipPath="url(#mark-mint)">
          <circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={MARK_FILLS.centre} />
        </g>
      </g>
    </svg>
  );
}
