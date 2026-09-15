/**
 * The name, at the weight the font file does not have.
 *
 * Garet ships here as one face, Book, and its `usWeightClass` is 300 — which is
 * why the plain `<Text>` version read thin. There is no heavier cut to ask for.
 *
 * ## Why this is SVG rather than `fontWeight`
 *
 * Because synthetic bold is the wrong tool, and the web already worked that out
 * in `globals.css`: it smears the outlines horizontally and fills the counters
 * of a geometric face, which on a lowercase `a` and `e` is the first thing you
 * see — and "parea" has both, twice. A stroke grows the whole outline evenly,
 * which is much closer to what a heavier cut actually is.
 *
 * The web does that with `-webkit-text-stroke`. React Native has no equivalent
 * on a `<Text>`, and the two approximations available in plain RN are worse
 * than the problem: `fontWeight` is the smear, and a zero-offset `textShadow`
 * thickens by blurring, which at 32 points is a soft edge rather than a weight.
 * `react-native-svg` is already in this app for the glyphs and the mark, and
 * its `<Text>` takes a real `stroke` — the same operation the web performs, on
 * the same outlines.
 *
 * ## Kept in step with the web by hand
 *
 * `STROKE` is the web's `0.045em`, chosen there against this exact word at this
 * exact size — below it there is no difference in weight, above it the counters
 * begin to close. Expressed as a fraction of the size for the same reason it is
 * in `em` there: a stroke that looks right at 32 points is a blob at 13.
 *
 * If a real Garet Medium or Bold is ever licensed, both of these go away
 * together: the file is added, the weight is declared honestly, and this
 * becomes a `<Text>` again.
 */

import Svg, { Text as SvgText } from 'react-native-svg';

/** The web's `-webkit-text-stroke: 0.045em`, as a fraction of the font size. */
const STROKE = 0.045;

/**
 * How tall the box is, relative to the size.
 *
 * Garet's ascenders and the lowercase word's lack of descenders mean 1.3 is
 * comfortable without leaving a visible gap under the row.
 */
const LINE = 1.3;

/** Where the baseline sits inside that box. */
const BASELINE = 0.98;

export function Wordmark({
  color,
  size = 32,
  /**
   * How wide the box is.
   *
   * SVG has no intrinsic layout, so unlike a `<Text>` this cannot size itself
   * to its content — the box is given and the word is centred in it. Every
   * caller so far wants it centred in whatever the row leaves, which is what
   * the default does with a `flex: 1` parent.
   */
  width = '100%',
}: {
  color: string;
  size?: number;
  width?: number | string;
}) {
  return (
    <Svg
      width={width as number}
      height={size * LINE}
      // The accessible name is the proper noun, whatever the type does. The
      // same split the web makes with `text-transform`.
      accessibilityRole="header"
      accessibilityLabel="Parea"
    >
      <SvgText
        x="50%"
        y={size * BASELINE}
        textAnchor="middle"
        fontFamily="Garet-Book"
        fontSize={size}
        // The web's `-.02em`: the letters of a wordmark belong together.
        letterSpacing={-0.02 * size}
        fill={color}
        stroke={color}
        strokeWidth={STROKE * size}
      >
        parea
      </SvgText>
    </Svg>
  );
}
