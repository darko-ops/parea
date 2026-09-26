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
  FlatList,
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

import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import type { Api, FeedPhoto, Message } from './api';
import { EmojiPicker } from './Emoji';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { ThreadRow } from './Thread';

/**
 * The album's own colours, restated for glass.
 *
 * The sheet of comments over a photograph draws the same rows the album's
 * board draws — same component, so the only thing that can differ is the
 * palette it is handed. It cannot be the page's: this sits on a dark panel
 * over somebody's picture, where `fg` is white and a hairline is a little
 * light rather than a little dark.
 *
 * `accent` is the blue the rest of this screen already uses on glass, which
 * is a lighter cut than the product's own — the accent that reads on a white
 * page is a navy on this panel, and a mention set in it would be a word you
 * cannot see. `onAccent` goes dark to answer it.
 */
const GLASS: GroupTheme = {
  bg: 'rgba(12,14,18,0.94)',
  fg: '#ffffff',
  dim: 'rgba(255,255,255,0.55)',
  card: 'rgba(255,255,255,0.08)',
  line: 'rgba(255,255,255,0.18)',
  accent: '#6ea8fe',
  onAccent: '#0b1220',
  /* The mark's aqua, as everywhere else. Nothing on this panel draws an unread
     mark today — the palette is complete because the type is, and the day a
     count appears on the board it should be the same colour it is on every
     other screen rather than whatever this file happened to leave out. */
  news: '#61b8c9',
  onNews: '#07272e',
  said: '#ffa6ad',
  warn: '#ff8080',
  bgClear: 'rgba(12,14,18,0)',
};

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


/**
 * One photograph in the pager, with its own zoom.
 *
 * A component per page rather than one gesture over a moving row, and that is
 * the fix for a flash that three attempts could not remove.
 *
 * The row was three photographs wide and had to be put back to centre every
 * time the middle one changed. Centring is an offset and changing the picture
 * is a React commit, and those cross to the native side on different
 * schedules — so one frame always showed the pair out of step. Whichever way
 * it was ordered, something wrong was drawn for a frame: the photograph just
 * left, sitting centred under the new window, was the one people saw.
 *
 * A horizontal pager has no such moment. The list of photographs does not
 * move relative to itself and nothing is ever re-centred; the only thing that
 * changes is the scroll offset, which the platform owns end to end. Landing
 * on a page is not an event this code has to synchronise with anything.
 *
 * What it costs is that the gesture has to share. The pager wants horizontal
 * drags and this wants everything else, so the responder claims a move only
 * when it is vertical or when the picture is zoomed — and taps come through a
 * `Pressable` rather than through the responder, because claiming on touch
 * down is what stops a scroll view scrolling at all.
 */
