/**
 * Softening the four edges of an album's cover.
 *
 * The cover is a photograph 232 points tall with a hard rectangular boundary:
 * three sides against the screen's edges and one against the page below it.
 * That last one is the seam you notice — a picture stops, a line, and then the
 * app. Blurring the boundary makes the photograph read as something the screen
 * is showing part of rather than a panel that was pasted on.
 *
 * ## Why it is stacked rather than one blur
 *
 * A `BlurView` is uniform: it blurs everything behind it equally and stops dead
 * at its own edge. One band along the bottom would trade the hard edge of the
 * photograph for the hard edge of the blur, half an inch higher up — the same
 * line, drawn in a different place.
 *
 * What is wanted is a ramp, and the way to get one without a mask library is to
 * stack a few bands of increasing strength and decreasing width. Each one's
 * inner edge is a small step rather than a cliff, and three steps is enough
 * that the eye reads it as a gradient. The alternative is
 * `@react-native-masked-view` and a gradient alpha channel, which is a native
 * dependency and a rebuild for an effect that is two hundred lines of nothing.
 *
 * ## The tint follows the page
 *
 * A blur on iOS is not just a blur: the material carries a wash, and a light
 * wash under a dark page is a grey haze around the picture. Following the theme
 * means the edges dissolve *into* the thing they border rather than into a
 * colour that belongs to neither.
 *
 * Kept deliberately weak. The scrim over this is what carries the back button
 * and the title, and it was tuned against an unblurred photograph — a strong
 * blur underneath changes what that gradient is sitting on and the two start
 * fighting over the same forty points.
 */

import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';

/**
 * How far in from each edge the softening reaches, and how hard it blurs.
 *
 * Widest and weakest first, so each later band sits inside the one before it.
 * The numbers are a ramp rather than measurements of anything: below about 6
 * the material does not visibly blur, and much past 30 the photograph starts
 * losing its subject to its own frame.
 */
const BANDS = [
  { size: 34, intensity: 7 },
  { size: 22, intensity: 13 },
  { size: 12, intensity: 22 },
];

export function CoverEdges({ dark }: { dark: boolean }) {
  const tint = dark ? 'dark' : 'light';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {BANDS.map(({ size, intensity }) => (
        <View key={size} style={StyleSheet.absoluteFill}>
          <BlurView intensity={intensity} tint={tint} style={[styles.edge, styles.top, { height: size }]} />
          <BlurView intensity={intensity} tint={tint} style={[styles.edge, styles.bottom, { height: size }]} />
          {/*
            The sides are inset by the band's own height so they do not stack on
            top of the two above — a corner with four bands over it is four times
            the wash, and it shows as a dark blot in each corner of an otherwise
            even frame.
          */}
          <BlurView
            intensity={intensity}
            tint={tint}
            style={[styles.edge, styles.left, { width: size, top: size, bottom: size }]}
          />
          <BlurView
            intensity={intensity}
            tint={tint}
            style={[styles.edge, styles.right, { width: size, top: size, bottom: size }]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute' },
  top: { top: 0, left: 0, right: 0 },
  bottom: { bottom: 0, left: 0, right: 0 },
  left: { left: 0 },
  right: { right: 0 },
});
