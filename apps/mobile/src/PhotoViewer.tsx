/**
 * One photograph, on its own.
 *
 * What was here before was a sheet: a small picture at the top of a card with
 * a column of full-width buttons under it — "Remove my photo", "That's me —
 * take it down", "Report", "Block this person", "Close". Five slabs and a
 * thumbnail, on the screen whose entire subject is one photograph. You could
 * not see the picture you had tapped, and there was nothing to do with it
 * except report somebody.
 *
 * This is a viewer. The photograph fills the screen on black, pinch zooms into
 * it, and everything that was a slab is behind one `⋯` — the same glyph and
 * the same corner as the album's own settings, which is the shape this product
 * now uses for "everything else about this thing".
 *
 * ## The gesture
 *
 * Hand-written on `PanResponder`, for the reason `SwipeBack` gives at length:
 * this app has no gesture library and adding one is native code and a rebuild.
 * Two fingers scale, one finger pans once you are zoomed in, a double tap
 * toggles between fit and 2.5×, and a single tap takes the chrome away so the
 * picture is the only thing on the glass.
 *
 * `Animated.Value` has no public getter, so the committed transform is kept in
 * refs alongside it and maintained by listeners. That is the documented way to
 * read one, and the alternative — reading `_value` — is a private field that
 * has changed shape between React Native versions before.
 */

import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { REACTIONS, type Api, type FeedPhoto } from './api';
import type { GroupTheme } from './Groups';

/** As far in as a pinch will go. Beyond this a 2560px rendition is mush. */
const MAX_SCALE = 4;

/** Where a double tap lands, and where the second one comes back from. */
const TAP_SCALE = 2.5;

/** Two taps closer together than this are one gesture. */
const DOUBLE_TAP_MS = 280;

/** Farther than this and the finger was dragging, not tapping. */
const TAP_SLOP = 8;

const distance = (touches: { pageX: number; pageY: number }[]) => {
  const [a, b] = touches;
  return Math.hypot(a!.pageX - b!.pageX, a!.pageY - b!.pageY);
};

