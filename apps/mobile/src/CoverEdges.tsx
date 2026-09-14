/**
 * Where an album's cover meets the page, as a short panel of leaded glass.
 *
 * The cover is a photograph 232 points tall, and three of its four sides are
 * the screen's own edges. Only the bottom one borders anything, and that is the
 * seam anybody notices: a picture stops, a line, and then the app.
 *
 * ## The blur has to actually fade
 *
 * This was three stacked `BlurView`s of increasing strength, on the theory that
 * three small steps read as a ramp. They do not — a `BlurView` is uniform and
 * stops dead at its own edge, so what you see is three rows of blur with two
 * visible seams between them, which is worse than the single seam the whole
 * thing exists to remove. Adding more bands makes the steps smaller and the
 * problem bigger: every band carries the material's own wash as well as its
 * blur, so ten of them stacked is a milky slab.
 *
 * The fix is the one that was described as too expensive last time and is not:
 * `@react-native-masked-view` puts a real alpha channel on one blur. A vertical
 * gradient from transparent to opaque is the mask, so the blur is absent at the
 * top of the band and full at the bottom, continuously. One layer, one wash,
 * and no seam anywhere — which is what a gradient blur is.
 *
 * ## What makes it glass rather than frost
 *
 * `systemUltraThinMaterial` is the thinnest material iOS has: it blurs what is
 * behind it while keeping most of its colour. A `light` or `dark` tint washes
 * the photograph grey, and a grey band under a photograph is a band, not a
 * window.
 *
 * ## What makes it stained
 *
 * Lights and came. The band is divided into vertical panes of uneven width with
 * a dark line between them, and each pane carries a slightly different
 * thickness of glass. Uneven on purpose: equal divisions read as a progress bar
 * or a segmented control, both of which this product has elsewhere and neither
 * of which is a window. They come from a fixed table rather than a random
 * number, so an album draws the same window every time it opens.
 *
 * All of it lives inside the mask, so the panes and the leading fade out with
 * the blur they belong to rather than ending on a line of their own.
 */

import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

/**
 * How far up the photograph the glass reaches.
 *
 * Short. It was 58 and read as a band across the bottom of somebody's picture;
 * this is deep enough to dissolve an edge and shallow enough that what it
 * dissolves is the edge rather than the photograph.
 */
export const GLASS = 34;

/**
 * Where the mask starts letting the blur through.
 *
 * Not 0: a gradient that begins at the very top of the band spends its first
 * few points on a blur too faint to see, which makes the band feel taller than
 * it is without looking any softer.
 */
const RAMP = 0.12;

/** How hard the glass blurs where it is fully opaque. */
const INTENSITY = 32;

/**
 * The lights, as fractions of the width. Uneven, and they sum to 1.
 *
 * Five is enough to read as leaded and few enough that each stays wider than it
 * is tall — a light taller than it is wide reads as a column, which is a
 * different window.
 */
const LIGHTS = [0.22, 0.16, 0.27, 0.14, 0.21];

/** The came between two lights: dark, thin, and gone before the top. */
const LEAD = 'rgba(12,14,18,0.26)';

export function CoverEdges() {
  return (
    <View style={[styles.glass, { height: GLASS }]} pointerEvents="none">
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          /*
           * The alpha channel, and the whole of the effect.
           *
           * Transparent at the top, opaque at the bottom: everything inside the
           * mask is invisible where this is clear and fully drawn where it is
           * solid. The colour is irrelevant — only the alpha is read — so it is
           * black for the sake of being obviously not a colour anybody chose.
           */
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']}
            locations={[RAMP, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView
          intensity={INTENSITY}
          // The one material that keeps the colour of what is behind it, which
          // is the difference between glass and frost.
          tint="systemUltraThinMaterial"
          style={StyleSheet.absoluteFill}
        />

        {/*
          The lights, each a slightly different thickness of glass.

          Faint — 0.05 at the strongest. The point is that neighbouring panes
          are not identical, not that anybody can name which is which; at the
          opacities where you could, it stops being a window and becomes
          stripes.
        */}
        <View style={styles.lights}>
          {LIGHTS.map((width, i) => (
            <View key={width} style={{ flex: width }}>
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor:
                      i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                  },
                ]}
              />
              {/* Between two panes, never around the outside of the window. */}
              {i > 0 && <View style={[styles.came, { backgroundColor: LEAD }]} />}
            </View>
          ))}
        </View>
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Pinned to the bottom of the cover, full width. */
  glass: { position: 'absolute', left: 0, right: 0, bottom: 0 },
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
