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
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
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

/**
 * How many names the corner shows before it stops.
 *
 * A photograph everybody liked would otherwise put a column of twenty handles
 * up the left-hand side of it, which is a list covering the thing the list is
 * about. The rest are a count on the end.
 */
const VISIBLE_REACTIONS = 4;

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

  /*
   * What the tap did, before the server has said anything.
   *
   * A reaction used to wait on two round trips: the POST, and then a refresh
   * of the *entire* album feed — every photograph, the roster, the thread —
   * because that feed is where the counts live. Against a database in another
   * region that is most of a second in which nothing on screen changes, and
   * the pill was disabled for all of it. It felt broken because it was, in the
   * only sense that matters to somebody holding the phone.
   *
   * So the answer is drawn immediately and reconciled afterwards. The overlay
   * is what this device believes it has changed; the feed is still the truth,
   * and when it arrives it replaces this. A tap that the server refuses is
   * undone by that same arrival, which is why the catch does not need to put
   * anything back by hand.
   */
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  /*
   * The server's answer with this device's unconfirmed taps folded in.
   *
   * Yours are the only rows a tap can add or remove — you cannot react for
   * somebody else — so the overlay only ever touches rows marked `mine`, and
   * everybody else's stand untouched underneath it.
   */
  const reactions = useMemo(() => {
    if (pending.size === 0) return photo.reactions;
    const kept = photo.reactions.filter(
      (r) => !(r.mine && pending.get(r.emoji) === false),
    );
    const added = [...pending]
      .filter(([emoji, on]) => on && !photo.reactions.some((r) => r.mine && r.emoji === emoji))
      // Newest at the top, which is where the server would have put them.
      .map(([emoji]) => ({ emoji, name: 'You', mine: true }));
    return [...added, ...kept];
  }, [pending, photo.reactions]);

  const mine = useMemo(
    () => new Set(reactions.filter((r) => r.mine).map((r) => r.emoji)),
    [reactions],
  );

  const react = useCallback(
    async (emoji: string) => {
      const on = !mine.has(emoji);
      // Drawn now. Nothing below this line is waited on by the interface.
      setPending((was) => new Map(was).set(emoji, on));
      try {
        await api.reactToPhoto(photo.id, emoji);
      } catch {
        // Silent, and deliberately without a rollback: the refresh below is
        // the correction, and an alert over a photograph for a tap that did
        // not land is worse than the tap not landing.
      }
      /*
       * The feed, and only then the overlay comes off.
       *
       * Dropped in the same tick that the fresh counts arrive, so the pill
       * never flickers through the old answer on its way to the new one.
       */
      await onChanged();
      setPending((was) => {
        const next = new Map(was);
        next.delete(emoji);
        return next;
      });
    },
    [api, mine, onChanged, photo.id],
  );

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
            Who said something, bottom left. What you could say, bottom right.

            The two are different kinds of thing and they were one row of pills
            that conflated them: a pill reading "❤️ 3" was both a fact about
            other people and a control that changed your own answer, and the
            only way to tell which of the three was you was a border.

            Left is now a list of people — a handle and the emoji they left,
            newest at the bottom so the most recent sits closest to the corner
            and the column grows upward out of it. Right is the picker, and
            nothing else: every emoji in the set, in a column you scroll.
          */}
          <View style={styles.said} pointerEvents="box-none">
            {reactions.slice(0, VISIBLE_REACTIONS).reverse().map((r, i) => (
              <View key={`${r.name}-${r.emoji}-${i}`} style={styles.saidRow}>
                <Text style={[styles.saidWho, r.mine && styles.saidMine]} numberOfLines={1}>
                  {r.mine ? 'You' : r.name}
                </Text>
                <Text style={styles.saidEmoji}>{r.emoji}</Text>
              </View>
            ))}
            {reactions.length > VISIBLE_REACTIONS && (
              <Text style={styles.saidMore}>
                and {reactions.length - VISIBLE_REACTIONS} more
              </Text>
            )}
          </View>

          <View style={styles.picker} pointerEvents="box-none">
            {!canReact ? (
              <Text style={styles.why}>Sign in{'\n'}to react</Text>
            ) : (
              <ScrollView
                style={styles.pickerScroll}
                contentContainerStyle={styles.pickerInner}
                showsVerticalScrollIndicator={false}
              >
                {REACTIONS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => void react(emoji)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mine.has(emoji) }}
                    accessibilityLabel={
                      mine.has(emoji) ? `Take back ${emoji}` : `React ${emoji}`
                    }
                    style={({ pressed }) => [
                      styles.key,
                      // Yours is filled rather than outlined: at this size a
                      // 1pt border round an emoji is not a state anybody sees.
                      mine.has(emoji) && styles.keyMine,
                      { opacity: pressed ? 0.55 : 1 },
                    ]}
                  >
                    <Text style={styles.keyText}>{emoji}</Text>
                  </Pressable>
                ))}
              </ScrollView>
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
  /* Who reacted, bottom left. Room kept clear of the picker opposite. */
  said: { position: 'absolute', left: 16, right: 84, bottom: 44, gap: 6 },
  saidRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  /* A handle, without the `@` — this is a byline, not a mention. Shadowed
     rather than sat on a panel: a slab behind every name would cover more of
     the photograph than the names do. */
  saidWho: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 6,
    flexShrink: 1,
  },
  /* "You" rather than your own handle read back at you — the same call every
     card in this product makes. */
  saidMine: { color: 'rgba(255,255,255,0.85)' },
  saidEmoji: { fontSize: 15 },
  saidMore: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12.5,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 6,
  },

  /* The picker, bottom right: one column, scrolled. */
  picker: { position: 'absolute', right: 12, bottom: 44, alignItems: 'center' },
  /* Tall enough for four keys, so a fifth is visibly cut off and the column
     reads as something to scroll rather than as all there is. */
  pickerScroll: { maxHeight: 4 * 44 },
  pickerInner: { gap: 6, paddingVertical: 2, alignItems: 'center' },
  key: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(20,23,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Filled where it is yours. At 38pt a 1pt outline round an emoji is not a
     state anybody notices. */
  keyMine: { backgroundColor: 'rgba(255,255,255,0.28)' },
  keyText: { fontSize: 19 },
  why: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 6,
  },
});
