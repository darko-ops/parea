/**
 * The cover of an album you cannot open: a window of coloured glass.
 *
 * The panes come from `stainedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the web's `/u/<handle>` draw the same window for the same
 * album. See the note there for why it is glass and not a dashed empty tile.
 *
 * `slice` rather than stretching, so the rose is cut by the tile's edge rather
 * than squashed into it. Each pane is filled with its colour's own radial
 * gradient — pale at the heart, deep at the lead — which is the light coming
 * through, and the thing that separates glass from a mosaic of flat tiles.
 */

import { GLASS_LEAD, GLASS_TONES, stainedGlass } from '@parea/cards';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Glyph } from './Glyph';

export function StainedGlass({ seed, style }: { seed: string; style?: StyleProp<ViewStyle> }) {
  const window = useMemo(() => stainedGlass(seed, 160, 120), [seed]);
  return (
    <View style={[style, styles.frame]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${window.width} ${window.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {GLASS_TONES.map((tone, i) => (
            <RadialGradient key={i} id={`pane-${i}`} cx="50%" cy="45%" r="65%">
              <Stop offset="0" stopColor={tone.heart} />
              <Stop offset="0.55" stopColor={tone.base} />
              <Stop offset="1" stopColor={tone.edge} />
            </RadialGradient>
          ))}
          {/* Light across the whole window from the upper left. */}
          <LinearGradient id="light" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.22} />
            <Stop offset="0.5" stopColor="#fff" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.2} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={window.width} height={window.height} fill={GLASS_LEAD} />
        {window.panes.map((pane, i) => (
          <Path
            key={i}
            d={pane.d}
            fill={`url(#pane-${pane.colour})`}
            stroke={GLASS_LEAD}
            strokeWidth={2.4}
            strokeLinejoin="round"
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