export function PhotoViewer({
  api,
  photo,
  t,
  canReact,
  onClose,
  onChanged,
  onOptions,
}: {
  api: Api;
  photo: FeedPhoto;
  t: GroupTheme;
  /** Whether this viewer may leave a reaction. The server's answer. */
  canReact: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** The `⋯`: remove, ask for it down, report, block. */
  onOptions: () => void;
}) {
  const { width, height } = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  /*
   * The committed transform, readable synchronously.
   *
   * The gesture has to know where it is starting from on every frame, and an
   * `Animated.Value` cannot be asked. Listeners keep these in step; they are
   * removed on unmount, because a listener on a value that outlives the
   * component is a leak that only shows up after a hundred photographs.
   */
  const now = useRef({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const s = scale.addListener(({ value }) => (now.current.scale = value));
    const p = pan.addListener(({ x, y }) => {
      now.current.x = x;
      now.current.y = y;
    });
    return () => {
      scale.removeListener(s);
      pan.removeListener(p);
    };
  }, [pan, scale]);

  /** What the gesture started from, set on the first move of each kind. */
  const from = useRef<{ scale: number; x: number; y: number; span: number } | null>(null);
  const lastTap = useRef(0);

  const [chrome, setChrome] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const settle = useCallback(
    (next: number) => {
      /*
       * Back to fit, and centred, whenever the picture is not zoomed.
       *
       * A photograph left at 1× but nudged off-centre is a viewer that does
       * not quite return to where it started, which reads as a bug long before
       * anybody works out what is wrong with it.
       */
      if (next <= 1) {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 0 }),
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 0 }),
        ]).start();
        return;
      }
      /*
       * Zoomed in: keep the picture's edges from leaving the screen.
       *
       * At scale `s` the image overhangs by half the extra width and height,
       * and anything beyond that is a pan into blank space with the photograph
       * off the side of the glass.
       */
      const overX = (width * (next - 1)) / 2;
      const overY = (height * (next - 1)) / 2;
      const x = Math.max(-overX, Math.min(now.current.x, overX));
      const y = Math.max(-overY, Math.min(now.current.y, overY));
      if (x !== now.current.x || y !== now.current.y) {
        Animated.spring(pan, { toValue: { x, y }, useNativeDriver: true, bounciness: 0 }).start();
      }
    },
    [height, pan, scale, width],
  );

  const zoomTo = useCallback(
    (next: number) => {
      Animated.parallel([
        Animated.spring(scale, { toValue: next, useNativeDriver: true, bounciness: 0 }),
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 0 }),
      ]).start();
    },
    [pan, scale],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        // The picture takes every touch on it: a tap is a gesture here too.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A second finger arriving mid-drag turns a pan into a pinch.
        onPanResponderGrant: () => {
          from.current = null;
        },
        onPanResponderMove: (evt, g) => {
          const touches = evt.nativeEvent.touches;

          if (touches.length >= 2) {
            const span = distance(touches as never);
            if (!from.current || from.current.span === 0) {
              from.current = { scale: now.current.scale, x: now.current.x, y: now.current.y, span };
              return;
            }
            const next = Math.max(
              1,
              Math.min(MAX_SCALE, (from.current.scale * span) / from.current.span),
            );
            scale.setValue(next);
            return;
          }

          // One finger only pans a picture that is bigger than the screen.
          // Otherwise the photograph slides around inside its own frame.
          if (now.current.scale <= 1) return;
          if (!from.current) {
            from.current = { scale: now.current.scale, x: now.current.x, y: now.current.y, span: 0 };
          }
          pan.setValue({ x: from.current.x + g.dx, y: from.current.y + g.dy });
        },
        onPanResponderRelease: (_evt, g) => {
          const moved = Math.hypot(g.dx, g.dy) > TAP_SLOP;
          from.current = null;

          if (!moved) {
            const at = Date.now();
            if (at - lastTap.current < DOUBLE_TAP_MS) {
              lastTap.current = 0;
              zoomTo(now.current.scale > 1 ? 1 : TAP_SCALE);
            } else {
              lastTap.current = at;
              // Only if no second tap follows. A single tap that hid the
              // chrome immediately would flash it on every double tap.
              setTimeout(() => {
                if (lastTap.current === at) setChrome((on) => !on);
              }, DOUBLE_TAP_MS);
            }
            return;
          }

          settle(now.current.scale);
        },
        onPanResponderTerminate: () => {
          from.current = null;
          settle(now.current.scale);
        },
      }),
    [pan, scale, settle, zoomTo],
  );

  const react = useCallback(
    async (emoji: string) => {
      if (busy) return;
      setBusy(emoji);
      try {
        await api.reactToPhoto(photo.id, emoji);
        await onChanged();
      } catch {
        // Silent. A reaction that did not take is a pill that did not light
        // up, which the next refresh corrects — and an alert over a
        // photograph for a failed tap is worse than the tap not landing.
      } finally {
        setBusy(null);
      }
    },
    [api, busy, onChanged, photo.id],
  );

  const mine = new Set(photo.reactions.filter((r) => r.mine).map((r) => r.emoji));

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.stage,
          { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }] },
        ]}
        {...responder.panHandlers}
      >
        <ExpoImage
          source={{ uri: photo.full }}
          style={styles.shot}
          // `contain`, never `cover`: this is the screen where the whole
          // photograph is the point, and cropping it to fill the glass is the
          // one thing a viewer must not do.
          contentFit="contain"
          transition={120}
        />
      </Animated.View>

      {chrome && (
        <>
          <View style={styles.top} pointerEvents="box-none">
            <Pressable
              onPress={onClose}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.round}
            >
              <Text style={styles.roundGlyph}>✕</Text>
            </Pressable>
            <Pressable
              onPress={onOptions}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Photo options"
              style={styles.round}
            >
              <Text style={styles.roundGlyph}>⋯</Text>
            </Pressable>
          </View>

          {/*
            The reactions, along the foot.

            Everything already left sits first, in the order the server sorted
            it, and the rest of the offered set follows — so the row reads as
            "what people said about this, and what else you could say" rather
            than as a keyboard. Yours are outlined, which is the same way the
            thread marks a pill you are part of.
          */}
          <View style={styles.foot} pointerEvents="box-none">
            <View style={styles.pills}>
              {photo.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => void react(r.emoji)}
                  disabled={!canReact || busy != null}
                  accessibilityRole="button"
                  accessibilityState={{ selected: r.mine }}
                  accessibilityLabel={`${r.emoji}, ${r.count}${r.mine ? ', including you' : ''}`}
                  style={({ pressed }) => [
                    styles.pill,
                    r.mine && styles.pillMine,
                    { opacity: pressed || busy === r.emoji ? 0.6 : 1 },
                  ]}
                >
                  <Text style={styles.pillText}>
                    {r.emoji} {r.count}
                  </Text>
                </Pressable>
              ))}

              {canReact &&
                REACTIONS.filter((emoji) => !mine.has(emoji))
                  .filter((emoji) => !photo.reactions.some((r) => r.emoji === emoji))
                  .map((emoji) => (
                    <Pressable
                      key={emoji}
                      onPress={() => void react(emoji)}
                      disabled={busy != null}
                      accessibilityRole="button"
                      accessibilityLabel={`React ${emoji}`}
                      style={({ pressed }) => [
                        styles.pill,
                        styles.pillEmpty,
                        { opacity: pressed || busy === emoji ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={styles.pillText}>{emoji}</Text>
                    </Pressable>
                  ))}

              {busy && <ActivityIndicator color="#fff" style={{ marginLeft: 4 }} />}
            </View>

            {!canReact && (
              <Text style={styles.why}>
                Reacting needs an account — looking does not.
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /* Black, not the theme's background. A photograph is judged against what is
     around it, and a light grey surround changes what the picture looks like. */
  root: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1 },
  shot: { width: '100%', height: '100%' },
  top: {
    position: 'absolute',
    top: 58,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  /* Dark discs rather than bare glyphs: white on white is invisible, and a
     photograph can be any colour at all under either corner. */
  round: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(20,23,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundGlyph: { color: '#fff', fontSize: 15, fontWeight: '600', lineHeight: 17 },
  foot: { position: 'absolute', left: 12, right: 12, bottom: 44, gap: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(20,23,28,0.55)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  /* Outlined where you are one of the people counted — the same way the
     thread marks a pill you are part of. */
  pillMine: { borderColor: '#fff' },
  /* One you have not left yet: the emoji alone, with no count to read. */
  pillEmpty: { backgroundColor: 'rgba(20,23,28,0.38)' },
  pillText: { color: '#fff', fontSize: 14 },
  why: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5 },
});
