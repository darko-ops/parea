/**
 * The icon's colour field — six radial washes over a deep blue.
 *
 * From the design package (`assets/branding/parea-icon-dark-refined.svg`'s
 * field). The launch draws it full-bleed behind the mark; the light-theme
 * spinner draws it *through* the mark, so the shape moves and the colour stays
 * where it is. One definition for both, so they are the same field.
 *
 * Returned as `<Defs>` plus the rects, for the caller to place inside its own
 * `<Svg>` — under a mask, or not. Ids carry a prefix so two fields on one
 * screen do not share gradients.
 */

import { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export const FIELD_BASE = '#173EA8';

type Wash = {
  key: string;
  cx: number;
  cy: number;
  r: number;
  stops: [offset: string, color: string, opacity: number][];
};

const WASHES: Wash[] = [
  { key: 'pink', cx: 700, cy: 40, r: 820, stops: [['0%', '#F79AB6', 1], ['34%', '#EB78A0', 0.92], ['68%', '#D86196', 0.42], ['100%', '#D86196', 0]] },
  { key: 'purple', cx: 130, cy: 170, r: 620, stops: [['0%', '#8F46DA', 0.78], ['36%', '#7B39C8', 0.5], ['72%', '#6E35BE', 0.12], ['100%', '#6E35BE', 0]] },
  { key: 'blue', cx: 80, cy: 780, r: 780, stops: [['0%', '#1337B7', 1], ['36%', '#1945C6', 0.96], ['70%', '#1D49C9', 0.42], ['100%', '#1D49C9', 0]] },
  { key: 'cyan', cx: 520, cy: 1040, r: 560, stops: [['0%', '#25BCE6', 0.92], ['38%', '#21AEDD', 0.68], ['72%', '#1E9FD5', 0.18], ['100%', '#1E9FD5', 0]] },
  { key: 'seam', cx: 1010, cy: 330, r: 640, stops: [['0%', '#7D37CC', 0.62], ['45%', '#7D37CC', 0.5], ['86%', '#7D37CC', 0]] },
  { key: 'teal', cx: 1030, cy: 760, r: 760, stops: [['0%', '#66E7C6', 0.95], ['34%', '#46D8C1', 0.84], ['70%', '#39CDBD', 0.34], ['100%', '#39CDBD', 0]] },
];

/** The gradients, for a `<Defs>` the caller owns. */
export function FieldDefs({ prefix }: { prefix: string }) {
  return (
    <Defs>
      {WASHES.map((wash) => (
        <RadialGradient
          key={wash.key}
          id={`${prefix}-${wash.key}`}
          gradientUnits="userSpaceOnUse"
          cx={wash.cx}
          cy={wash.cy}
          r={wash.r}
        >
          {wash.stops.map(([offset, color, opacity]) => (
            <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
          ))}
        </RadialGradient>
      ))}
    </Defs>
  );
}

/** The field itself, filling the 1024 box. */
export function FieldRects({ prefix }: { prefix: string }) {
  return (
    <>
      <Rect width={1024} height={1024} fill={FIELD_BASE} />
      {WASHES.map((wash) => (
        <Rect key={wash.key} width={1024} height={1024} fill={`url(#${prefix}-${wash.key})`} />
      ))}
    </>
  );
}
