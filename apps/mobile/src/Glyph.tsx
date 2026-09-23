/**
 * The product's glyphs, on a phone.
 *
 * The same drawings the web rail uses — `RailIcon.tsx` and `SearchIcon.tsx` —
 * rather than an icon set. Two reasons, and neither is taste: an icon package
 * is a font or a thousand paths for the six shapes this product draws, and a
 * borrowed set never quite matches the one the web already has, so the app and
 * the site end up with two different pictures of a group.
 *
 * Everything here is on a 24-unit grid at stroke width 2 with round caps and
 * joins, which is the convention `RailIcon` set and the only thing that makes
 * six drawings by different hands read as one family. The two strokes inside
 * the photo stack are four-fifths of that: they are a picture inside a frame,
 * and at the same weight as the frame the tile reads as a scribble at 20
 * points.
 *
 * `stroke` rather than `fill` throughout — these are line drawings, and a
 * filled variant for the selected state would be a second set to keep in step.
 * A selected glyph is the same drawing in a heavier stroke, which is what the
 * `weight` prop is for: one set of paths, and the tab bar asks for the bold
 * cut of it the way type asks for a bold cut of a face.
 */

import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type GlyphName =
  | 'photos'
  | 'bubble'
  | 'bubbles'
  | 'group'
  | 'profile'
  | 'search'
  | 'plus'
  | 'unlocked'
  | 'locked'
  | 'tray'
  | 'face'
  | 'share'
  | 'download'
  | 'trash'
  | 'door'
  | 'grid'
  | 'portrait'
  | 'star';

/**
 * One glyph, in one colour.
 *
 * `size` is the box, not the drawing: every path is authored in the 24-unit
 * grid and scaled by the viewBox, so a 22pt tab glyph and a 15pt padlock
 * beside a line of text are the same drawing at two sizes rather than two
 * drawings.
 *
 * `weight` is the stroke, and 2 is the family's own. Raising it is how the
 * selected tab is drawn — the same shape, said louder. It is deliberately a
 * number rather than a boolean: the two thin strokes inside the photo stack
 * are authored at 1.6 against a 2 frame, and they scale with the frame rather
 * than being pinned, so the picture inside the stack stays lighter than the
 * stack at every weight.
 */
/**
 * The star, as a path.
 *
 * Ten points: five out at 9.2 from the middle of the 24-unit frame, five in at
 * 0.382 of that, alternating, starting straight up. The inner ratio is the one
 * that makes a five-pointed star read as one — larger and it rounds into a
 * pentagon, smaller and it thins into a spider.
 *
 * Built here rather than written out so the numbers are the reasoning rather
 * than the output of it, and so the same shape is exact at every size.
 */
