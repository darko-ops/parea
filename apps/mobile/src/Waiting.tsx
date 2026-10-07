/**
 * What a screen shows while it is waiting: the mark, turning and breathing.
 *
 * It was `ActivityIndicator` — the system's grey ring — and then the mark
 * turning in one grey. This is the design package's slow-page spinner: the
 * mark turns once every 2.4s while its three circles drift apart to 1.75× their
 * spacing and back every 1.6s. On the light theme the icon's colour field shows
 * *through* the moving shape; on dark it is a white cutout.
 *
 * ## Only after 400ms
 *
 * Most waits are shorter than that, and a spinner that appears for a frame and
 * vanishes reads as a flicker rather than as loading. So nothing is drawn for
 * the first 400ms — the space is held, so nothing jumps when it does appear.
 *
 * ## Two clocks
 *
 * On dark the turn is a transform, run by `Animated` on the native thread so it
 * keeps going while JavaScript is busy with whatever this is waiting for. The
 * breath changes the shape itself, which no transform can express, so it is
 * redrawn from `useMotionClock`. On light the turn happens inside the mask, so
 * the field stays still behind it, and both come from the clock.
 *
 * ## Reduce Motion
 *
 * The mark, settled and not turning — rotation and spreading are exactly the
 * movement the setting exists to stop — fading gently in and out, so a long
 * wait still reads as alive rather than frozen.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { G, Mask, Path } from 'react-native-svg';

import { useAppearance } from './appearance';
import { FieldDefs, FieldRects } from './MarkField';
import { markPath, SPIN_TURN, spinnerFrame } from './markMotion';
import { useMotionClock } from './useMotionClock';

/** How long a wait has to last before it is shown at all. */
const DELAY_MS = 400;

export function Waiting({
  size = 34,
  /**
   * Take the rest of the screen, and sit in the middle of it.
   *
   * For the tabs, where this is one child of a scroll view underneath a title:
   * `flex: 1` against a content container that grows means "whatever is
   * left", which is the middle on any height of phone.
   */
  fill = false,
}: {
  size?: number;
  fill?: boolean;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={[styles.box, { minHeight: size, minWidth: size }, fill && styles.filling]}
      // The same thing `ActivityIndicator` announces, said out loud, from the
      // first frame — a screen reader should not wait 400ms to be told.
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessible
    >
      {shown && <Turning size={size} />}
    </View>
  );
}

function Turning({ size }: { size: number }) {
  // The theme, read here rather than threaded through every call site.
  const dark = useAppearance() === 'dark';
  const { t, still } = useMotionClock();
  const turn = useRef(new Animated.Value(0)).current;
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    if (still) {
      /*
       * A slow fade rather than nothing at all: two seconds of a completely
       * static logo is indistinguishable from a screen that has given up, and
       * a change in opacity is not the movement the setting is about.
       */
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(turn, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    // Light turns inside the mask instead; see below.
    if (!dark) return;
    turn.setValue(0);
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: SPIN_TURN * 1000,
        // Linear: a rotation that eases looks like it keeps stalling.
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [dark, still, turn]);

  const frame = still ? { turn: 0, spread: 1 } : spinnerFrame(t);
  const d = markPath(frame.spread, [1, 1, 1]);

  return (
    <Animated.View
      style={
        still
          ? { opacity: turn.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }
          : !dark
          ? undefined
          : {
              transform: [
                { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
              ],
            }
      }
    >
      <Svg width={size} height={size} viewBox="0 0 1024 1024">
        {dark ? (
          <Path fill="#fff" fillRule="evenodd" d={d} />
        ) : (
          <>
            <FieldDefs prefix={id} />
            <Mask id={`${id}-mark`} maskUnits="userSpaceOnUse" x={0} y={0} width={1024} height={1024}>
              {/*
                Turned here, not by the view: the field stays put and the
                mark moves over it, so the colour a circle carries changes as
                it goes round. Rotating the whole view would turn the field
                with it and lose that.
              */}
              <Path
                fill="#fff"
                fillRule="evenodd"
                d={d}
                rotation={frame.turn}
                originX={512}
                originY={532}
              />
            </Mask>
            <G mask={`url(#${id}-mark)`}>
              <FieldRects prefix={id} />
            </G>
          </>
        )}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  /* Paired with `flexGrow: 1` on the scroll's content container — without that
     there is no spare height for this to claim and it collapses to the mark. */
  filling: { flex: 1 },
});
