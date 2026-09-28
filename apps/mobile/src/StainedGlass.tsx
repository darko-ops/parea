/**
 * The cover of an album you cannot open: a window of coloured glass.
 *
 * The panes come from `stainedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the web's `/u/<handle>` draw the same window for the same
 * album. See the note there for why it is glass and not a dashed empty tile.
 *
 * `slice` rather than stretching: the tile is wider than it is tall and the
 * panes should be cut by the frame, not squashed by it. The leading is a
 * non-scaling stroke so it is the same weight on every tile size.
 */

import { GLASS_LEAD, stainedGlass } from '@parea/cards';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';

import { Glyph } from './Glyph';

export function StainedGlass({ seed, style }: { seed: string; style?: StyleProp<ViewStyle> }) {
  const window = useMemo(() => stainedGlass(seed, 4, 3), [seed]);
  return (
    <View style={[style, styles.frame]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${window.width} ${window.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {/* Light coming through from the upper left, fading out by the far corner. */}
          <LinearGradient id="light" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.32} />
            <Stop offset="0.55" stopColor="#fff" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.18} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={window.width} height={window.height} fill={GLASS_LEAD} />
        {window.panes.map((pane, i) => (
          <Polygon
            key={i}
            points={pane.points}
            fill={pane.fill}
            fillOpacity={pane.opacity}
            stroke={GLASS_LEAD}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <Rect x={0} y={0} width={window.width} height={window.height} fill="url(#light)" />
      </Svg>
      {/* The padlock on a roundel of lead, so it reads over any colour. */}
      <View style={styles.center} pointerEvents="none">
        <View style={styles.roundel}>
          <Glyph name="locked" size={18} color="#fff" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: GLASS_LEAD },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  roundel: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(28, 24, 34, 0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
