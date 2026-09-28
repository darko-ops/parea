/**
 * The cover of an album you cannot open: colour behind frosted glass.
 *
 * The lights come from `frostedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the web's `/u/<handle>` show the same pane for the same
 * album. See the note there for why the colour is invented rather than the
 * album's own cover blurred.
 *
 * Each light is a radial gradient that fades to nothing, which is the blur —
 * no blur view, because there is nothing behind the tile to blur. `none` for
 * the aspect ratio: a soft light stretched a little is still a soft light,
 * and it means the pane fills whatever tile it is given.
 */

import { frostedGlass } from '@parea/cards';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Glyph } from './Glyph';

const W = 160;
const H = 120;

export function FrostedGlass({ seed, style }: { seed: string; style?: StyleProp<ViewStyle> }) {
  const pane = useMemo(() => frostedGlass(seed), [seed]);
  const reach = Math.max(W, H);
  return (
    <View style={[style, styles.frame, { backgroundColor: pane.ground }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          {pane.lights.map((light, i) => (
            <RadialGradient
              key={i}
              id={`light-${i}`}
              cx={light.x * W}
              cy={light.y * H}
              r={light.r * reach}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={light.colour} />
              <Stop offset="0.35" stopColor={light.colour} stopOpacity={0.75} />
              <Stop offset="1" stopColor={light.colour} stopOpacity={0} />
            </RadialGradient>
          ))}
          {/* The frost: a milky sheen, brightest where the light catches it. */}
          <LinearGradient id="frost" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.38} />
            <Stop offset="0.6" stopColor="#fff" stopOpacity={0.16} />
            <Stop offset="1" stopColor="#fff" stopOpacity={0.26} />
          </LinearGradient>
        </Defs>
        {pane.lights.map((_, i) => (
          <Rect key={i} width={W} height={H} fill={`url(#light-${i})`} />
        ))}
        <Rect width={W} height={H} fill="url(#frost)" />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <View style={styles.roundel}>
          <Glyph name="locked" size={18} color="#fff" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* The pane's own edge, a hairline of light, so it reads as glass and not paint. */
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Frosted too: the padlock sits in a clearer patch of the same glass. */
  roundel: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
