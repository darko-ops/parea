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
 */

import { Pressable, StyleSheet, Text } from 'react-native';

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
      {children}
    </Pressable>
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
  /* Nudged up a point: the glyph sits on the baseline and reads low in a
     circle otherwise. */
  more: { fontSize: 18, fontWeight: '600', lineHeight: 20, marginTop: -1 },
  /* And the chevron the other way, because it is taller than it is wide and
     its optical centre is right of the box it is given. */
  back: { fontSize: 24, lineHeight: 26, marginRight: 2, marginTop: -1 },
});
