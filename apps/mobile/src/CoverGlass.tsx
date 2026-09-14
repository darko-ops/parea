/**
 * The album's cover, seen through glass.
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
 * ## Why this one is a single blur, when an earlier one could not be
 *
 * A previous version softened only the bottom forty points, and there a single
 * `BlurView` was useless: it is uniform and stops dead at its own edge, so it
 * drew a seam where it ended. That took a gradient mask to fix and was
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
 * ## It was leaded, and it is not any more
 *
 * There were five vertical lights of uneven width, each a slightly different
 * thickness of glass, with a dark came between them — the things that make
 * glass read as *stained* rather than merely frosted.
 *
 * Both came off, in that order, and for the same reason each time: they were
 * drawn for a forty-point band along the bottom edge and then carried over to a
 * header 196 points tall without their numbers being reconsidered. A 0.04 tint
 * is a texture across forty points and a column down two hundred. A 1.5pt line
 * is an implication at forty points and a rule at two hundred.
 *
 * The lesson is about scale rather than about leading, and it is worth leaving
 * here because the obvious way to improve this file is to put one of them back.
 * If that happens, the values have to be chosen against *this* height, looking
 * at it, rather than inherited from the thing this replaced.
 */

import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';

/**
 * How hard the glass blurs.
 *
 * High enough that a face is a shape rather than a face. Below about 50 the
 * photograph is still readable and the header is a photograph with something
 * wrong with it; far above this the colour flattens and it stops being obvious
 * there is anything behind the glass at all.
 */
const INTENSITY = 72;

export function CoverGlass() {
  return (
    <BlurView
      intensity={INTENSITY}
      tint="systemUltraThinMaterial"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}
