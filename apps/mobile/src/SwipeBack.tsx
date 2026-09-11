/**
 * Dragging a pushed screen off to the right to go back.
 *
 * Every screen this app pushes has a back arrow in its top-left corner, and on
 * a phone that corner is the one place a thumb holding the device cannot
 * reach. iOS answers this with an edge swipe on every screen in the system,
 * which is why people try it here first and then go looking for the arrow.
 *
 * ## Why this is hand-written
 *
 * The usual answer is a navigation library, and this app deliberately has no
 * navigation stack — `Route` is one piece of state and there are five screens
 * that can sit on top of the tabs. Pulling in a navigator to get one gesture
 * would mean rewriting how every screen is reached. The gesture itself is
 * `PanResponder` and `Animated`, both of which are in React Native already, so
 * this adds no native dependency and needs no rebuild to land.
 *
 * ## Only from the edge
 *
 * The gesture is claimed only when the finger *starts* within `EDGE` points of
 * the left side. That is the iOS convention, and here it is also what keeps
 * the gesture from fighting the lists it sits on top of: the photo grid, the
 * roster and the inverted thread are all scrollers, and a swipe-back that
 * triggered anywhere would steal from them. `onMoveShouldSetPanResponder`
 * fires after the touch has moved, so the start is reconstructed as "where the
 * finger is now, minus how far it has travelled".
 *
 * The capture variant is used rather than the bubbling one because a scroll
 * view underneath would otherwise claim the touch first and never give it
 * back. The conditions are strict enough — near the edge, moving right, and
 * more sideways than up — that a vertical scroll is never taken by mistake.
 */

import { useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

/** How far in from the left a drag has to start. The iOS gutter is about this. */
const EDGE = 36;

/** Sideways travel before the gesture is taken seriously at all. */
const SLOP = 8;

/**
 * How much more sideways than vertical a drag has to be.
 *
 * A diagonal is usually somebody scrolling a list with their thumb, and the
 * list should win those.
 */
const DOMINANCE = 1.4;

/** Past this fraction of the screen, letting go goes back rather than snapping. */
const COMMIT = 0.32;

/** Or a flick: fast enough to the right counts however far it got. */
const FLING = 0.35;

export function SwipeBack({
  onBack,
  enabled = true,
  children,
}: {
  /** Where the back arrow in the corner goes. The gesture is a second way in. */
  onBack: () => void;
  /**
   * Off while the screen cannot be left — a sheet is up, or something is
   * mid-flight. The arrow is usually hidden in those moments too.
   */
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;

  /*
   * `enabled` is read through a ref rather than closed over.
   *
   * `PanResponder.create` runs once — rebuilding it on every render would hand
   * a fresh responder to the view mid-gesture and drop the drag in progress —
   * so the handlers have to read the current value rather than the one that
   * was true when they were made.
   */
  const live = useRef(enabled);
  live.current = enabled;

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Taps are not this gesture's business; they belong to whatever was
        // pressed. Only a move can start a drag.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (evt, g) => {
          if (!live.current) return false;
          const startX = evt.nativeEvent.pageX - g.dx;
          return (
            startX <= EDGE &&
            g.dx > SLOP &&
            g.dx > Math.abs(g.dy) * DOMINANCE
          );
        },
        onPanResponderMove: (_evt, g) => {
          // Never past the right edge, and never backwards past home: dragging
          // left from the gutter should do nothing rather than lift the screen
          // off its own left side.
          x.setValue(Math.max(0, Math.min(g.dx, width)));
        },
        // Something above took over mid-drag. Put the screen back.
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
        onPanResponderRelease: (_evt, g) => {
          const far = g.dx > width * COMMIT;
          const flung = g.vx > FLING;
          if (far || flung) {
            /*
             * Out to the right and *then* back. The route change is what
             * actually unmounts this, and doing it while the screen is still
             * under the finger shows the next screen sliding in from nowhere.
             * Resetting after the callback leaves the value at rest for the
             * next screen that mounts with this wrapper.
             */
            Animated.timing(x, {
              toValue: width,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              onBackRef.current();
              x.setValue(0);
            });
          } else {
            Animated.spring(x, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
          }
        },
      }),
    [width, x],
  );

  return (
    <Animated.View
      style={[styles.fill, { transform: [{ translateX: x }] }]}
      {...responder.panHandlers}
    >
      {children}
      {/*
        The shadow the moving screen casts on whatever is behind it, drawn on
        its own left edge rather than as a real shadow: `elevation` and
        `shadowOffset` both cost a re-render per frame on a view that is being
        animated on the native thread, and this is four pixels of gradient that
        nobody looks at directly.
      */}
      <View pointerEvents="none" style={styles.edge} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  edge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -4,
    width: 4,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
});
