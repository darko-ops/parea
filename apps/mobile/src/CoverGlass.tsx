/**
 * The album's cover, seen through leaded glass.
 *
 * The header used to be the photograph itself, which asks it to do two jobs at
 * once: be the picture of the evening, and be the surface four white words and
 * two buttons sit on. A photograph is bad at the second — a white tablecloth or
 * a bright sky and the title is gone — which is why there was a scrim over it
 * dark enough to be doing most of the work anyway.
 *
 * So the photograph is behind glass now: present, coloured, recognisable as
 * *something*, and not legible as a picture. You can see there was an evening.
 * You cannot read it from here, which is what the album underneath is for.
 *
 * ## Why this one is a single blur, when the last one could not be
 *
 * An earlier version of this softened only the bottom forty points, and there a
 * single `BlurView` was useless: it is uniform and stops dead at its own edge,
 * so it drew a seam where it ended. That took a gradient mask to fix and was
 * eventually thrown away.
 *
 * Covering the whole header has no such edge. The blur ends where the header
 * ends, which is a boundary the layout already has — the page begins there.
 * Uniform blur over a whole surface is the one thing `BlurView` is good at, so
 * this is one view with no mask and no stack.
 *
 * ## Glass rather than frost
 *
 * `systemUltraThinMaterial` is the thinnest material iOS has: it blurs what is
 * behind it while keeping most of its colour. A `light` or `dark` tint washes
 * the photograph grey, and a grey header is not a photograph behind anything —
 * it is a grey header.
 *
 * ## What makes it stained
 *
 * The came: a dark hairline between vertical panes of uneven width. Uneven on
 * purpose — equal divisions read as a progress bar or a segmented control, both
 * of which this product has elsewhere and neither of which is a window. They
 * come from a fixed table rather than a random number, so an album draws the
 * same window every time it opens.
 *
 * The panes themselves are all the same glass. They briefly were not — a tint
 * of 0.04 either way, so neighbouring lights differed slightly — which is a
 * texture across a forty-point band and two dark columns down a header 196
 * points tall. Same numbers, different scale, completely different object.
 *
 * Tall panes are correct here in a way they were not in the band: a light
 * taller than it is wide is what a window is made of.
 */

import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';

/**
 * How hard the glass blurs.
 *
 * High enough that a face is a shape rather than a face. Below about 50 the
 * photograph is still readable and the header is a photograph with something
 * wrong with it; far above this the colour flattens and it stops being obvious
 * there is anything behind the glass at all.
 */
const INTENSITY = 72;

/**
 * The lights, as fractions of the width. Uneven, and they sum to 1.
 *
 * Five is enough to read as leaded and few enough that the came never becomes a
 * texture in its own right.
 */
const LIGHTS = [0.22, 0.16, 0.27, 0.14, 0.21];

/** The came between two lights. */
const LEAD = 'rgba(12,14,18,0.22)';

export function CoverGlass() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        intensity={INTENSITY}
        tint="systemUltraThinMaterial"
        style={StyleSheet.absoluteFill}
      />

      {/*
        The came, and nothing else.

        Each pane used to carry a faint tint as well — white on the odd ones,
        black on the even — on the theory that neighbouring lights are never
        quite the same glass. At 0.04 on a header 196 points tall that is not a
        suggestion of thickness, it is two dark columns down somebody's
        photograph, which is the first thing you see and the only thing you then
        look at.

        The scale is what changed, not the idea: the same values over a
        forty-point band were invisible. A tint is a texture at that height and
        a block at this one.

        The lead stays. A hairline between panes is a line, and a line cannot
        become a column.
      */}
      <View style={styles.lights}>
        {LIGHTS.map((width, i) => (
          <View key={width} style={{ flex: width }}>
            {/* Between two panes, never around the outside of the window. */}
            {i > 0 && <View style={[styles.came, { backgroundColor: LEAD }]} />}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
