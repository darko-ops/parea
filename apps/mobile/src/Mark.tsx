/**
 * The mark, on a phone: three photo sets from three people, overlapping into one.
 *
 * A fourth drawing of the same logo. The others are `apps/web/app/components/
 * Mark.tsx`, `apps/mobile/assets/icon.svg` and `apps/web/app/icon.svg`, and the
 * numbers below are *checked* against all of them by `brand.test.ts` — four
 * copies drifting apart is not something anybody notices until the app icon and
 * the website disagree in a screenshot, which had already happened once.
 *
 * Duplicated rather than shared, and that is the repository's existing call
 * rather than a new one: the other three copies are a React component and two
 * SVG files, which cannot import from each other either. A `@parea/brand`
 * package would hold one set of numbers, and is worth doing the day a fifth
 * copy appears; until then the test is what keeps them honest.
 *
 * Drawn with `react-native-svg`, which arrived with the glyphs — so this costs
 * no new dependency. Same reasoning as the web's inline SVG over an `<img>`:
 * it is ten numbers rather than a request, and a mark that renders with the
 * first frame never flashes.
 */

import { useId } from 'react';
import Svg, { Circle, ClipPath, Defs, G } from 'react-native-svg';

/**
 * Radius and centre offset, the only two numbers the shape depends on.
 *
 * The ratio is 0.66, and `brand.test.ts` asserts it: bigger circles put more
 * colour on the screen, and the tighter ratio makes the centre triangle — the
 * part carrying the meaning — a shape you can still see at 16 points rather
 * than a sliver between three discs.
 */
export const MARK_R = 200;
export const MARK_CENTRES = [
  { cx: 512, cy: 400 },
  { cx: 398, cy: 598 },
  { cx: 626, cy: 598 },
] as const;

/**
 * Seven regions, seven fills: three circles, three lenses, and the middle.
 *
 * Painted as explicit regions rather than produced by a blend mode. No alpha
 * anywhere — transparency would decide those four colours for us, and multiply
 * in particular turns the pink-over-mint lens into a muddy neutral, which is
 * the one place the design wants warmth.
 *
 * Not the avatar lens palette, which happens to share three values and is a
 * separate decision: those are stand-ins for people without a picture.
 */
export const MARK_FILLS = {
  pink: '#ffa6ad',
  blue: '#99b1fa',
  mint: '#9cdec5',
  pinkOnBlue: '#cb96e1',
  pinkOnMint: '#fbb277',
  blueOnMint: '#61b8c9',
  /** Everyone was there. The subject of the whole mark. */
  centre: '#a16eb9',
} as const;

/**
 * The same seven regions in white, for drawing on the product's own surface.
 *
 * Not a second logo: the geometry is `MARK_CENTRES` and `MARK_R` exactly as
 * the coloured one, and `brand.test.ts` still pins those against the other
 * three copies. What changes is that the regions are told apart by how much
 * white they carry rather than by hue.
 *
 * They have to be told apart by *something*, and that is the whole reason
 * this is a ramp rather than one flat fill. The three circles sit on an
 * equilateral arrangement, so their union is unchanged by a third of a turn —
 * a solid white silhouette rotating is a solid white silhouette, and the
 * spinner stops reading as motion at all. The lenses are what makes the turn
 * visible, and here they are the only thing that does.
 *
 * Alpha, which the coloured mark refuses for good reason: there, letting
 * transparency decide four of the seven values is how the pink-over-mint lens
 * becomes a muddy neutral. Here there is one colour and alpha is the axis.
 */
const MARK_WHITE = {
  /** One person. Present, and the quietest thing on the mark. */
  alone: 0.38,
  /** Two of them at the same evening. */
  pair: 0.64,
  /** Everyone was there — the subject of the whole mark, and the brightest. */
  centre: 1,
} as const;

export function Mark({
  size = 22,
  /**
   * White throughout, for a surface that has already chosen its colours.
   *
   * The spinner asks for this: it is drawn over the app's own background on
   * eleven screens, and three brand colours turning in the middle of somebody
   * else's photographs is the mark competing with the thing it is waiting for.
   */
  mono = false,
}: {
  size?: number;
  mono?: boolean;
}) {
  const [pink, blue, mint] = MARK_CENTRES;
  const fill = mono
    ? {
        pink: '#fff',
        blue: '#fff',
        mint: '#fff',
        pinkOnBlue: '#fff',
        pinkOnMint: '#fff',
        blueOnMint: '#fff',
        centre: '#fff',
      }
    : MARK_FILLS;
  const alpha = mono
    ? {
        pink: MARK_WHITE.alone,
        blue: MARK_WHITE.alone,
        mint: MARK_WHITE.alone,
        pinkOnBlue: MARK_WHITE.pair,
        pinkOnMint: MARK_WHITE.pair,
        blueOnMint: MARK_WHITE.pair,
        centre: MARK_WHITE.centre,
      }
    : {
        pink: 1,
        blue: 1,
        mint: 1,
        pinkOnBlue: 1,
        pinkOnMint: 1,
        blueOnMint: 1,
        centre: 1,
      };
  /*
   * Ids unique to this instance.
   *
   * `react-native-svg` resolves `clipPath` references against a registry that
   * is not per-`Svg` on every platform, so two marks mounted at once with the
   * same ids can clip against each other's circles — which shows up as one of
   * them losing its overlaps and nothing else. The web copy can hard-code its
   * ids because a document really does scope them.
   */
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      // Decorative wherever it is drawn beside the word, and labelled by
      // whatever wraps it where it is not — see `Waiting`.
      accessible={false}
    >
      <Defs>
        <ClipPath id={`${id}-blue`}>
          <Circle cx={blue.cx} cy={blue.cy} r={MARK_R} />
        </ClipPath>
        <ClipPath id={`${id}-mint`}>
          <Circle cx={mint.cx} cy={mint.cy} r={MARK_R} />
        </ClipPath>
      </Defs>

      <Circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={fill.pink} fillOpacity={alpha.pink} />
      <Circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill={fill.blue} fillOpacity={alpha.blue} />
      <Circle cx={mint.cx} cy={mint.cy} r={MARK_R} fill={fill.mint} fillOpacity={alpha.mint} />

      <G clipPath={`url(#${id}-blue)`}>
        <Circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={fill.pinkOnBlue} fillOpacity={alpha.pinkOnBlue} />
      </G>
      <G clipPath={`url(#${id}-mint)`}>
        <Circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={fill.pinkOnMint} fillOpacity={alpha.pinkOnMint} />
      </G>
      <G clipPath={`url(#${id}-mint)`}>
        <Circle cx={blue.cx} cy={blue.cy} r={MARK_R} fill={fill.blueOnMint} fillOpacity={alpha.blueOnMint} />
      </G>

      {/* Everyone was there. Drawn last because the three lenses above each
          cover this region on their way past. */}
      <G clipPath={`url(#${id}-blue)`}>
        <G clipPath={`url(#${id}-mint)`}>
          <Circle cx={pink.cx} cy={pink.cy} r={MARK_R} fill={fill.centre} fillOpacity={alpha.centre} />
        </G>
      </G>
    </Svg>
  );
}
