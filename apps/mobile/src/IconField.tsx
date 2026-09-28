/**
 * The app icon's background, as a component: the field `build-icon.mjs`
 * paints behind the mark.
 *
 * Two places wear it. The "+N" tile on a card's strip, where it was born and
 * where the long note below comes from, and the ring around each face in the
 * moments row — the one colourful thing on Home that is not somebody's
 * photograph, so it is the product's own colour rather than a new one.
 */

import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The wash behind the "+N" on the end of a card's strip: the app icon's field.
 *
 * It was `card` over `line` — white on a white page, and in the dark scheme a
 * dark grey square, which is what a photograph looks like when it has failed
 * to load. The one tile in the row that is not a photograph was reading as the
 * one that had broken. What replaced that was the mark's three pastels poured
 * into the square, and pastels are what this is not any more: mint under pink
 * under pale blue reads as a washed-out photograph rather than as the product,
 * which is the same failure one step along. A tile that is deliberately not a
 * picture has to be unmistakably not a picture.
 *
 * So it is the icon's own background instead — the field `build-icon.mjs`
 * paints behind the mark, which is the one surface in the product that is pure
 * brand and is already on the reader's home screen. Deep blue through violet
 * to teal, saturated rather than tinted. Somebody who has the app installed
 * has seen this square every day; the count now sits on the thing they tapped
 * to get here.
 *
 * The six blooms are the icon's stop for stop — every colour, every offset and
 * every opacity as `GRADIENTS` in that script has them, pinned by the test.
 * What is restated rather than copied is where they sit: centres and radii are
 * the icon's rescaled to a unit square and then pushed outward, because the
 * icon has the white mark in the middle and this has a number there. Verbatim,
 * the teal reaches in from the lower right far enough to put white at 2.3:1
 * over part of the digits. Pushing each bloom toward its own edge and pulling
 * the radii in leaves the same six lights in the same six places — pink above,
 * violet upper left, blue down the left, aqua at the foot, teal to the right —
 * while the middle stays the deep blue the base already is: 5.9:1 across the
 * band the digits actually occupy, and the corners as bright as the icon's.
 *
 * Alpha on the stops here, unlike the mark. The mark's regions are flat
 * colours that must not blend; a field is the opposite — these are lights on
 * a wall, and each one fading to nothing over its own colour is what makes
 * them read as one surface rather than six discs.
 */
const GLASS_BASE = '#173EA8';

type Bloom = {
  id: string;
  cx: number;
  cy: number;
  r: number;
  /** offset, colour, opacity — four stops, the icon's own. */
  stops: [number, string, number][];
};

const GLASS_BLOOMS: Bloom[] = [
  {
    id: 'pink',
    cx: 0.74,
    cy: 0.02,
    r: 0.62,
    stops: [
      [0, '#F79AB6', 1],
      [0.34, '#EB78A0', 0.92],
      [0.68, '#D86196', 0.42],
      [1, '#D86196', 0],
    ],
  },
  {
    id: 'violet',
    cx: 0.08,
    cy: 0.12,
    r: 0.5,
    stops: [
      [0, '#8F46DA', 0.78],
      [0.36, '#7B39C8', 0.5],
      [0.72, '#6E35BE', 0.12],
      [1, '#6E35BE', 0],
    ],
  },
  {
    id: 'blue',
    cx: 0.04,
    cy: 0.82,
    r: 0.66,
    stops: [
      [0, '#1337B7', 1],
      [0.36, '#1945C6', 0.96],
      [0.7, '#1D49C9', 0.42],
      [1, '#1D49C9', 0],
    ],
  },
  {
    id: 'aqua',
    cx: 0.52,
    cy: 1.06,
    r: 0.44,
    stops: [
      [0, '#25BCE6', 0.92],
      [0.38, '#21AEDD', 0.68],
      [0.72, '#1E9FD5', 0.18],
      [1, '#1E9FD5', 0],
    ],
  },
  /*
   * The seam, where the pink hands over to the teal, and it is a second
   * placement of a colour already in the set rather than a new one: pink and
   * teal are 170° apart, so alpha compositing averages them toward grey. The
   * violet's own second stop sits between the two on the wheel, which takes
   * the handover the short way round instead of straight across the middle.
   * The icon's reasoning, and the reason it is not simply dropped here.
   */
  {
    id: 'seam',
    cx: 1.02,
    cy: 0.28,
    r: 0.5,
    stops: [
      [0, '#7D37CC', 0.62],
      [0.45, '#7D37CC', 0.5],
      /* Three, where the others have four: a gradient holds its last stop out
         to the edge, so the fade is already over by 86%. The icon's own. */
      [0.86, '#7D37CC', 0],
    ],
  },
  {
    id: 'teal',
    cx: 1.06,
    cy: 0.78,
    r: 0.56,
    stops: [
      [0, '#66E7C6', 0.95],
      [0.34, '#46D8C1', 0.84],
      [0.7, '#39CDBD', 0.34],
      [1, '#39CDBD', 0],
    ],
  },
];