function Page({
  photo,
  width,
  height,
  onClose,
  onTalk,
  onChrome,
  onZoomed,
}: {
  photo: FeedPhoto;
  width: number;
  height: number;
  onClose: () => void;
  /** Up, at fit: the comments about this photograph. */
  onTalk: () => void;
  /** A single tap: the glass, with nothing on it. */
  onChrome: () => void;
  /** Whether this page is magnified, which is what stops the pager paging. */
  onZoomed: (zoomed: boolean) => void;
}) {
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
  /** The last thing the pager was told, so it is told only on a change. */
  const told = useRef(false);
  useEffect(() => {
    const s = scale.addListener(({ value }) => {
      now.current.scale = value;
      // A `setState` per animation frame would re-render the viewer for every
      // frame of every pinch. The pager only cares which side of 1× this is.
      const zoomed = value > 1;
      if (zoomed !== told.current) {
        told.current = zoomed;
        onZoomed(zoomed);
      }
    });
    const p = pan.addListener(({ x, y }) => {
      now.current.x = x;
      now.current.y = y;
    });
    return () => {
      scale.removeListener(s);
      pan.removeListener(p);
    };
  }, [onZoomed, pan, scale]);

  /** What the gesture started from, set on the first move of each kind. */
  const from = useRef<{ scale: number; x: number; y: number; span: number } | null>(null);
  const lastTap = useRef(0);

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
        /*
         * The picture takes every touch on it, and gives it up when asked.
         *
         * Declining the touch on the way down was the obvious way to leave
         * the pager able to page, and it cost every gesture that is not a
         * page: a responder that never claims never receives a release, so
         * there were no taps, and a `Pressable` put over the top to catch
         * them claimed the touch itself and starved this of the rest.
         *
         * So this claims, as it always did, and the negotiation moves to
         * `onPanResponderTerminationRequest` below — which is the mechanism
         * for exactly this: a gesture living inside something that scrolls.
         */
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        /*
         * Hand it over unless this finger is going up or down.
         *
         * Two reasons to refuse, and the second one cost the swipe that
         * closes the viewer.
         *
         * Magnified, the finger is panning inside the picture and handing it
         * over would throw the album sideways instead. `scrollEnabled` says
         * the same from the other end; this is the half that cannot be a
         * frame of stale state behind.
         *
         * And vertical, at any scale. A horizontal scroll view on iOS has no
         * directional lock — its recogniser begins on a downward drag as
         * readily as a sideways one — so it asked for the touch, this said
         * yes, and the gesture ended in `onPanResponderTerminate` instead of
         * in a release. Terminate settles the picture and nothing else, so
         * swiping down moved the photograph and put it back rather than
         * leaving.
         *
         * Phrased as "give it up unless", so the default stays the one that
         * works: at the start of a drag neither axis has won yet, the pager
         * asks, and it gets the touch. Only a finger that has committed to
         * the vertical — past the same slop a tap is allowed — keeps it here.
         */
        onPanResponderTerminationRequest: (_evt, g) => {
          if (now.current.scale > 1) return false;
          return !(Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > TAP_SLOP);
        },
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
           * There is nothing to pan — the picture is already inside the screen
           * — and sideways never reaches here, because the responder above
           * leaves it to the pager. The photograph follows the finger at a
           * third of the distance: not for the animation, but so somebody
           * finds out mid-drag that the gesture exists and which way it goes.
           */
          if (now.current.scale <= 1) {
            /*
             * Only once the finger has committed to the vertical.
             *
             * A sideways drag at fit belongs to the pager, and it spends its
             * first few points here before the pager decides to ask for it.
             * Moving the photograph on those would nudge it down and snap it
             * back on every swipe between pictures.
             */
            if (Math.abs(g.dy) > Math.abs(g.dx)) pan.setValue({ x: 0, y: g.dy / 3 });
            return;
          }
          if (!from.current) {
            from.current = { scale: now.current.scale, x: now.current.x, y: now.current.y, span: 0 };
          }
          pan.setValue({ x: from.current.x + g.dx, y: from.current.y + g.dy });
        },
        onPanResponderRelease: (_evt, g) => {
          from.current = null;

          /*
           * Down leaves, up talks.
           *
           * Every photo viewer on this phone dismisses downward and every
           * sheet arrives from below when you pull up. Those are two habits
           * somebody already has, and a screen that inverts them to be
           * internally consistent is one where the first swipe does the wrong
           * thing to everybody who has ever used a phone.
           */
          if (now.current.scale <= 1 && Math.abs(g.dy) > Math.abs(g.dx)) {
            const far = Math.abs(g.dy) > SWIPE;
            const flung = Math.abs(g.vy) > FLING;
            if (far || flung) {
              settle(1);
              if (g.dy > 0) onClose();
              else onTalk();
              return;
            }
          }

          /*
           * A release with nothing in it is a tap.
           *
           * Back here from a `Pressable`, which is where it had to go while
           * this declined the touch on the way down — and which took the
           * touch from everything else in the process. One responder owns the
           * gesture again, and a tap is the case where the gesture turned out
           * to be nothing.
           */
          if (Math.hypot(g.dx, g.dy) <= TAP_SLOP) {
            const at = Date.now();
            if (at - lastTap.current < DOUBLE_TAP_MS) {
              lastTap.current = 0;
              zoomTo(now.current.scale > 1 ? 1 : TAP_SCALE);
            } else {
              lastTap.current = at;
              // Only if no second tap follows. A single tap that hid the
              // chrome immediately would flash it on every double tap.
              setTimeout(() => {
                if (lastTap.current === at) onChrome();
              }, DOUBLE_TAP_MS);
            }
            return;
          }

          settle(now.current.scale);
        },
        onPanResponderTerminate: () => {
          // The pager took it. Whatever this was doing, put the picture back.
          from.current = null;
          settle(now.current.scale);
        },
      }),
    [onChrome, onClose, onTalk, pan, scale, settle, zoomTo],
  );

  return (
    <View style={{ width, height }}>
      <Animated.View
        style={[
          styles.shot,
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
          /*
           * No crossfade. A fade is a fade from the previous source, and in a
           * pager the previous source is a different photograph — so the one
           * being left would ghost over the one arriving. Nothing to fade from
           * here anyway: each page holds one picture for its whole life.
           */
          transition={0}
        />
      </Animated.View>
    </View>
  );
}

export function PhotoViewer({
  api,
  eventId,
  comments,
  t,
  canReact,
  canPost,
  onClose,
  onChanged,
  onOptions,
  onDownload,
  downloading,
  uploader,
  onOpenPerson,
  onFavourite,
  photos,
  index,
  onIndex,
}: {
  api: Api;
  /** Which album, for posting a comment against this photograph. */
  eventId: string;
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
  /**
   * Into the camera roll, from the corner.
   *
   * It was an item in the `⋯` sheet, which put the one thing somebody wants
   * *done with* a photograph in the same list as reporting it and asking for
   * it to come down — and one tap further away than any of them. The corner is
   * what you do with the picture; the sheet is what you do about it.
   *
   * The album screen owns the call, because it owns the acknowledgement: see
   * `saveOne`, which is also what the grid's own corner button uses, so
   * "saved" means the same file either way.
   */
  onDownload: () => void;
  /** Whether this one is on its way there. Draws the disc as working. */
  downloading: boolean;
  /**
   * Whose photograph this is, for the square at the top.
   *
   * Looked up by the caller rather than here: an album is a long list and the
   * map it comes out of is built once over there. Null for a photograph whose
   * uploader has gone, which draws nothing — an empty square in the middle of
   * the chrome would be a claim about somebody.
   */
  uploader: { name: string; handle: string | null; avatarUrl: string | null } | null;
  /**
   * Opening the person whose photograph this is.
   *
   * The album's column used to carry this — the handle beside each row was a
   * press — and the column is gone. Without it a photograph is the one place
   * in the product that shows you somebody and offers no way to them.
   *
   * Only ever called with a handle. Somebody who arrived by a link and added
   * photographs has a name and a face and no profile, and the square draws as
   * a label for them rather than as a control that does nothing.
   */
  onOpenPerson: (handle: string) => void;
  /**
   * Keeping this photograph, or letting it go.
   *
   * The state is read off `photo.favourite`, which is the feed's answer for
   * this viewer and nobody else's, so the star is correct the moment the
   * screen opens rather than after a request of its own.
   */
  onFavourite: (photoId: string, on: boolean) => Promise<void>;
  /**
   * The album, and which of it is on the glass.
   *
   * A list and an index now, which reverses an earlier decision — the viewer
   * used to be handed one photograph and its two neighbours, on the argument
   * that the caller owns the order and a second copy of it in here is a
   * second thing to keep in step.
   *
   * What changed is the pager. A window of three has to be re-centred every
   * time the middle one changes, and re-centring is an offset moving while
   * the content moves, which cannot be made to land in one frame. A list
   * never moves relative to itself: the platform scrolls it, and there is no
   * moment to synchronise. That needs the list.
   *
   * It is not a second copy — the same array the caller renders from, passed
   * rather than derived, and `onIndex` hands the position straight back so
   * the two do not drift.
   */
  photos: FeedPhoto[];
  index: number;
  onIndex: (next: number) => void;
}) {
  const { width, height } = useWindowDimensions();

  /**
   * The photograph the chrome is about.
   *
   * Derived rather than passed, so that it and the page under it can never
   * disagree — they are the same index into the same array.
   */
  const photo = photos[index] ?? photos[0]!;

  /**
   * Whether the page on the glass is magnified.
   *
   * The pager must not page while somebody is panning around inside a
   * photograph: the same sideways finger means two different things at 1× and
   * at 3×, and the only one that can tell them apart is the page itself.
   */
  const [zoomed, setZoomed] = useState(false);

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
  /** The full picker, over the row of six. */
  const [picking, setPicking] = useState(false);

  /*
   * Where the pager lands, reported once it has stopped.
   *
   * `onMomentumScrollEnd` rather than a viewability callback: the index is
   * what the chrome and the comment box are about, and changing those under a
   * finger that is still moving is worse than changing them a moment late.
   */
  const onSettled = useCallback(
    (offset: number) => {
      const at = Math.round(offset / width);
      if (at !== index && at >= 0 && at < photos.length) onIndex(at);
    },
    [index, onIndex, photos.length, width],
  );

  const layout = useCallback(
    (_: unknown, at: number) => ({ length: width, offset: width * at, index: at }),
    [width],
  );

  const renderPage = useCallback(
    ({ item }: { item: FeedPhoto }) => (
      <Page
        photo={item}
        width={width}
        height={height}
        onClose={onClose}
        onTalk={() => setTalking(true)}
        onChrome={() => setChrome((on) => !on)}
        onZoomed={setZoomed}
      />
    ),
    [height, onClose, width],
  );

  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  /**
   * The star this device has pressed, before the server has been asked.
   *
   * The same overlay the reactions below use, for the same reason and a
   * sharper version of it: the star was drawn straight off `photo.favourite`,
   * which is the feed's answer — so it did not move until the feed came back,
   * and the feed is fetched by the screen underneath this one. What that
   * looked like was a star that did nothing until you closed the photograph,
   * at which point the album had quietly been right all along.
   *
   * Keyed by photograph, because the pager means several can be starred
   * without this screen ever unmounting.
   */
  const [keeping, setKeeping] = useState<Map<string, boolean>>(new Map());

  /** What the star draws: this device's unconfirmed answer, else the feed's. */
  const kept = keeping.get(photo.id) ?? photo.favourite;

  const keep = useCallback(
    async (on: boolean) => {
      const id = photo.id;
      // Drawn now. Nothing below this line is waited on by the interface.
      setKeeping((was) => new Map(was).set(id, on));
      try {
        await onFavourite(id, on);
      } finally {
        /*
         * Dropped once the caller's refresh has landed, so the star never
         * flickers back through the old answer on its way to the new one —
         * and dropped even when the request failed, because the feed is the
         * truth and an overlay that outlives it is a lie this screen would
         * keep telling.
         */
        setKeeping((was) => {
          const next = new Map(was);
          next.delete(id);
          return next;
        });
      }
    },
    [onFavourite, photo.id],
  );

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

  /**
   * What a comment in this sheet can have done to it.
   *
   * The album's board is handed these as `actions` and builds them once at
   * the top of the screen; this sheet reaches the same three routes with the
   * same ids, because they are the same rows — `event_message` with a
   * `photo_id` on it. Each refreshes the feed, which is where both ends of
   * the thread read from.
   *
   * Not the whole `ThreadActions` shape: `post` here carries the photograph's
   * id and already exists below, so this is the other three.
   */
  const say = useMemo(
    () => ({
      edit: (id: string, body: string) => api.editMessage(id, body).then(onChanged),
      remove: (id: string) => api.deleteMessage(id).then(onChanged),
      react: (id: string, emoji: string) => api.react(id, emoji).then(onChanged),
      /*
       * And taking back one of the reaction lines in the sheet, which are
       * this photograph's own `photo_reaction` rows. The endpoint toggles, so
       * calling it on one somebody already has is how it comes off — the same
       * call the pill column makes, reached from the line instead.
       */
      unreact: (emoji: string) => api.reactToPhoto(photo.id, emoji).then(onChanged),
    }),
    [api, onChanged, photo.id],
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
      {/*
        The album, one photograph per page, scrolled by the platform.

        A hand-rolled row of three came before this and could not be made
        seamless. It had to be put back to centre every time the middle
        photograph changed, and an offset moving while the content moves is
        two different systems being asked to land on the same frame — so one
        of them was always late, and the picture just left was drawn centred
        under the new window for long enough to see.

        A pager has no such moment. The list does not move relative to itself,
        nothing is re-centred, and the only thing that changes is a scroll
        offset the platform owns end to end.

        Windowed rather than whole: an album can be hundreds, and `FlatList`
        keeps a handful of pages mounted either side. `getItemLayout` is what
        lets it open on the photograph that was tapped without measuring
        everything before it.
      */}
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={layout}
        keyExtractor={(item: FeedPhoto) => item.id}
        // Paging stops while a photograph is magnified: the same sideways
        // finger means two different things at 1× and at 3×.
        scrollEnabled={!zoomed}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
          onSettled(e.nativeEvent.contentOffset.x)
        }
        renderItem={renderPage}
      />

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
            {/*
              Whose photograph this is, in the middle of the chrome.

              The album used to say it in the column, beside each picture, and
              the column is gone — so the attribution moved to the screen the
              column was standing in for. Centred rather than tucked beside
              the close button because it is not a control: the two round
              glyphs either side are the things to press, and a face between
              them reads as a label, which is what it is.

              A square, like the faces on the tiles. A disc here would be the
              one round face in a product whose photographs all have corners,
              and at this size the difference is what tells you it is a
              picture of somebody rather than a button.

              Absolutely positioned so that it is centred on the *screen* and
              not on whatever space is left between the two buttons — with
              `space-between` those are different centres, and the second one
              drifts as the buttons change size.
            */}
            {uploader && (
              /*
                Two views, and the outer one must not take a touch.
                *
                * This was one absolutely positioned `Pressable` spanning
                * `left: 0` to `right: 0` — which is a full-width target lying
                * over both corner buttons, painted after them because it is
                * later in the tree. So the ✕ opened this person's profile
                * instead of closing the photograph, and the way out of the
                * viewer was a door into somewhere else entirely.
                *
                * The centring has to be full width — it is centred on the
                * screen rather than on the gap between two buttons, which are
                * different centres — so the fix is to split the two jobs.
                * This view does the placing and declines every touch;
                * the pressable inside it is only as wide as the face and the
                * handle, which is the only part that should answer to one.
               */
              <View style={styles.who} pointerEvents="box-none">
              <Pressable
                style={styles.whoTap}
                // A label, not a control, for somebody with no profile behind
                // it.
                onPress={
                  uploader.handle ? () => onOpenPerson(uploader.handle!) : undefined
                }
                disabled={!uploader.handle}
                accessibilityRole={uploader.handle ? 'button' : 'text'}
                accessibilityLabel={
                  uploader.handle
                    ? `${uploader.handle}, see their profile`
                    : `Added by ${uploader.name}`
                }
                hitSlop={8}
              >
                {uploader.avatarUrl ? (
                  <ExpoImage
                    source={{ uri: uploader.avatarUrl }}
                    style={styles.whoFace}
                    contentFit="cover"
                    transition={120}
                  />
                ) : (
                  <View style={[styles.whoFace, styles.whoBlank]}>
                    <Text style={styles.whoInitial}>
                      {(uploader.handle ?? uploader.name).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                {/* The handle where there is one, for the reason the column
                    gave: a name under a picture reads as a caption, a handle
                    reads as attribution. */}
                <Text style={styles.whoName} numberOfLines={1}>
                  {uploader.handle ?? uploader.name}
                </Text>
              </Pressable>
              </View>
            )}

            {/*
              Keeping it, beside the way out of it.

              In the chrome rather than over the picture: this is a thing you
              decide about the photograph while looking at it, and a control
              sitting on the image is a mark on somebody's photograph.

              Filled when kept, outlined when not, and no second colour — the
              difference between a star and an outline is legible at a glance
              and does not need the product to shout about it. Nobody else
              sees this, so it has nothing to announce.
            */}
            {/*
              The two right-hand controls, as one.

              `top` spaces its children apart, and a third loose child would be
              spread into the middle — which is where the uploader's square
              already is. Grouped, the row stays "leave on the left, these two
              on the right" however many of them there are.
            */}
            <View style={styles.tools}>
            <Pressable
              onPress={() => void keep(!kept)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityState={{ selected: kept }}
              accessibilityLabel={kept ? 'Kept. Tap to remove' : 'Keep this photo'}
              style={styles.round}
            >
              <Glyph name="star" size={19} color="#fff" filled={kept} />
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
            /*
              Three things on one line: what you can say, and the two things
              you can do without saying anything.

              Reacting sits on the left and saving on the right, which is the
              arrangement asked for and a better one than the reaction disc
              alone on the right. Both are one-tap verbs about the picture, so
              they belong at the two ends where a thumb reaches without
              crossing it — and the box between them grows into whatever is
              left, which is what a composer should do anyway.
            */
            <View style={styles.bar} pointerEvents="box-none">
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
                  style={({ pressed }) => [styles.disc, { opacity: pressed ? 0.55 : 1 }]}
                >
                  <Glyph name="face" size={22} color="#fff" />
                </Pressable>
              ) : (
                <Text style={styles.why}>Sign in{'\n'}to react</Text>
              )}

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
                And the camera's own file, in the opposite corner.

                The glyph rather than a word, because it is one of three
                controls on a row over somebody's photograph and the other two
                are glyphs. A spinner in place of it while it is working:
                saving takes a download and a write, and a button that looks
                idle for four seconds is a button somebody presses twice.
              */}
              <Pressable
                onPress={onDownload}
                disabled={downloading}
                accessibilityRole="button"
                accessibilityLabel={downloading ? 'Saving this photo' : 'Save this photo'}
                style={({ pressed }) => [
                  styles.disc,
                  { opacity: downloading ? 0.6 : pressed ? 0.55 : 1 },
                ]}
              >
                {downloading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Glyph name="download" size={22} color="#fff" />
                )}
              </Pressable>
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

            {/*
              The album's board, about one photograph.

              It was a list of its own — a name over a sentence, no face, no
              time, nothing to press — which meant the same comment was drawn
              two ways depending on which end of the thread you read it from,
              and the one drawn here was the poorer of the two. `ThreadRow` is
              the board's own row, handed this screen's palette: a face, a
              name, a time, the words, your own hanging from the right, and
              the reaction pills a comment has collected.

              What it is not handed is `about`. That prop is the thumbnail of
              the photograph a line is about, and the photograph is on the
              screen behind this sheet — which is also why a reaction here
              draws as its quiet line rather than as a row with a picture in
              it. Nothing in this sheet is about any other photograph: what
              the caller filters to `photo_id` is the whole of what it holds,
              comments and reactions alike.
            */}
            <ScrollView
              style={styles.talkScroll}
              contentContainerStyle={styles.talkInner}
              keyboardShouldPersistTaps="handled"
            >
              {comments.length === 0 ? (
                /* An invitation rather than a report of emptiness, which is
                   the board's rule: "no comments yet" describes what somebody
                   can already see. And it goes to the album's board when it is
                   written — one thread, two ways in. */
                <Text style={styles.talkEmpty}>Say something about this one.</Text>
              ) : (
                comments.map((message) => (
                  <ThreadRow
                    key={message.id}
                    message={message}
                    canPost={canPost}
                    t={GLASS}
                    shape="board"
                    canReact={canPost}
                    onReact={(emoji) => void say.react(message.id, emoji)}
                    onDelete={() => void say.remove(message.id)}
                    onEdit={(body) => void say.edit(message.id, body)}
                    onUnreact={
                      message.emoji && message.author.mine
                        ? () => void say.unreact(message.emoji!)
                        : undefined
                    }
                    about={null}
                  />
                ))
              )}
            </ScrollView>

            {canPost && (
              /*
                And the box the album types into, in this screen's colours:
                one bordered card with the field bare inside it and a filled
                Post under it. The same 14, 13 and 15 the site and the board
                both use — see the composer's note in `Thread.tsx`.

                The placeholder keeps saying which photograph, where the
                board's says "Add a comment…". It is the one line that tells
                somebody what they are about to do, and what they are about to
                do here is put a line on *this* picture rather than on the
                evening — a sheet that slid up over it is context, not a
                promise.
              */
              <View style={styles.talkBox}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Say something about this photo…"
                  placeholderTextColor={GLASS.dim}
                  style={styles.talkInput}
                  multiline
                  autoFocus
                  accessibilityLabel="Say something about this photo"
                />
                <View style={styles.talkActions}>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => void post()}
                    disabled={!draft.trim() || sending}
                    accessibilityRole="button"
                    accessibilityLabel="Post this comment"
                    style={({ pressed }) => [
                      styles.talkPost,
                      { opacity: !draft.trim() || sending ? 0.6 : pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={styles.talkPostText}>
                      {sending ? 'Posting…' : 'Post'}
                    </Text>
                  </Pressable>
                </View>
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
   * The uploader, centred on the screen rather than on the gap.
   *
   * `left: 0; right: 0; alignItems: 'center'` inside a row that is already
   * spacing two buttons apart: laid out as a third flex child it would sit in
   * the middle of what those two leave, which moves whenever either does.
   */
  /* Leave on the left; keep and everything-else on the right. */
  tools: { flexDirection: 'row', gap: 10 },
  /*
   * The placing, which takes no touches at all.
   *
   * Full width, because the square is centred on the screen and not on the
   * gap between the two buttons — with `space-between` those are different
   * centres, and the second drifts as the buttons change size. Full width is
   * also what put an invisible target over the ✕, so this half is
   * `pointerEvents="box-none"` and only the pressable inside it answers.
   */
  who: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  /* And the target, which is the size of what it is drawn around. */
  whoTap: { alignItems: 'center', gap: 4 },
  /* A square with the corner this product gives every face — a quarter of the
     box — at the size the album's own tiles draw one. */
  whoFace: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#ffffff24' },
  whoBlank: { alignItems: 'center', justifyContent: 'center' },
  whoInitial: { color: '#fff', fontSize: 15, fontWeight: '700' },
  /* On the glass, so it has to carry its own contrast: a shadow rather than a
     plate, for the same reason the photograph is not dimmed to label it. */
  whoName: {
    color: '#fff',
    fontSize: 12.5,
    fontWeight: '600',
    maxWidth: 180,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  /*
   * The comment box, on the glass rather than inside the panel.
   *
   * It is the thing somebody came here to do, and a box you have to open a
   * panel to find is a box nobody uses. Left of the reaction column, clear of
   * the names in the other corner.
   */
  /* The three of them on one line, so the list above has a single edge to sit
     over rather than controls at different heights. */
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
  /* 22 between rows, which is the board's own gap: nothing is drawn around a
     comment in either place, so the gap is the only thing separating one from
     the next. */
  talkInner: { paddingHorizontal: 16, paddingVertical: 10, gap: 22 },
  talkEmpty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, paddingVertical: 12 },
  /* The composer, in the shape the album and the site both use: one bordered
     card with the field bare inside it and the button under the field. The
     numbers are theirs — 14, 13 and 15, and 8 between the two rows. */
  talkBox: {
    marginHorizontal: 16,
    marginTop: 4,
    borderWidth: 1,
    borderColor: GLASS.line,
    backgroundColor: GLASS.card,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 15,
    gap: 8,
  },
  talkInput: { maxHeight: 120, color: '#fff', fontSize: 15, padding: 0 },
  talkActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  talkPost: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: GLASS.accent,
  },
  talkPostText: { color: GLASS.onAccent, fontSize: 14, fontWeight: '600' },
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

  /*
   * The two verbs at the ends of the bar: react on the left, save on the
   * right.
   *
   * One style for both, and the same disc as the two in the top corners. It
   * was `smiley`, named for the one control that used to be down here — a
   * name that describes the picture inside a shape is a name the second thing
   * in that shape cannot use.
   */
  disc: {
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
