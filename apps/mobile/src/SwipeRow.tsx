/**
 * A list row that slides left to show what can be done to it.
 *
 * The Chats tab's rows: swipe one left and Pin and Delete are behind it, the
 * way every conversation list on this phone works. Hand-written on
 * `PanResponder` for the reason `SwipeBack` gives — no gesture library, and
 * nothing native to rebuild.
 *
 * ## Sharing the finger
 *
 * The row sits in a vertical scroll view and is itself a button. It claims a
 * touch only once it is plainly sideways — leftward, or rightward on a row
 * already open — and through the capture phase, so the button under it does
 * not keep it. Up and down is never taken: that is the list scrolling. Once
 * claimed it is not handed back, so the list cannot take a swipe half done.
 *
 * ## One open at a time
 *
 * Whether a row is open is the caller's: it holds which one, so opening a
 * second closes the first, and a tap anywhere on the list can put it away.
 */

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Glyph, type GlyphName } from "./Glyph";

/** One button behind the row. */
export type SwipeAction = {
  label: string;
  glyph: GlyphName;
  /** The button's fill. */
  color: string;
  onPress: () => void;
};

/** Each button's width. Wide enough for "Delete" under its glyph. */
const ACTION = 76;

/** Sideways by this much, and more sideways than not, before it is a swipe. */
const SLOP = 10;

export function SwipeRow({
  actions,
  open,
  onOpen,
  onClose,
  background,
  inset = 0,
  children,
}: {
  actions: SwipeAction[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The row's own ground, which covers the buttons until it moves. */
  background: string;
  /**
   * The list's side padding. The row reaches out through it, so the buttons
   * meet the screen's edge, and pads its content back in by the same.
   */
  inset?: number;
  children: ReactNode;
}) {
  const width = ACTION * actions.length;
  const x = useRef(new Animated.Value(0)).current;
  /** Where the row was when this drag began. */
  const from = useRef(0);
  // The responder is made once; it reads these rather than stale props.
  const live = useRef({ open, onOpen, onClose, width });
  live.current = { open, onOpen, onClose, width };

  useEffect(() => {
    Animated.spring(x, {
      toValue: open ? -width : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [open, width, x]);

  const responder = useMemo(() => {
    const sideways = (dx: number, dy: number) =>
      Math.abs(dx) > SLOP &&
      Math.abs(dx) > Math.abs(dy) * 1.5 &&
      (dx < 0 || live.current.open);
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => sideways(g.dx, g.dy),
      onMoveShouldSetPanResponder: (_e, g) => sideways(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        x.stopAnimation((value) => {
          from.current = value;
        });
      },
      onPanResponderMove: (_e, g) => {
        const w = live.current.width;
        // Past fully open it drags at a third, so the end is felt.
        let next = from.current + g.dx;
        if (next < -w) next = -w + (next + w) / 3;
        x.setValue(Math.min(0, next));
      },
      onPanResponderRelease: (_e, g) => {
        const w = live.current.width;
        const at = from.current + g.dx;
        const opening = g.vx < -0.3 || (g.vx <= 0.3 && at < -w / 2);
        // Settle here as well as through `open`: if the answer is the state it
        // already had, the effect above will not run again.
        Animated.spring(x, {
          toValue: opening ? -w : 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 18,
        }).start();
        if (opening && !live.current.open) live.current.onOpen();
        if (!opening && live.current.open) live.current.onClose();
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, {
          toValue: live.current.open ? -live.current.width : 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    });
  }, [x]);

  return (
    <View style={[styles.wrap, { marginHorizontal: -inset }]}>
      {/* Behind the row, at its right-hand end. */}
      <View
        style={[styles.actions, { width }]}
        importantForAccessibility="no-hide-descendants"
      >
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: action.color, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Glyph name={action.glyph} size={20} color="#fff" />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      {/* VoiceOver cannot swipe: the caller puts the same actions on the row. */}
      <Animated.View
        style={{
          backgroundColor: background,
          paddingHorizontal: inset,
          transform: [{ translateX: x }],
        }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  actions: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: "row",
  },
  action: {
    width: ACTION,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionLabel: { color: "#fff", fontSize: 12.5, fontWeight: "600" },
});
