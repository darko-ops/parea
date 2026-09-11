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
 * the photo stack are 1.6: they are a picture inside a frame, and at the same
 * weight as the frame the tile reads as a scribble at 20 points.
 *
 * `stroke` rather than `fill` throughout — these are line drawings, and a
 * filled variant for the selected state would be a second set to keep in step.
 * Selection is said in colour, which is what the tab bar already does.
 */

import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type GlyphName =
  | 'photos'
  | 'plane'
  | 'group'
  | 'profile'
  | 'search'
  | 'plus'
  | 'unlocked'
  | 'locked';

/**
 * One glyph, in one colour.
 *
 * `size` is the box, not the drawing: every path is authored in the 24-unit
 * grid and scaled by the viewBox, so a 22pt tab glyph and a 15pt padlock
 * beside a line of text are the same drawing at two sizes rather than two
 * drawings.
 */
export function Glyph({
  name,
  size = 22,
  color,
}: {
  name: GlyphName;
  size?: number;
  color: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths(name)}
    </Svg>
  );
}

function paths(name: GlyphName) {
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
          <Circle cx={12} cy={8} r={1.05} strokeWidth={1.6} />
          <Path d="M8.2 15.1l3.4-3.2 2.3 2.1 1.9-1.6 4.7 4.1" strokeWidth={1.6} />
        </>
      );
    /* Saying something, rather than a speech bubble: the bubble is what an
       unread count sits on everywhere else, and this glyph carries one. */
    case 'plane':
      return (
        <>
          <Path d="M21 3 3.5 9.8l7 2.7 2.7 7z" />
          <Path d="M21 3 10.5 12.5" />
        </>
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
  }
}