const STAR = (() => {
  const mid = 12;
  const outer = 9.2;
  const inner = outer * 0.382;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // Start at the top: a star with a point up is the only orientation
    // anybody reads as a star.
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(mid + r * Math.cos(angle)).toFixed(2)} ${(mid + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M ${points.join(' L ')} Z`;
})();

export function Glyph({
  name,
  size = 22,
  weight = 2,
  color,
  /**
   * Filled rather than outlined, for a glyph that is also a state.
   *
   * The family is strokes on nothing, which is right for every glyph that
   * names a place or an action. The star is the one that also answers a
   * question — kept, or not — and outline against solid is how that reads at
   * a glance, without a second colour or a badge.
   */
  filled = false,
}: {
  name: GlyphName;
  size?: number;
  weight?: number;
  color: string;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths(name, weight)}
    </Svg>
  );
}

/**
 * `weight` reaches here for the two strokes that are not the family's own: the
 * horizon and the sun inside the photo stack, drawn at four-fifths of the
 * frame so the tile reads as a stack rather than as a box full of lines. Held
 * as a ratio so that relationship survives the bold cut.
 */
function paths(name: GlyphName, weight: number) {
  const light = weight * 0.8;
  switch (name) {
    /*
      A photograph behind a photograph, which is what an event is — the frame
      is the stack and the picture inside it is the one on top. The horizon and
      the sun are drawn lighter than the frame so that the tile still reads as
      a stack rather than as a box full of lines.
    */
    case 'photos':
      return (
        <>
          <Rect x={8} y={4} width={12.5} height={12.5} rx={2} />
          <Path d="M16 20H5.5a2 2 0 0 1-2-2V8" />
          <Circle cx={12} cy={8} r={1.05} strokeWidth={light} />
          <Path d="M8.2 15.1l3.4-3.2 2.3 2.1 1.9-1.6 4.7 4.1" strokeWidth={light} />
        </>
      );
    /*
     * Two of them, overlapping: a conversation, which is what the Chats tab
     * holds and what a group's own button opens.
     *
     * It was a paper aeroplane. That is *send* — one message leaving for
     * somebody who is not in front of you — and neither of the two places it
     * sat sends anything: they open a room where talking is already going on.
     * Two bubbles say that without a verb.
     *
     * And the pair reads against the single bubble beside it in this file:
     * one is a remark about a thing, which is an album's comments; two is
     * people going back and forth, which is a chat. The distinction survives
     * at 22 points, which is the size it is drawn at and the size it was
     * checked at.
     */
    case 'bubbles':
      return (
        <>
          {/* Behind, and only the two sides of it that clear the front one.
              A whole second outline crossing the first reads as one lumpy
              shape at 22 points rather than as two bubbles — checked on a
              simulator beside the magnifier, which is the weight this has to
              match. */}
          <Path d="M9 2.5h10A2.5 2.5 0 0 1 21.5 5v5A2.5 2.5 0 0 1 19 12.5" />
          <Path d="M4 8h10a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 18H8l-4 3.5 1-3.5H4a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 4 8z" />
        </>
      );
    /*
     * Saying something about a photograph, which is a different verb from
     * sending one.
     *
     * An album's comments used to share the aeroplane with the Chats tab, on
     * the argument that one picture should mean one thing. It does — but the
     * thing it meant there was *send*, and a comment board is not a message
     * going anywhere. It sits under the photographs it is about.
     *
     * One path, drawn the way the rest of this family is: a rounded box on the
     * 24-unit grid with a tail off the bottom-left. The tail is what makes it
     * a bubble rather than a rounded rectangle, so it is generous — 4.5 units,
     * a fifth of the height — because at 22 points anything smaller closes up
     * into the box's own stroke.
     */
    case 'bubble':
      return (
        <Path d="M6 4h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6l-5 4.5 2-4.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" />
      );
    /* Lifted verbatim from the web rail: two figures, one of them behind. */
    case 'group':
      return (
        <>
          <Circle cx={9.5} cy={8.5} r={3.5} />
          <Path d="M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5" />
          <Path d="M16 5.4a3.5 3.5 0 0 1 0 6.2" />
          <Path d="M17.5 14.9c2.2.5 3.5 1.9 3.5 4.6" />
        </>
      );
    case 'profile':
      return (
        <>
          <Circle cx={12} cy={8} r={3.5} />
          <Path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
        </>
      );
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={7} />
          <Line x1={16.5} y1={16.5} x2={21} y2={21} />
        </>
      );
    case 'plus':
      return (
        <>
          <Line x1={12} y1={5} x2={12} y2={19} />
          <Line x1={5} y1={12} x2={19} y2={12} />
        </>
      );
    /*
      Who can see it, as a picture rather than a word.

      Open and closed are the same lock with the shackle moved, which is the
      whole of why this works at 15 points beside a line of type: the two
      states differ in one stroke and the difference is the meaning. A padlock
      that is merely absent on a public album would say nothing at all, and the
      open one is the reading somebody wants when they are about to send a link.
    */
    case 'unlocked':
      return (
        <>
          <Rect x={4.5} y={11} width={15} height={9.5} rx={2} />
          <Path d="M8 11V7.5a4 4 0 0 1 7.6-1.7" />
        </>
      );
    case 'locked':
      return (
        <>
          <Rect x={4.5} y={11} width={15} height={9.5} rx={2} />
          <Path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
        </>
      );

    /*
     * A face, for the control that opens the emoji picker.
     *
     * Drawn rather than set as an emoji. A 🙂 in the button is a *particular*
     * emoji sitting where a control should be — it reads as "react with this
     * one" rather than "choose one", and it changes shape between platforms
     * and font versions while every other control in this app is a 24-unit
     * stroke that does not.
     */
    case 'face':
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} />
          <Path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0" />
          <Path d="M9.3 9.6h.01" />
          <Path d="M14.7 9.6h.01" />
        </>
      );

    /*
     * A tray, because Lately is not only post.
     *
     * It was an envelope, and an envelope is one thing arriving addressed to
     * you. Half of what lands here is that — somebody asking you into an
     * album, asking to be friends — and the other half is not addressed to
     * anybody: photographs added to an album you are in, an answer to
     * something you asked. A tray is where all of it accumulates, which is
     * what this screen actually is.
     *
     * The web rail still draws an envelope for the same idea. That is drift,
     * and it is deliberate for now — the two clients already disagree about
     * where groups live, and one picture is the smaller of the two arguments.
     */
    case 'tray':
      return (
        <>
          <Path d="M3 13h5l1.5 2.5h5L16 13h5" />
          <Path d="M3 13 6 5h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
      );

    /*
     * The system share mark: a box you are lifting something out of.
     *
     * Deliberately the arrow-out-of-a-tray rather than the three linked dots.
     * On a phone this control opens the OS sheet, and this is the shape iOS
     * uses for that everywhere — a glyph somebody has to learn is a glyph that
     * has failed at the one job an icon has.
     */
    case 'share':
      return (
        <>
          <Path d="M12 3.5v11" />
          <Path d="M8.5 7 12 3.5 15.5 7" />
          <Path d="M6.5 11.5H5.5a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1" />
        </>
      );

    /* The same tray, receiving rather than giving: the arrow points in. */
    case 'download':
      return (
        <>
          <Path d="M12 3.5v11" />
          <Path d="M8.5 11 12 14.5 15.5 11" />
          <Path d="M4 15.5v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
        </>
      );

    case 'trash':
      return (
        <>
          <Path d="M4.5 6.5h15" />
          <Path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
          <Path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
        </>
      );

    /*
     * The two ways of looking at an album, as the shape each one makes.
     *
     * Not a camera and a filmstrip, or any other picture of what is inside:
     * both views hold the same photographs, and the only difference between
     * them is the layout. So each glyph is a small drawing of its own layout,
     * which is the rare case where the literal icon is also the right one —
     * somebody who has seen either view recognises its diagram immediately.
     *
     * Four squares rather than nine. Three across is what the grid actually
     * draws, and a 3×3 of squares at 18 points is nine shapes with a stroke
     * between them, which at this size is a texture rather than a grid. Two by
     * two says "tiled" with room for the corners to stay square.
     */
    case 'grid':
      return (
        <>
          <Rect x={4} y={4} width={7} height={7} rx={1.2} />
          <Rect x={13} y={4} width={7} height={7} rx={1.2} />
          <Rect x={4} y={13} width={7} height={7} rx={1.2} />
          <Rect x={13} y={13} width={7} height={7} rx={1.2} />
        </>
      );
    /*
     * One tall frame, which is what the other view gives a photograph: the
     * full width of the screen at 4:5, one at a time.
     *
     * Deliberately empty. The photo-stack glyph puts a horizon and a sun
     * inside its frame because it has to say "photographs" to somebody who has
     * not opened anything; this one sits beside that view's own pictures and
     * only has to say "this shape".
     */
    case 'portrait':
      return <Rect x={6.5} y={3} width={11} height={18} rx={1.6} />;

    /*
     * A five-pointed star, for keeping a photograph.
     *
     * The one glyph in the family that is drawn filled as well as outlined —
     * see `filled` — because it reports a state rather than naming an action.
     * Geometry rather than a font: a star is five points on one circle and
     * five on another at 0.382 of the radius, which is the proportion that
     * reads as a star rather than as a spiky blob, and it is the same at 16
     * points as at 40.
     */
    case 'star':
      return <Path d={STAR} />;

    /*
     * A door with a handle, for leaving. Not an arrow through a doorway, which
     * is the same picture as "sign out" in half the apps on a phone and means
     * something much larger than stepping out of one album.
     */
    case 'door':
      return (
        <>
          <Path d="M6 3.5h9a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" />
          <Circle cx={13} cy={12} r={1.1} />
          <Path d="M18.5 12H21" />
          <Path d="M19.6 10.2 21.4 12l-1.8 1.8" />
        </>
      );
  }
}
