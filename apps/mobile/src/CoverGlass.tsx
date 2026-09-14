/**
 * The album's cover, brightened and then put behind glass.
 *
 * The header used to be the photograph itself, which asks it to do two jobs at
 * once: be the picture of the evening, and be the surface four white words and
 * two buttons sit on. A photograph is bad at the second — a white tablecloth or
 * a bright sky and the title is gone — which is why there was a scrim over it
 * dark enough to be doing most of the work anyway.
 *
 * So the photograph is behind glass: present, coloured, recognisable as
 * *something*, and not legible as a picture. You can see there was an evening.
 * You cannot read it from here, which is what the album underneath is for.
 *
 * ## The colour comes first, and it has to
 *
 * Blurring averages neighbouring pixels, and averaging colour is exactly how
 * you make it grey — a blurred photograph is always duller than the photograph.
 * Saturating afterwards would be saturating the mush; saturating first gives
 * the blur livelier pixels to average, so what comes out the other side still
 * has the colour of the evening in it. Hence the order here: filter, then
 * blur, then the scrim.
 *
 * The filter is a `feColorMatrix` on an SVG image rather than anything native.
 * `react-native-svg` is already in this app for the glyphs and the wordmark and
 * ships the whole filter set, so this costs an import rather than a pod.
 *
 * ## "Vibrance", honestly
 *
 * What photo editors call vibrance boosts the colours that are *least*
 * saturated and leaves the ones that are already strong alone, which is what
 * stops skin going orange. A colour matrix cannot do that — it is linear, so it
 * multiplies everything equally, which is saturation.
 *
 * What is here is saturation plus a small lift in brightness, which through a
 * blur reads much the way vibrance does: the blur has already pulled the strong
 * colours toward the middle, so a linear boost lands hardest on exactly the
 * pixels vibrance would have targeted. It is the right effect by accident of
 * the order, not the right algorithm, and it is worth knowing which.
 *
 * ## Why the blur is a single view
 *
 * An earlier version softened only the bottom forty points, and there a single
 * `BlurView` was useless: it is uniform and stops dead at its own edge, so it
 * drew a seam where it ended. Covering the whole header has no such edge — the
 * blur ends where the header ends, which is a boundary the layout already has.
 * Uniform blur over a whole surface is the one thing `BlurView` is good at.
 *
 * `systemUltraThinMaterial` is the thinnest material iOS has: it blurs what is
 * behind it while keeping most of its colour. A `light` or `dark` tint washes
 * the photograph grey, which would undo the paragraph above.
 *
 * ## It was leaded, and it is not any more
 *
 * There were five vertical lights of uneven width, each a slightly different
 * thickness of glass, with a dark came between them. Both came off, in that
 * order, and for the same reason each time: they were drawn for a forty-point
 * band along the bottom edge and carried up to a header 196 points tall without
 * their numbers being reconsidered. A 0.04 tint is a texture across forty
 * points and a column down two hundred; a 1.5pt line is an implication at forty
 * points and a rule at two hundred.
 *
 * The lesson is about scale rather than about leading, and it is worth leaving
 * here because the obvious way to improve this file is to put one of them back.
 * If that happens, the values have to be chosen against *this* height, looking
 * at it, rather than inherited from the thing this replaced.
 */

import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  FeColorMatrix,
  FeComponentTransfer,
  FeFuncB,
  FeFuncG,
  FeFuncR,
  Filter,
  Image as SvgImage,
} from 'react-native-svg';

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
 * How much of the colour to put back, and a little more.
 *
 * 1 is the photograph as taken. This is chosen against what survives the blur
 * rather than against the original — at 1 the header is noticeably greyer than
 * the cover it is made from, which reads as the glass being dirty. Past about
 * 2 the colours stop belonging to the photograph and the header becomes a
 * gradient that happens to have been an evening.
 */
const SATURATION = 1.7;

/**
 * A small lift, so the glass reads as lit rather than as shaded.
 *
 * `slope` multiplies and `intercept` adds — the add is what lifts the shadows,
 * which is where a blurred photograph loses its life. Kept small: this sits
 * under a scrim that is already darkening the top and bottom for the sake of
 * the title, and a bright header under a dark scrim is a header with a band
 * across it.
 */
const SLOPE = 1.06;
const LIFT = 0.04;

export function CoverGlass({ uri }: { uri: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <Filter id="lit">
            {/*
              Saturate, then lift. The other order lifts the dull version and
              then saturates the lift, which brightens the grey rather than the
              colour.
            */}
            <FeColorMatrix type="saturate" values={String(SATURATION)} result="rich" />
            <FeComponentTransfer in="rich">
              <FeFuncR type="linear" slope={SLOPE} intercept={LIFT} />
              <FeFuncG type="linear" slope={SLOPE} intercept={LIFT} />
              <FeFuncB type="linear" slope={SLOPE} intercept={LIFT} />
            </FeComponentTransfer>
          </Filter>
        </Defs>

        {/*
          `slice` is SVG's word for `contentFit="cover"`: fill the box and crop
          the overflow, rather than fitting the whole picture inside it and
          leaving bars. The header is a band across the top of a phone and
          almost no photograph is that shape.
        */}
        <SvgImage
          href={{ uri }}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          filter="url(#lit)"
        />
      </Svg>

      <BlurView
        intensity={INTENSITY}
        tint="systemUltraThinMaterial"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
