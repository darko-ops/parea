/**
 * The bottom edge of an album's cover, as a panel of stained glass.
 *
 * The cover is a photograph 232 points tall, and three of its four sides are
 * the screen's own edges. Only the bottom one borders anything — the page below
 * it — and that is the seam anybody notices: a picture stops, a line, and then
 * the app. Softening the other three turned out to be a vignette nobody asked
 * for, so this is the one edge that gets anything.
 *
 * ## What makes it glass rather than frost
 *
 * `systemUltraThinMaterial` is the thinnest material iOS has: it blurs what is
 * behind it while keeping most of its colour, which is the difference between
 * looking through glass and looking at frost. A `light` or `dark` tint would
 * wash the photograph grey, and a grey band under a photograph is a band, not
 * a window.
 *
 * ## What makes it stained
 *
 * Panes and leading. The band is divided into vertical lights of uneven width
 * with a dark line between each, and each light carries a slightly different
 * thickness of glass — so the photograph arrives through it in bands that
 * refract a little differently, which is what the eye reads as leaded glass
 * rather than as a blurred strip.
 *
 * The widths are uneven on purpose. Equal divisions read as a progress bar or a
 * segmented control — both things this product has elsewhere and neither of
 * them a window. They come from a fixed table rather than a random number, so
 * the same album draws the same window every time it opens.
 *
 * ## Why it is stacked
 *
 * A `BlurView` is uniform: it blurs everything behind it equally and stops dead
 * at its own edge. One band would trade the hard edge of the photograph for the
 * hard edge of the blur, half an inch higher up — the same line, drawn
 * somewhere else. Three bands of increasing strength and decreasing height make
 * each inner edge a step rather than a cliff, which the eye reads as a ramp.
 * The leading fades out over the same distance, so the lights emerge from the
 * photograph rather than being ruled onto it.
 *
 * The honest alternative to all of this is `@react-native-masked-view` with a
 * gradient alpha channel, which is a native dependency and a rebuild for an
 * effect that is otherwise a hundred lines of nothing.
 */

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

/** How far up the photograph the glass reaches. */
export const GLASS = 58;

/**
 * The ramp, widest and weakest first, so each band sits inside the one before.
 *
 * Below about 6 the material does not visibly blur; much past 30 the bottom of
 * the photograph stops being a photograph. `size` is a fraction of `GLASS` so
 * the ramp holds its proportions if the band's height ever moves.
 */
const BANDS = [
  { at: 1, intensity: 8 },
  { at: 0.62, intensity: 16 },
  { at: 0.3, intensity: 26 },
];

/**
 * The lights, as fractions of the width.
 *
 * Uneven, and they sum to 1. Five is enough to read as leaded and few enough
 * that each is wider than it is tall — a light taller than it is wide reads as
 * a column, which is a different window.
 */
const LIGHTS = [0.22, 0.16, 0.27, 0.14, 0.21];

/** The came between two lights: dark, thin, and gone by the top of the band. */
const LEAD = 'rgba(12,14,18,0.30)';

export function CoverEdges() {
  return (
    <View style={[styles.glass, { height: GLASS }]} pointerEvents="none">
      {BANDS.map(({ at, intensity }) => (
        <BlurView
          key={at}
          intensity={intensity}
          // The one material that keeps the colour of what is behind it, which
          // is the whole difference between glass and frost.
          tint="systemUltraThinMaterial"
          style={[styles.band, { height: GLASS * at }]}
        />
      ))}

      {/*
        The lights, each a slightly different thickness of glass.

        Faint — 0.05 at the strongest. The point is that neighbouring panes are
        not identical, not that anybody can name which is which; at the
        opacities where you could, it stops being a window and becomes stripes.
      */}
      <View style={styles.lights}>
        {LIGHTS.map((width, i) => (
          <View key={width} style={{ flex: width }}>
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' },
              ]}
            />
            {/*
              The came, on the leading edge of every light but the first — a
              line between two panes, not around the outside of the window.
              Fading upward over the band's full height so it arrives out of the
              photograph rather than being ruled onto it.
            */}
            {i > 0 && (
              <LinearGradient
                colors={['rgba(12,14,18,0)', LEAD]}
                locations={[0, 0.85]}
                style={styles.came}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Pinned to the bottom of the cover, full width. */
  glass: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /* Every band shares the bottom edge and differs only in how far up it goes. */
  band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  lights: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  /* A hairline rather than a point, so it reads as lead and not as a border. */
  came: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 1.5 },
});
