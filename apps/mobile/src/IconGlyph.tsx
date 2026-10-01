/**
 * The brand glyph: three solid circles whose overlaps are cut out.
 *
 * The same drawing as the web's `IconGlyph` and the app icon, path for path —
 * the one mark this product shows at rest. Not `Mark`, which is the coloured
 * lens drawing, nor its `tint`ed form, which draws each region at a different
 * opacity for the spinner and reads as a translucent cousin of the logo rather
 * than the logo.
 */

import Svg, { Path } from 'react-native-svg';

const GLYPH =
  'M330 396.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M444.32 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z' +
  'M215.68 594.5a182 182 0 1 0 364 0a182 182 0 1 0 -364 0Z';

export function IconGlyph({ size = 30, color }: { size?: number; color: string }) {
  return (
    // Cropped to the three circles with a little air, as on the web, so the
    // size given is the glyph's and not a tile's.
    <Svg
      width={size}
      height={Math.round(size * (582 / 612))}
      viewBox="206 204 612 582"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={GLYPH} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
