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
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Api, FeedPhoto, Message } from './api';
import { EmojiPicker } from './Emoji';
import { Glyph } from './Glyph';
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

/** One row: a 22pt face and the gap under it. */
const SAID_ROW = 22;
const SAID_GAP = 6;

/**
 * How far a one-finger drag has to go before it means something.
 *
 * Only ever read at scale 1, where the picture fits and a drag has nothing else
 * to do — zoomed in, the same finger is panning and none of this applies.
 *
 * Generous, because both outcomes are large: one leaves the photograph and the
 * other opens a panel over it. A hair-trigger on either would fire on the
 * flick somebody uses to scroll the album behind it.
 */
const SWIPE = 90;

/**
 * And how fast counts as meaning it regardless of distance.
 *
 * A short quick flick is the same intention as a long slow drag, which is the
 * rule `SwipeBack` already follows for the same reason.
 */
const FLING = 0.7;

const distance = (touches: { pageX: number; pageY: number }[]) => {
  const [a, b] = touches;
  return Math.hypot(a!.pageX - b!.pageX, a!.pageY - b!.pageY);
};

export function PhotoViewer({
  api,
  eventId,
  photo,
  comments,
  t,
  canReact,
  canPost,
  onClose,
  onChanged,
  onOptions,
}: {
  api: Api;
  /** Which album, for posting a comment against this photograph. */
  eventId: string;
  photo: FeedPhoto;
  /**
   * What has been said about this photograph, oldest first.
   *
   * The event's own thread, filtered to this picture. Comments are not a second
   * kind of message and there is no second table: `event_message` has carried a
   * `photo_id` since the web let somebody reply to a photograph, and this is
   * the same rows read from the other end. A comment here is a line in the
   * album's conversation that happens to be about a picture.
   */
  comments: Message[];
  t: GroupTheme;
  /** Whether this viewer may leave a reaction. The server's answer. */
  canReact: boolean;
  /** Whether they may say something. The same answer, from the same place. */
  canPost: boolean;
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
  /**
   * Whether the comments are open.
   *
   * A panel over the photograph rather than a screen of its own: what somebody
   * is saying is about the picture, and a comment read without it in view is a
   * remark about nothing. It covers the lower half and the picture stays above.
   */
  const [talking, setTalking] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** The face: our own emoji grid, since the system will not lend us its one. */
  const [picking, setPicking] = useState(false);

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

          /*
           * At fit, one finger is a vertical gesture rather than a pan.
           *
           * There is nothing to pan — the picture is already inside the screen —
           * so this space was doing nothing, which is exactly why the two new
           * gestures live here and not on top of something. Zoomed in, the
           * branch below takes the finger back for panning and neither of them
           * can fire.
           *
           * The photograph follows the finger at a third of the distance. Not
           * for the animation: it is how somebody finds out the gesture exists,
           * and how they discover mid-drag which way they are going.
           */
          if (now.current.scale <= 1) {
            pan.setValue({ x: 0, y: g.dy / 3 });
            return;
          }
          if (!from.current) {
            from.current = { scale: now.current.scale, x: now.current.x, y: now.current.y, span: 0 };
          }
          pan.setValue({ x: from.current.x + g.dx, y: from.current.y + g.dy });
        },
        onPanResponderRelease: (_evt, g) => {
          const moved = Math.hypot(g.dx, g.dy) > TAP_SLOP;
          from.current = null;

          /*
           * Down leaves, up talks.
           *
           * It was the other way round, on the argument that each gesture
           * should move something in the direction it actually goes: the
           * comments are below, so pull them up; the album is behind, so push
           * the photograph away. That reasoning is sound and it loses, because
           * it is reasoning — and nobody reasons about a swipe.
           *
           * Every photo viewer on this phone dismisses downward, and every
           * sheet on it arrives from below when you pull up. Those are two
           * habits somebody already has, and a screen that inverts both to be
           * internally consistent is a screen where the first swipe does the
           * wrong thing to everybody who has ever used a phone.
           *
           * Vertical only: `dy` has to beat `dx`, or a diagonal flick past a
           * photograph closes it.
           */
          if (now.current.scale <= 1 && Math.abs(g.dy) > Math.abs(g.dx)) {
            const far = Math.abs(g.dy) > SWIPE;
            const flung = Math.abs(g.vy) > FLING;
            if (far || flung) {
              settle(1);
              if (g.dy > 0) onClose();
              else setTalking(true);
              return;
            }
          }

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
    [onClose, pan, scale, settle, zoomTo],
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
      /*
       * Reversed, because a `Map` iterates in insertion order and this list
       * reads newest first.
       *
       * With one reaction in flight it makes no difference, which is why this
       * was wrong and looked fine. Leave two — react, react again before the
       * first has come back — and the pair went in oldest-above-newest while
       * the server was about to answer newest-above-oldest. So the second
       * landed *below* the first and then swapped places a moment later, which
       * reads as the app changing its mind about what you just did.
       *
       * The rule is that an optimistic row goes exactly where the server would
       * have put it. Anywhere else is a correction somebody watches happen.
       */
      .reverse()
      .map(([emoji]) => ({ emoji, name: 'You', mine: true }));
    return [...added, ...kept];
  }, [pending, photo.reactions]);

  const mine = useMemo(
    () => new Set(reactions.filter((r) => r.mine).map((r) => r.emoji)),
    [reactions],
  );

  /*
   * Newest first, which is the order the server already sends.
   *
   * This was reversed, so the column grew upward out of the corner with the
   * most recent line closest to it. That was right while the list sat in the
   * bottom-left of the glass and had a corner to grow out of; above the comment
   * bar it is an ordinary list in an ordinary place, and an ordinary list reads
   * downward from the newest — the same way the album's own conversation does,
   * and everything else in the product.
   */
  const ordered = reactions;

  /**
   * Say something about this photograph.
   *
   * Into the album's own thread with the photo's id on it, which is what makes
   * it a comment — there is no second table and no second endpoint. Cleared and
   * closed optimistically, because the refresh below is what brings the line
   * back and a box that empties only once the server answers feels broken on a
   * train.
   */
  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.postMessage(eventId, body, photo.id);
      setDraft('');
      await onChanged();
    } catch {
      // The draft survives, which is the whole recovery: somebody who wrote a
      // sentence is not being asked to write it again.
    } finally {
      setSending(false);
    }
  }, [api, draft, eventId, onChanged, photo.id, sending]);

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
          {/*
            Newest at the bottom, older above it, and scrollable past four.

            This was the four newest shown oldest-first with "and N more"
            underneath — which put the overflow *below* the newest line, where it
            read as "there are newer ones I am not showing you", and made the
            whole column shift up a row every time somebody reacted. The window
            moved, so the names moved.

            Now the list is every reaction in order and the view is clamped to
            four rows: the most recent sits against the corner, anything older is
            above it, and the rest is up there to be scrolled to rather than
            summarised. Nothing moves when a reaction arrives except the list
            growing by one at the bottom.
          */}
          <View style={styles.said} pointerEvents="box-none">
            <ScrollView
              style={styles.saidScroll}
              contentContainerStyle={styles.saidInner}
              showsVerticalScrollIndicator={false}
            >
              {ordered.map((r, i) => (
                <View key={`${r.name}-${r.emoji}-${i}`} style={styles.saidRow}>
                  <Text style={styles.saidEmoji}>{r.emoji}</Text>
                  <Text style={[styles.saidWho, r.mine && styles.saidMine]} numberOfLines={1}>
                    {r.mine ? 'You' : r.name}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>

          {/*
            What has been said about this photograph, and a box to add to it.

            The composer is on the glass rather than inside the panel, because it
            is the thing somebody came to do and a comment box you have to open
            a panel to find is a comment box nobody uses. Pulling down opens the
            list above it; the box itself is always there.
          */}
          {!talking && (
            <View style={styles.bar} pointerEvents="box-none">
              {canPost && (
                <Pressable
                  onPress={() => setTalking(true)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    comments.length > 0
                      ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}, add yours`
                      : 'Add a comment'
                  }
                  style={styles.composerHint}
                >
                  <Text style={styles.composerHintText} numberOfLines={1}>
                    {comments.length > 0
                      ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} — add yours`
                      : 'Add a comment'}
                  </Text>
                </Pressable>
              )}

              {/*
                One face, and the whole keyboard behind it.

                This was a column of six emoji with a `⋯` under them, offered
                because a reaction should be one tap. The trouble is that six is
                not the set anybody wants: it is the set we guessed, and the
                seventh emoji somebody reaches for is the one they actually
                mean. A column of six guesses takes the right-hand side of
                somebody's photograph to save a press that only sometimes lands.

                So: one control, always the same shape, and the picker behind it
                is the one on their own phone with their own recents at the
                front of it. The frequent emoji are still one tap away — theirs
                rather than ours.
              */}
              {canReact ? (
                <Pressable
                  onPress={() => setPicking(true)}
                  accessibilityRole="button"
                  accessibilityLabel="React to this photo"
                  style={({ pressed }) => [styles.smiley, { opacity: pressed ? 0.55 : 1 }]}
                >
                  <Glyph name="face" size={22} color="#fff" />
                </Pressable>
              ) : (
                <Text style={styles.why}>Sign in{'\n'}to react</Text>
              )}
            </View>
          )}
        </>
      )}

      {talking && (
        <KeyboardAvoidingView
          style={styles.talk}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/*
            The picture stays visible above it. A comment read without the
            photograph in view is a remark about nothing.
          */}
          <Pressable style={styles.talkAway} onPress={() => setTalking(false)} />

          <View style={styles.talkPanel}>
            <View style={styles.talkGrip} />

            <ScrollView
              style={styles.talkScroll}
              contentContainerStyle={styles.talkInner}
              keyboardShouldPersistTaps="handled"
            >
              {comments.length === 0 ? (
                <Text style={styles.talkEmpty}>
                  Nothing said about this one yet.
                </Text>
              ) : (
                comments.map((message) => (
                  <View key={message.id} style={styles.talkRow}>
                    <Text style={styles.talkWho} numberOfLines={1}>
                      {message.author.mine ? 'You' : message.author.name}
                    </Text>
                    <Text style={styles.talkBody}>
                      {message.deleted ? 'Message deleted' : message.body}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>

            {canPost && (
              <View style={styles.talkBox}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Say something about this photo"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.talkInput}
                  multiline
                  autoFocus
                  accessibilityLabel="Say something about this photo"
                />
                <Pressable
                  onPress={() => void post()}
                  disabled={!draft.trim() || sending}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={({ pressed }) => [
                    styles.talkSend,
                    {
                      opacity: !draft.trim() || sending ? 0.4 : pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={styles.talkSendText}>{sending ? '…' : 'Send'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      )}

      {/*
        The picker, which is ours rather than the system's.

        The first version of this focused an invisible `TextInput` so the phone
        would open its emoji keyboard. It works and it opens *a* keyboard — the
        last panel somebody used, which is usually but not always the emoji one,
        and there is no public way to ask for that panel specifically. A grid of
        our own can only produce emoji, which is the requirement, and never puts
        a text field over somebody's photograph. See `Emoji.tsx` for what that
        costs.
      */}
      {picking && (
        <EmojiPicker
          t={t}
          onClose={() => setPicking(false)}
          onPick={(emoji) => {
            setPicking(false);
            void react(emoji);
          }}
        />
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
  /*
   * The comment box, on the glass rather than inside the panel.
   *
   * It is the thing somebody came here to do, and a box you have to open a
   * panel to find is a box nobody uses. Left of the reaction column, clear of
   * the names in the other corner.
   */
  /* The two of them on one line, so the list above has a single edge to sit
     over rather than two controls at different heights. */
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  composerHint: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(20,23,28,0.55)',
  },
  composerHintText: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  /* The panel covers the lower half; the photograph stays above it. */
  talk: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  talkAway: { flex: 1 },
  talkPanel: {
    maxHeight: '62%',
    backgroundColor: 'rgba(12,14,18,0.94)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
  },
  /* The handle a sheet has, so it reads as something that came up and can go
     back down. */
  talkGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 6,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  talkScroll: { flexGrow: 0 },
  talkInner: { paddingHorizontal: 18, paddingVertical: 8, gap: 12 },
  talkEmpty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, paddingVertical: 12 },
  talkRow: { gap: 2 },
  talkWho: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '600' },
  talkBody: { color: '#fff', fontSize: 15, lineHeight: 21 },
  talkBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  talkInput: {
    flex: 1,
    maxHeight: 120,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  talkSend: { paddingVertical: 10 },
  talkSendText: { color: '#6ea8fe', fontSize: 15, fontWeight: '700' },
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
  /*
   * Above the comment bar, not in a corner beside it.
   *
   * It was bottom-left with the picker column opposite, so the two halves of
   * "what people said" sat at either side of the glass with a gap of photograph
   * between them. One column now, over the box that adds to it, which is where
   * somebody looks when they are wondering what has been said.
   */
  said: { position: 'absolute', left: 16, right: 16, bottom: 88 },
  /* Exactly four rows tall, so a fifth is cut off and the column reads as
     something to scroll rather than as all there is. */
  saidScroll: { maxHeight: VISIBLE_REACTIONS * SAID_ROW + (VISIBLE_REACTIONS - 1) * SAID_GAP },
  /* `flex-end` so a list shorter than four rows sits against the bottom of the
     box rather than floating at the top of it. */
  /* Newest at the top, so the list starts where it starts. `flex-end` was for
     a column that grew out of a corner. */
  saidInner: { gap: SAID_GAP },
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

  /* The picker, bottom right: one column, scrolled. */
  /* The same disc as the two in the top corners, at the end of the bar. */
  smiley: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,23,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Tall enough for four keys, so a fifth is visibly cut off and the column
     reads as something to scroll rather than as all there is. */
  why: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 6,
  },
});
