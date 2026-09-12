/**
 * What a screen shows while it is waiting: the mark, turning.
 *
 * It was `ActivityIndicator` — the system's grey ring — on eleven screens. That
 * is the right control in a button, where it reads as "this press is working",
 * and the wrong one filling a screen, where what somebody is looking at is the
 * product failing to appear. The mark turning is the same information and says
 * whose app is thinking about it.
 *
 * ## Why it is not a GIF or a Lottie file
 *
 * One rotation of something already drawn. `Animated` runs the transform on the
 * native thread, so it does not stutter while the JavaScript thread is busy
 * parsing the response it is waiting for — which is exactly when this is on
 * screen, and exactly when a JS-driven animation would hitch.
 *
 * ## Reduce Motion
 *
 * Somebody who has asked the system to stop animating things gets the mark
 * standing still. A spinner is the one case where that seems to lose
 * information, and it does not: the mark being there *is* the message, and
 * sustained rotation is precisely the kind of movement the setting exists to
 * stop. It fades instead, gently enough to stay under the threshold the
 * setting is about.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { Mark } from './Mark';

/**
 * One turn, in milliseconds.
 *
 * Slower than the system ring on purpose. The mark is a shape rather than a
 * smear of grey — three circles and the triangle between them — and above about
 * one revolution a second it stops being a logo and becomes a flicker.
 */
const TURN_MS = 1400;

export function Waiting({
  size = 34,
  /**
   * Take the rest of the screen, and sit in the middle of it.
   *
   * For the tabs, where this is one child of a scroll view underneath a title.
   * Padding was the first attempt and it was the wrong tool: a fixed amount of
   * room below the header puts the mark a fixed distance down the page, which
   * on a tall phone is nowhere near the middle. `flex: 1` against a content
   * container that grows means "whatever is left", which is the thing actually
   * being asked for — and it costs nothing once the list has content, because
   * there is no room left to take.
   *
   * The screens that are *only* this already centre themselves through their
   * own `styles.center`, and do not need it.
   */
  fill = false,
}: {
  size?: number;
  fill?: boolean;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (live) setStill(on);
    });
    // The setting can change while the app is open, and a spinner that is on
    // screen for four seconds is long enough for somebody to go and change it.
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);

  useEffect(() => {
    if (still) {
      /*
       * A slow fade rather than nothing at all.
       *
       * Two seconds of a completely static logo is indistinguishable from a
       * screen that has given up. This is under the rate Reduce Motion is
       * about — it is a change in opacity, not movement across the screen —
       * and it still says the app is alive.
       */
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(spin, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(spin, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }

    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: TURN_MS,
        // Linear, because a rotation that eases is a rotation that looks like
        // it keeps stalling.
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, still]);

  return (
    <View
      style={[styles.box, fill && styles.filling]}
      /*
       * The same thing `ActivityIndicator` announces, said out loud.
       *
       * A rotating picture tells a screen reader nothing on its own, and this
       * replaced a control that had the meaning built in — so the role and the
       * label are the part that cannot be dropped in the swap.
       */
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      accessible
    >
      <Animated.View
        style={
          still
            ? { opacity: spin.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }
            : {
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              }
        }
      >
        <Mark size={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  /* Paired with `flexGrow: 1` on the scroll's content container — without that
     there is no spare height for this to claim and it collapses to the mark. */
  filling: { flex: 1 },
});