export function IconField() {
  /*
   * Ids unique to this instance, for exactly the reason `Mark` does the same:
   * `react-native-svg` resolves paint references against a registry that is
   * not per-`Svg` on every platform, so several of these mounted at once — one
   * per card, on a scrolling list — can end up painting with each other's
   * gradients.
   */
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        {GLASS_BLOOMS.map((bloom) => (
          <RadialGradient
            key={bloom.id}
            id={`${id}${bloom.id}`}
            cx={`${bloom.cx * 100}%`}
            cy={`${bloom.cy * 100}%`}
            r={`${bloom.r * 100}%`}
          >
            {bloom.stops.map(([offset, colour, opacity]) => (
              <Stop
                key={offset}
                offset={`${offset * 100}%`}
                stopColor={colour}
                stopOpacity={opacity}
              />
            ))}
          </RadialGradient>
        ))}
      </Defs>
      {/* The base is the ground rather than a seventh bloom, exactly as the
          icon has it: six fades over nothing leave the corners empty, and an
          empty corner on a tile in a row of photographs is the broken-image
          look this replaced. */}
      <Rect width="100%" height="100%" fill={GLASS_BASE} />
      {GLASS_BLOOMS.map((bloom) => (
        <Rect key={bloom.id} width="100%" height="100%" fill={`url(#${id}${bloom.id})`} />
      ))}
    </Svg>
  );
}

/** A rounded rectangle as a path, clockwise, starting at the top edge. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} ` +
    `V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
  );
}

/**
 * The icon's field as a rounded-square ring, drawn as its own shape.
 *
 * Not the field cut down by its parent's `overflow: hidden` and
 * `borderRadius` — which is how the moments strip first wore it, and why its
 * corners came out cut: an SVG is its own native view, and whether a parent's
 * rounded clip reaches into it is up to the platform and the renderer rather
 * than to us. Here the ring is a path — the outer rounded square with the inner
 * one taken out by the even-odd rule — so the corners are in the geometry and
 * nothing has to clip anything.
 *
 * The blooms are the same gradients over the same bounding box, because a
 * path's bounding box is the outer square: the colours land exactly where the
 * full field would put them.
 */
export function IconRing({
  size,
  radius,
  thickness,
  color,
}: {
  size: number;
  radius: number;
  thickness: number;
  /** A flat colour instead of the field — the ring of something already seen. */
  color?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const d =
    roundedRect(0, 0, size, size, radius) +
    ' ' +
    roundedRect(thickness, thickness, size - thickness * 2, size - thickness * 2, radius - thickness);
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      {!color && (
        <Defs>
          {GLASS_BLOOMS.map((bloom) => (
            <RadialGradient
              key={bloom.id}
              id={`${id}${bloom.id}`}
              cx={`${bloom.cx * 100}%`}
              cy={`${bloom.cy * 100}%`}
              r={`${bloom.r * 100}%`}
            >
              {bloom.stops.map(([offset, colour, opacity]) => (
                <Stop
                  key={offset}
                  offset={`${offset * 100}%`}
                  stopColor={colour}
                  stopOpacity={opacity}
                />
              ))}
            </RadialGradient>
          ))}
        </Defs>
      )}
      <Path d={d} fillRule="evenodd" fill={color ?? GLASS_BASE} />
      {!color &&
        GLASS_BLOOMS.map((bloom) => (
          <Path key={bloom.id} d={d} fillRule="evenodd" fill={`url(#${id}${bloom.id})`} />
        ))}
    </Svg>
  );
}

