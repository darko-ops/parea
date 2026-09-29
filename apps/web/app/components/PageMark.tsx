/**
 * The mark, alone, at the top of a page — the one on the app icon.
 *
 * The icon's white glyph, not the coloured lockup the rail's favicon uses:
 * three circles drawn as one even-odd path, so where two overlap the shape
 * cuts through rather than fills, and the path is the icon's own —
 * `assets/branding/parea-icon-dark-refined.svg`, `<g id="mark">`, copied
 * verbatim. Without the icon's field behind it: on a page the surface is
 * already the ground.
 *
 * In the page's ink rather than fixed white, so it is white on the dark page
 * and near-black on the light one; white on white would be no mark at all.
 *
 * It takes the centre the greeting used to hold — the greeting moves to the
 * leading side, clear of the search disc Chat keeps there — so every page with
 * this header opens the same way. Desktop only; on a phone the rail's bar
 * already carries the name. Decorative: the name is beside it in the rail.
 */

/** From the icon, unchanged. */
const GLYPH =
  'M330 396.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M444.32 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M215.68 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z';

export function PageMark() {
  return (
    <span className="page-mark">
      {/* Cropped to the three circles (x 215.68–808.32, y 214.5–776.5), with a
          little air, so the size given is the glyph's and not the tile's. */}
      <svg
        width={30}
        height={29}
        viewBox="206 204 612 582"
        aria-hidden="true"
        focusable="false"
      >
        <path d={GLYPH} fill="currentColor" fillRule="evenodd" />
      </svg>
    </span>
  );
}
