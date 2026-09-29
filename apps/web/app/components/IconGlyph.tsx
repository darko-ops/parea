/**
 * The mark as the app icon draws it: three circles as one even-odd path, so
 * where two overlap the shape cuts through rather than fills. Copied verbatim
 * from `assets/branding/parea-icon-dark-refined.svg`, `<g id="mark">` —
 * the icon's white glyph, without the icon's field behind it.
 *
 * In `currentColor`, so it takes the ink of wherever it is placed: white on
 * the dark page, near-black on the light one. Pure white would be no mark at
 * all on a light page.
 */

const GLYPH =
  'M330 396.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M444.32 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M215.68 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z';

export function IconGlyph({ size = 30, label }: { size?: number; label?: string }) {
  return (
    // Cropped to the three circles (x 215.68–808.32, y 214.5–776.5), with a
    // little air, so the size given is the glyph's and not the tile's.
    <svg
      width={size}
      height={Math.round(size * (582 / 612))}
      viewBox="206 204 612 582"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={GLYPH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
