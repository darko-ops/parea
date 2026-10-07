/**
 * The app opening: the icon's field, and the mark assembling on it.
 *
 * From the design package (`parea-launch-mark.svg` and its background). The
 * three circles grow in one at a time — pink, blue, mint — settle inward and
 * hold, with the wordmark underneath; on a slow start the loop repeats until
 * the app is ready.
 *
 * ## Why it waits for the mark to settle
 *
 * A cold start that is ready in a quarter of a second would otherwise cut
 * away mid-arrival, which reads as a glitch rather than a launch. So this
 * holds until the circles have settled (1.68s) *and* the app is ready, then
 * fades — the same moment the native splash would have ended with a beat of
 * the brand, and never later than the app actually needs.
 *
 * ## What is not here
 *
 * The native splash, which shows before any JavaScript runs. It is set in
 * `app.json` and is part of the build, so it changes with the next store build
 * rather than over the air; until then a moment of the default splash comes
 * first.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FieldDefs, FieldRects, FIELD_BASE } from './MarkField';
import { LAUNCH_LOOP, launchFrame, markPath } from './markMotion';
import { useMotionClock } from './useMotionClock';
import { Wordmark } from './Wordmark';

/** When the circles have arrived and settled, in seconds. */
const SETTLED = 1.68;

export function Launch({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const { t, still } = useMotionClock();
  const fade = useRef(new Animated.Value(1)).current;
  const [leaving, setLeaving] = useState(false);

  // Settled is reached once and stays reached, whatever the loop does after.
  const settled = still || t >= SETTLED;
  useEffect(() => {
    if (!ready || !settled || leaving) return;
    setLeaving(true);
    Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => onDone());
  }, [fade, leaving, onDone, ready, settled]);

  /*
   * Once leaving, the mark stays as it is rather than looping on into its
   * shrink: what fades is the settled mark, not one disappearing twice.
   */
  const frame = still || leaving ? { spread: 1, scale: [1, 1, 1] as [number, number, number] } : launchFrame(t % LAUNCH_LOOP);

  // 150px on a 390px-wide screen, in proportion elsewhere.
  const mark = Math.round((width * 150) / 390);
  const word = Math.round((width * 30) / 390);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Opening Parea"
      pointerEvents={leaving ? 'none' : 'auto'}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox="0 0 1024 1024"
        preserveAspectRatio="xMidYMid slice"
      >
        <FieldDefs prefix="launch" />
        <FieldRects prefix="launch" />
      </Svg>
      <View style={styles.centre}>
        <Svg width={mark} height={mark} viewBox="0 0 1024 1024">
          <Path fill="#fff" fillRule="evenodd" d={markPath(frame.spread, frame.scale)} />
        </Svg>
        {/*
          18px from the bottom of the circles, not of the box: the mark sits in
          a 1024 box whose lowest circle ends at 798, so the box's own empty
          strip is taken back first.
        */}
        <View style={{ marginTop: 18 - ((1024 - 798) / 1024) * mark }} />
        <Wordmark color="#fff" size={word} width={width} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: FIELD_BASE, zIndex: 100 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
