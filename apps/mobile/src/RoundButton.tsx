/**
 * The product's one piece of round chrome.
 *
 * A 36pt disc in the card colour with a hairline border — the shape the Events
 * tab's `+` had, and the one every other corner control was very nearly. The
 * profile drew bare glyphs with no disc at all; the album drew a dark blur
 * circle over its cover and a plain `‹ All events` opposite it. Four corners,
 * four answers to the same question, and nothing to learn from any of them.
 *
 * ## Why it is opaque even over a photograph
 *
 * The album's controls sit on somebody's picture, and the blur they used was
 * the careful answer to that: it dims whatever is behind it so white ink reads.
 * The trouble is that it only works while the ink is white, so those two
 * corners could never match the two on a page. A filled disc solves the same
 * problem in the way the rest of the product already does — the tab bar, the
 * `+`, every pill — and being opaque it reads on a white sky as readily as on a
 * dark room.
 *
 * Sized once here. A control that is 36 points on one screen and 32 on the next
 * is not a smaller control, it is a different one.
 *
 * ## The tint
 *
 * The Moments bar's aurora, faint, inside every disc — so the corners and the
 * bar read as the same glass. Placed for a circle rather than the bar's wide
 * card: one light low-left, one high, one low-right, each reaching past the
 * middle so the colours meet behind the glyph. Held well below the bar's resting glow,
 * not its lively one: a corner control that shone would look like it was
 * announcing something, and the badge on Lately is what does that.
 */

import { useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useAppearance } from './appearance';
import { AURORA_DARK, AURORA_LIGHT } from './aurora';
import type { GroupTheme } from './Groups';

/** The disc. Also the touch target, which is why it is not smaller. */
export const ROUND = 36;

export function RoundButton({
  t,
  onPress,
  accessibilityLabel,
  children,
  style,
}: {
  t: GroupTheme;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  /** Where it sits. The shape is this component's; the position is not. */
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      // Generous, because 36 points is the disc and not the reach: these live
      // in corners, which is where a thumb is least accurate.
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Tint />
      {children}
    </Pressable>
  );
}

/** Where each of the three lights sits in the disc. */
const PLACES = [
  { cx: '25%', cy: '75%' },
  { cx: '60%', cy: '15%' },
  { cx: '90%', cy: '80%' },
] as const;

/** Far fainter than even the bar at rest: a hint of colour in the glass, no more. */
const GLOW = 0.06;

function Tint() {
  const scheme = useAppearance();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const lights = scheme === 'light' ? AURORA_LIGHT : AURORA_DARK;
  return (
    /* Its own clipped layer, so the disc itself does not clip — Lately's badge
       hangs over the edge. */
    <View style={styles.tint} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {lights.map((light, i) => (
            <RadialGradient
              key={light.id}
              id={`${id}${light.id}`}
              cx={PLACES[i]!.cx}
              cy={PLACES[i]!.cy}
              rx="65%"
              ry="65%"
            >
              <Stop offset="0" stopColor={light.colour} stopOpacity={light.opacity * GLOW} />
              <Stop offset="1" stopColor={light.colour} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {lights.map((light) => (
          <Rect key={light.id} width="100%" height="100%" fill={`url(#${id}${light.id})`} />
        ))}
      </Svg>
    </View>
  );
}

/**
 * The `⋯`, at the size the disc wants it.
 *
 * A glyph rather than a component of its own, because the three dots are a
 * character and every corner that draws them was choosing its own size for it.
 */
export function More({ color }: { color: string }) {
  return <Text style={[styles.more, { color }]}>⋯</Text>;
}

/** The back chevron, likewise. */
export function Back({ color }: { color: string }) {
  return <Text style={[styles.back, { color }]}>‹</Text>;
}

const styles = StyleSheet.create({
  round: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Inside the 1pt border, so a point less round than the disc. */
  tint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: ROUND / 2 - 1,
    overflow: 'hidden',
  },
  /* Nudged up a point: the glyph sits on the baseline and reads low in a
     circle otherwise. */
  more: { fontSize: 18, fontWeight: '600', lineHeight: 20, marginTop: -1 },
  /* And the chevron the other way, because it is taller than it is wide and
     its optical centre is right of the box it is given. */
  back: { fontSize: 24, lineHeight: 26, marginRight: 2, marginTop: -1 },
});
