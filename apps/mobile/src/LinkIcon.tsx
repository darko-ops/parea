/**
 * Two chain links, beside the address on a profile.
 *
 * Grey rather than the link's blue: it labels the line as an address, and the
 * address itself is the thing to press. Drawn on the same 24-unit grid and
 * stroke as the web's copy in `PersonView` and `AccountView`.
 */

import Svg, { Path } from 'react-native-svg';

export function LinkIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <Path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}
