/**
 * Moments: one photograph somebody put in front of their people.
 *
 * Three pieces, kept together because they are one feature:
 *
 * - `MomentsRow`, the strip at the top of Home — one stream of everybody's
 *   moments, one tile per moment, in the order the server sends (fresh and
 *   unseen first; see `orderStream` there). A tile is the photograph, ringed
 *   in the app icon's field until it has been opened, with its author's face
 *   as a badge on the corner. The same strip, scoped to one person, is on
 *   their page.
 * - `MomentsViewer`, which is `PhotoViewer` itself, `plain`. Pressing a moment
 *   opens exactly what pressing a photograph in a roll opens, and swiping walks
 *   the strip in its own order. Each one that comes on screen is marked seen.
 * - `AddMoment`, the screen the `+` sheet's third choice opens: one picture
 *   off the camera roll, shown, then put straight to storage.
 *
 * The strip and the sheet live on different tabs, so a posted moment is
 * announced through `momentsChanged` rather than by threading a refresh
 * callback from one tab through `App` into the other.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useAppearance } from './appearance';
import { AURORA_DARK, AURORA_LIGHT } from './aurora';
import Svg, { Defs, G, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ApiError, type Api, type FeedPhoto, type Moment } from './api';
import type { GroupTheme } from './Groups';
import { IconRing } from './IconField';
import { ChatPicker } from './ChatPicker';
import { PhotoViewer } from './PhotoViewer';
import { reportContent } from './report';
import { describeFile, fetchForMoment, putToStorage, saveToCameraRoll } from './platform';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

const listeners = new Set<() => Promise<void>>();

/**
 * Somebody posted or removed a moment, or said something under one; every
 * row on screen re-reads. Resolves once they have, so a caller holding an
 * optimistic overlay can drop it in the same tick the fresh answer lands.
 */
async function momentsChanged(): Promise<void> {
  await Promise.all([...listeners].map((listener) => listener()));
}

/**
 * The stream this person may see — or, given a handle, that person's moments —
 * re-read whenever one is posted, removed or blocked on any screen.
 *
 * `seen` is here too: the viewer marks a moment opened the moment it is on
 * screen, and the strip's ring has to change then rather than on the next
 * fetch. A local set laid over the server's answer, cleared by the refresh
 * that makes it true.
 */
export function useMoments(api: Api, handle?: string | null) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    // A page with no handle yet has nothing to ask for.
    if (handle === null) return;
    try {
      const { moments } = await (handle ? api.momentsBy(handle) : api.moments());
      setMoments(moments);
      setOpened(new Set());
    } catch {
      // The strip is an extra. Failing to fetch it leaves it as it was.
    }
  }, [api, handle]);

  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);

  const drawn = useMemo(
    () =>
      opened.size === 0
        ? moments
        : moments.map((m) => (opened.has(m.id) ? { ...m, seen: true } : m)),
    [moments, opened],
  );

  const markSeen = useCallback((id: string) => {
    setOpened((was) => (was.has(id) ? was : new Set(was).add(id)));
  }, []);

  return { moments: drawn, refresh, markSeen };
}

/**
 * One picture off the camera roll, or null if they backed out.
 *
 * The system picker, for the avatar's reason: choosing one image needs no
 * library permission on iOS. No crop — a moment is somebody's whole
 * photograph, and the server keeps it whole.
 */
async function pickOne(): Promise<{ uri: string; mimeType: string } | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    /*
     * A JPEG, not the HEIC the camera wrote.
     *
     * Without this the picker hands back the original file, which on an
     * iPhone is HEIC — and the server's decoder cannot read HEIC, so every
     * moment came back "not an image". The avatar never met this because its
     * crop re-encodes as JPEG on the way out. `Compatible` asks the system for
     * its most compatible representation, which is the same photograph
     * transcoded before it leaves the phone.
     */
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = picked.assets?.[0];
  if (picked.canceled || !asset) return null;
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
}

/**
 * Adding a moment: its own screen, the way a roll's first step is.
 *
 * The `+` sheet's Moment used to launch the picker straight from the sheet,
 * and on iOS that is a picker asked to present while the sheet it came from is
 * still sliding away — which the system refuses without saying so. So the
 * choice opens this instead: a screen that is fully on the glass before the
 * picker is asked for, a frame showing what is about to go up, and a Share
 * that is the only thing that sends it. Picking the wrong photo is a tap on
 * the frame, not a moment somebody has to go and delete.
 */
export function AddMoment({
  api,
  onCancel,
  onShared,
  seed,
}: {
  api: Api;
  onCancel: () => void;
  onShared: () => void;
  /**
   * A photograph already chosen — the ripple in a roll's viewer.
   *
   * It is fetched to this phone first, because a moment's bytes go
   * phone → storage and the upload reads a local file. The frame waits on a
   * spinner meanwhile; somebody can still pick something else instead.
   */
  seed?: { id: string; url: string; mime: string };
}) {
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<{ uri: string; mimeType: string } | null>(null);
  const uri = picked?.uri ?? null;
  const [sharing, setSharing] = useState(false);
  const [fetching, setFetching] = useState(Boolean(seed));

  useEffect(() => {
    if (!seed) return;
    let live = true;
    fetchForMoment(seed.url, seed.id, seed.mime)
      .then((local) => {
        // Only if nothing was chosen off the camera roll while it came down.
        if (live) setPicked((was) => was ?? { uri: local, mimeType: seed.mime });
      })
      .catch(() => {
        if (live) Alert.alert('Could not load that photo', 'Try again in a moment.');
      })
      .finally(() => {
        if (live) setFetching(false);
      });
    return () => {
      live = false;
    };
  }, [seed]);

  const choose = useCallback(async () => {
    const next = await pickOne();
    if (next) setPicked(next);
  }, []);

  /*
   * To storage, then the key to the server.
   *
   * It was one POST of the file to the server, the avatar's way, and that
   * cannot work for a photograph: the server refuses a request body over about
   * 4.5MB and a picture off this phone is larger, so every Share came back 413.
   * The bytes go phone → storage now, like a roll's photographs.
   */
  const share = useCallback(async () => {
    if (!picked || sharing) return;
    setSharing(true);
    try {
      const { exists, byteSize } = describeFile(picked.uri);
      if (!exists || byteSize === 0) throw new Error('unreadable');
      const slot = await api.momentUpload(byteSize, picked.mimeType);
      await putToStorage(slot.url, slot.headers, picked.uri);
      await api.finishMoment(slot.key);
      momentsChanged();
      onShared();
    } catch (err) {
      setSharing(false);
      Alert.alert('Could not share that moment', shareFailure(err));
    }
  }, [api, onShared, picked, sharing]);

  return (
    <View style={[styles.addRoot, { backgroundColor: '#000' }]}>
      <View style={styles.addBar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" disabled={sharing}>
          <Text style={styles.addCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.addTitle}>New moment</Text>
        <Pressable
          onPress={() => void share()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Share this moment"
          disabled={!uri || sharing}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.addShare, { opacity: uri ? 1 : 0.4 }]}>Share</Text>
          )}
        </Pressable>
      </View>

      {/* `contain`, as in the roll's picker: this frame is for judging a
          photograph, and it is shared whole. */}
      <Pressable
        onPress={() => void choose()}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel={uri ? 'Choose a different photo' : 'Choose a photo'}
        style={[styles.addFrame, { height: width * 1.25 }]}
      >
        {!uri && fetching ? (
          <ActivityIndicator color="#fff" />
        ) : uri ? (
          <ExpoImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
          />
        ) : (
          <View style={styles.addEmpty}>
            <View style={[styles.addPlus, { borderColor: 'rgba(255,255,255,0.35)' }]}>
              <Text style={styles.addPlusGlyph}>+</Text>
            </View>
            <Text style={styles.addWhy}>Choose a photo</Text>
            <Text style={styles.addWhySmall}>
              One photo, front and center for your people.
            </Text>
          </View>
        )}
      </Pressable>

      {uri && !sharing && (
        <Pressable onPress={() => void choose()} hitSlop={10} accessibilityRole="button">
          <Text style={styles.addAgain}>
            Choose a different photo
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** What went wrong, in a sentence somebody can act on. */
function shareFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'That photo is too large to share.';
    if (err.status === 415) return 'That photo is in a format we cannot read.';
    if (err.status === 429) return 'You have shared a lot just now. Try again later.';
  }
  return 'Try again in a moment.';
}

/** The first word of a name. The rows under the squares are narrow. */
function first(name: string): string {
  return name.replace('@', '').trim().split(/\s+/)[0] || name;
}

/**
 * Home's way into Moments: one bar, not a row of them.
 *
 * Moments are one collective stream, and a row of tiles on Home — each with a
 * face and a name on it — read as a shelf of individual people's stories,
 * which is the thing they are not. So Home says only that there are moments
 * and how many are new to you. No names, no faces, no pictures: who posted
 * what is something you find out inside, one moment at a time.
 *
 * New is said with the accent — a dot, the count, a brighter edge — and not
 * with the icon's ring, which belongs to the tiles inside. Nothing to open is
 * nothing drawn.
 */
export function MomentsBar({
  moments,
  onOpen,
}: {
  moments: Moment[];
  /** Kept for the callers' sake; the bar follows the app's look itself. */
  t?: GroupTheme;
  /** Where to start: the first one new to you, else the first. */
  onOpen: (momentId: string) => void;
}) {
  const scheme = useAppearance();
  if (moments.length === 0) return null;
  const fresh = moments.filter((m) => !m.seen && !m.mine);
  const start = (fresh[0] ?? moments[0])!.id;
  const news = fresh.length;

  /*
   * Follows the app's look (Settings → Appearance, dark by default): dark
   * glass on dark, and on light the web's bar exactly — near-white glass, a
   * white card on a white page rather than a slab. Either way the card with colour showing through it from one corner, as if lit
   * from behind frosted glass. The colour says there is activity and nothing
   * about what: it is the app icon's own field, not anybody's photograph.
   * Caught up, it is a faint glow that holds still; while something is new it
   * is brighter and drifts.
   *
   * The status is on the right and is the thing to read; the chevron after it
   * is only a hint that this opens.
   */
  const look = scheme === 'light' ? BAR_LIGHT : BAR_DARK;
  return (
    /*
     * Two layers because of the shadow: a view that clips its corners (which
     * the colour needs) also clips its own shadow on iOS. The outer one casts
     * it; the inner one holds the colour inside the rounded card.
     */
    <Pressable
      onPress={() => onOpen(start)}
      accessibilityRole="button"
      accessibilityLabel={news > 0 ? `Moments, ${news} new` : 'Moments'}
      style={({ pressed }) => [styles.barShadow, look.shadow, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={[styles.bar, look.card]}>
        <Bloom lively={news > 0} look={look} />
        <Text style={[styles.barTitle, { color: look.ink }]}>Moments</Text>
        <View style={styles.barEnd}>
          {news > 0 && <Text style={[styles.barNew, { color: look.ink }]}>{news} new</Text>}
          <Text style={[styles.barChevron, { color: look.quiet }]}>›</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** How long each moment is on screen before the next one comes. */
export const MOMENT_SECONDS = 15;

/** The drift's length, one way. Slow enough to be felt rather than watched. */
const DRIFT_MS = 14_000;

/**
 * The colour under the glass: three of the icon's blooms gathered at the
 * right-hand end, then frosted over.
 *
 * It moves, very slowly — a few points one way over fourteen seconds and back
 * — so the surface feels faintly alive while there is something new. Not a
 * loop anybody would notice as animation, and none at all for somebody who
 * has asked their phone to reduce motion.
 */
function Bloom({ lively, look }: { lively: boolean; look: BarLook }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    // Only something new moves. Caught up, the glow holds still.
    if (!lively) {
      drift.setValue(0);
      return;
    }
    void AccessibilityInfo.isReduceMotionEnabled().then((still) => {
      if (still || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(drift, {
            toValue: 1,
            duration: DRIFT_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(drift, {
            toValue: 0,
            duration: DRIFT_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [drift, lively]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.bloom,
          {
            // Faint when caught up, bright when something is new.
            opacity: lively ? 1 : look.quietGlow,
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [10, -18] }) },
              { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [4, -6] }) },
            ],
          },
        ]}
      >
        {/*
          Masked to nothing towards the left, as the web's is: the colour
          fades into the card rather than ending at the edge of a block,
          which on a wide bar showed as a hard vertical line.
        */}
        <Svg width="100%" height="100%">
          <Defs>
            {look.bloom.map((b) => (
              <RadialGradient
                key={b.id}
                id={`${id}${b.id}`}
                cx={b.cx}
                cy={b.cy}
                rx={b.rx}
                ry={b.ry}
              >
                <Stop offset="0" stopColor={b.colour} stopOpacity={b.opacity} />
                <Stop offset="1" stopColor={b.colour} stopOpacity={0} />
              </RadialGradient>
            ))}
            <LinearGradient id={`${id}fade`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0.25" stopColor="#fff" stopOpacity={0} />
              <Stop offset="0.65" stopColor="#fff" stopOpacity={1} />
            </LinearGradient>
            <Mask id={`${id}mask`}>
              <Rect width="100%" height="100%" fill={`url(#${id}fade)`} />
            </Mask>
          </Defs>
          <G mask={`url(#${id}mask)`}>
            {look.bloom.map((b) => (
              <Rect key={b.id} width="100%" height="100%" fill={`url(#${id}${b.id})`} />
            ))}
          </G>
        </Svg>
      </Animated.View>
      {/* The frost. Over the colour and under the words, so the colour reads
          as behind the glass rather than painted on it. */}
      <BlurView intensity={40} tint={look.tint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.frost }]} />
    </View>
  );
}

type Bloom = {
  id: string;
  colour: string;
  opacity: number;
  cx: string;
  cy: string;
  /** Radii, as the web's `radial-gradient(rx ry at cx cy)` has them. */
  rx: string;
  ry: string;
};

type BarLook = {
  card: ViewStyle;
  shadow: ViewStyle;
  ink: string;
  quiet: string;
  tint: 'dark' | 'light';
  frost: string;
  /** How much of the colour shows when there is nothing new. */
  quietGlow: number;
  bloom: readonly Bloom[];
};

/**
 * Dark glass: three of `IconField`'s colours — violet, pink and teal — in
 * the light card's places, glowing against a near-black card.
 */
const BAR_DARK: BarLook = {
  card: { backgroundColor: '#15171c', borderColor: 'rgba(255,255,255,0.1)' },
  shadow: {},
  ink: '#ffffff',
  quiet: 'rgba(255,255,255,0.45)',
  tint: 'dark',
  frost: 'rgba(21,23,28,0.35)',
  quietGlow: 0.38,
  bloom: [
    { ...AURORA_DARK[0]!, cx: '60%', cy: '70%', rx: '34%', ry: '80%' },
    { ...AURORA_DARK[1]!, cx: '76%', cy: '28%', rx: '30%', ry: '75%' },
    { ...AURORA_DARK[2]!, cx: '92%', cy: '72%', rx: '28%', ry: '70%' },
  ],
};

/**
 * Light glass: a near-white card, a soft edge and the faintest shadow, with
 * an aurora of indigo, violet and teal inside it. Softer colours at lower
 * strength than the dark card — on white, a little colour is already a lot.
 */
const BAR_LIGHT: BarLook = {
  card: { backgroundColor: '#f7f7fa', borderColor: 'rgba(20,23,28,0.08)' },
  shadow: {
    shadowColor: '#28326e',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  ink: '#14171c',
  quiet: 'rgba(20,23,28,0.35)',
  tint: 'light',
  frost: 'rgba(247,247,250,0.4)',
  quietGlow: 0.4,
  bloom: [
    // The web's three, stop for stop and place for place — see `.moments-bar-bloom`.
    { ...AURORA_LIGHT[0]!, cx: '60%', cy: '70%', rx: '34%', ry: '80%' },
    { ...AURORA_LIGHT[1]!, cx: '76%', cy: '28%', rx: '30%', ry: '75%' },
    { ...AURORA_LIGHT[2]!, cx: '92%', cy: '72%', rx: '28%', ry: '70%' },
  ],
};

export function MomentsRow({
  moments,
  t,
  onOpen,
  style,
}: {
  moments: Moment[];
  t: GroupTheme;
  onOpen: (momentId: string) => void;
  /** Where it sits on a page that is not Home, whose spacing it assumes. */
  style?: StyleProp<ViewStyle>;
}) {
  if (moments.length === 0) return null;
  return (
    /*
     * The row's own box, sized from its tiles, around the scroll.
     *
     * Why the rounded squares came out cut: the ring was the icon's field as a
     * square SVG, rounded only by its parent's `overflow: hidden` and radius —
     * and an SVG is its own native view, so whether that clip reached into it
     * was the renderer's decision, not the layout's. The ring is a path now
     * (`IconRing`), with the corners in its geometry. And a horizontal scroll
     * view clips to its own bounds whatever `overflow` says, so the tiles sit
     * inside padding wide enough for the ring *and* the face badge that hangs
     * off each tile's corner, rather than flush against the edge that clips.
     */
    <View style={[styles.rowOuter, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {moments.map((moment) => (
          <MomentTile
            key={moment.id}
            moment={moment}
            t={t}
            onPress={() => onOpen(moment.id)}
            plain
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One moment in the strip: the photograph, its ring, and whose it is.
 *
 * Ringed in the icon's field until opened, then in a hairline — the ring is
 * the only thing that says "new to you", so it is colour or nothing. The same
 * geometry either way, so a tile does not change size when it is seen.
 */
function MomentTile({
  moment,
  t,
  onPress,
  dark = false,
  active,
  plain = false,
}: {
  moment: Moment;
  t: GroupTheme;
  onPress: () => void;
  /**
   * On somebody's page: every tile there is theirs, and the page already says
   * whose — so no face on the corner and no name underneath, only the
   * photograph. The viewer's strip is where those still say who.
   */
  plain?: boolean;
  /** On the viewer's black glass rather than the page. */
  dark?: boolean;
  /**
   * In the viewer's strip: whether this is the one on screen. Undefined
   * anywhere a tile is not a position in something.
   */
  active?: boolean;
}) {
  const who = moment.mine ? 'You' : first(moment.author.name);
  // The page's colours, or the glass's: a hairline and a gap that are the
  // page's white would be a white box drawn on somebody's photograph.
  const ground = dark ? '#000' : t.bg;
  const ink = dark ? '#fff' : t.fg;
  const hairline = dark ? 'rgba(255,255,255,0.35)' : t.line;
  /*
   * Where you are in the stream: the one on screen at full strength with a
   * short bar under it, the rest stepped back. Quiet on purpose — the
   * photograph behind the strip is what this screen is about.
   */
  const faded = active === false;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={active === undefined ? undefined : { selected: active }}
      accessibilityLabel={`${moment.mine ? 'Your' : `${who}'s`} moment${moment.seen ? '' : ', new'}`}
      style={({ pressed }) => [
        styles.tile,
        { opacity: pressed ? 0.5 : faded ? 0.55 : 1 },
      ]}
    >
      <View style={styles.frame}>
        {moment.seen ? (
          <IconRing size={RING} radius={RING_RADIUS} thickness={SEEN_LINE} color={hairline} />
        ) : (
          <IconRing size={RING} radius={RING_RADIUS} thickness={RING_LINE} />
        )}
        <ExpoImage
          source={{ uri: moment.thumb }}
          style={[styles.shot, { backgroundColor: t.card }]}
          contentFit="cover"
          transition={120}
        />
        {/* Whose, on the corner: a face, ringed in the page's colour so it
            reads as sitting on the photograph rather than being part of it. */}
        {!plain && (
          <View style={[styles.badge, { borderColor: ground, backgroundColor: t.card }]}>
            {moment.author.avatar ? (
              <ExpoImage
                source={{ uri: moment.author.avatar }}
                style={styles.badgeImage}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <Text style={[styles.badgeLetter, { color: t.fg }]}>
                {(first(moment.author.name) || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
        )}
      </View>
      {!plain && (
        <Text style={[styles.name, { color: ink }]} numberOfLines={1}>
          {who}
        </Text>
      )}
      {active !== undefined && (
        <View style={[styles.here, { backgroundColor: active ? ink : 'transparent' }]} />
      )}
    </Pressable>
  );
}

/**
 * The stream's tiles, across the top of the viewer: the way through it.
 *
 * The same tiles as a profile's strip, doing a different job — they are a
 * position here. Seen ones wear the hairline, the rest the icon's ring, the
 * one on screen is at full strength with a bar under it, and pressing any of
 * them goes there. Kept scrolled so the one on screen is in the middle.
 */
function MomentsNav({
  moments,
  at,
  t,
  onJump,
}: {
  moments: Moment[];
  at: number;
  t: GroupTheme;
  onJump: (index: number) => void;
}) {
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const step = RING + BADGE_HANG + NAV_GAP;

  useEffect(() => {
    const offset = ROW_PAD + at * step - (width / 2 - (RING + BADGE_HANG) / 2);
    scroller.current?.scrollTo({ x: Math.max(0, offset), animated: true });
  }, [at, step, width]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, styles.nav]}
    >
      {moments.map((moment, i) => (
        <MomentTile
          key={moment.id}
          moment={moment}
          t={t}
          dark
          active={i === at}
          onPress={() => onJump(i)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * Moments, opened from Home's bar or a profile's strip: the roll's own
 * viewer, over everything, with the stream's tiles across the top.
 */
export function MomentsViewer({
  api,
  moments,
  start,
  t,
  Button,
  onClose,
  onOpenPerson,
  onSeen,
}: {
  api: Api;
  /** The strip it was opened from, in the strip's order. */
  moments: Moment[];
  /** The moment that was pressed. */
  start: string;
  t: GroupTheme;
  Button: ButtonComponent;
  onClose: () => void;
  onOpenPerson: (handle: string) => void;
  /** This one is on screen: draw it seen now. The server is told here. */
  onSeen: (id: string) => void;
}) {
  /*
   * The strip in the viewer's own photograph shape, so the viewer does not
   * learn a second one: a moment has one rendition, so every size is that one,
   * and its reactions are already in a roll photograph's shape.
   */
  const photos = useMemo(
    () =>
      moments.map(
        (moment): FeedPhoto => ({
          id: moment.id,
          src: moment.thumb,
          card: moment.src,
          grid: moment.src,
          full: moment.src,
          original: moment.src,
          byteSize: 0,
          mime: 'image/jpeg',
          takenAt: moment.createdAt,
          addedAt: moment.createdAt,
          tags: [],
          mine: moment.mine,
          by: moment.author.actorId,
          reactions: moment.reactions,
          favourite: false,
          unseen: false,
        }),
      ),
    [moments],
  );

  const [index, setIndex] = useState(() =>
    Math.max(0, moments.findIndex((m) => m.id === start)),
  );
  const [options, setOptions] = useState(false);
  /** The comment sheet is open. See `onEngaged`. */
  const [engaged, setEngaged] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /*
   * Comments and reactions, through the moment's own routes. Each re-reads
   * the stream afterwards, which is where the viewer's copy comes from.
   */
  const talk = useMemo(
    () => ({
      post: async (momentId: string, body: string) => {
        await api.commentOnMoment(momentId, body);
      },
      remove: async (momentId: string, commentId: string) => {
        await api.deleteMomentComment(momentId, commentId);
      },
      react: async (momentId: string, emoji: string) => {
        await api.reactToMoment(momentId, emoji);
      },
    }),
    [api],
  );
  const [saving, setSaving] = useState<string | null>(null);
  /** The moment on its way into a chat, while the picker is open. */
  const [sendingMoment, setSendingMoment] = useState<string | null>(null);

  // A removal can shorten the list under the index.
  const at = Math.min(index, photos.length - 1);
  const photo = photos[at];
  const moment = moments[at];

  useEffect(() => {
    if (photos.length === 0) onClose();
  }, [onClose, photos.length]);

  /*
   * Seen when it is on screen — the one that was pressed, and each one swiped
   * to. Once per moment: the server keeps the first opening anyway, and a
   * request per settle of the pager would be one per swipe back and forth.
   */
  const told = useRef<Set<string>>(new Set());
  const seenId = moment && !moment.seen && !moment.mine ? moment.id : null;
  useEffect(() => {
    if (!seenId || told.current.has(seenId)) return;
    told.current.add(seenId);
    onSeen(seenId);
    api.markMomentSeen(seenId).catch(() => {
      // Nothing to say: the ring comes back on the next fetch, which is the
      // whole cost of this not landing.
    });
  }, [api, onSeen, seenId]);

  /*
   * Each moment has `MOMENT_SECONDS` on screen, then the next one comes; after
   * the last, the viewer closes. The line above the tiles fills as the time
   * goes, so how long is left is something you can see rather than guess.
   *
   * A new moment — swiped to, tapped in the strip, or arrived at — starts its
   * own clock from empty. The clock holds while the ⋯ sheet, the comment
   * sheet is open — somebody deciding what to do about a
   * picture, or saying something about it, should not have it taken away
   * mid-sentence — and carries on from where it was when they shut.
   */
  const progress = useRef(new Animated.Value(0)).current;
  const showing = moment?.id ?? null;
  const last = moments.length - 1;
  useEffect(() => {
    progress.setValue(0);
  }, [progress, showing]);
  useEffect(() => {
    if (!showing || options || engaged || sendingMoment) {
      progress.stopAnimation();
      return;
    }
    let left = MOMENT_SECONDS * 1000;
    progress.stopAnimation((value) => {
      left = Math.max(0, (1 - value) * MOMENT_SECONDS * 1000);
    });
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: left,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (!finished) return;
      if (at < last) setIndex(at + 1);
      else onClose();
    });
    return () => run.stop();
  }, [at, engaged, last, onClose, options, progress, sendingMoment, showing]);

  if (!photo || !moment) return null;
  const owner = moment.author;

  const closeOptions = () => {
    setOptions(false);
    setConfirming(false);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <PhotoViewer
        talk={talk}
        onEngaged={setEngaged}
        api={api}
        eventId=""
        comments={moment.comments}
        t={t}
        canReact
        canPost
        onClose={onClose}
        onChanged={momentsChanged}
        onOptions={() => setOptions(true)}
        onSendToChat={() => setSendingMoment(moment.id)}
        onDownload={async () => {
          setSaving(photo.id);
          try {
            const { saved } = await saveToCameraRoll(
              [{ id: photo.id, url: photo.original, mime: photo.mime }],
              () => {},
            );
            if (saved === 0) throw new Error('not saved');
          } catch (err) {
            Alert.alert(
              'Could not save it',
              err instanceof Error && err.message.includes('Permission')
                ? err.message
                : 'Try again in a moment.',
            );
          } finally {
            setSaving(null);
          }
        }}
        downloading={saving === photo.id}
        uploader={{
          name: moment.mine ? 'You' : owner.name,
          handle: owner.handle,
          avatarUrl: owner.avatar,
        }}
        onOpenPerson={(handle) => {
          onClose();
          onOpenPerson(handle);
        }}
        onFavourite={async () => {}}
        photos={photos}
        index={at}
        onIndex={setIndex}
        strip={
          <View>
            {moments.length > 1 && (
              <MomentsNav moments={moments} at={at} t={t} onJump={setIndex} />
            )}
            {/* How much of this moment's time has gone: under the tiles, over
                the reaction and comment bar. */}
            <View style={styles.timeTrack}>
              <Animated.View
                style={[
                  styles.timeFill,
                  {
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          </View>
        }
      />

      {/*
        Inside the viewer's modal, for the reason the roll's sheet is: a sheet
        beside a full-screen modal presents underneath it on iOS.
      */}
      {options && (
        <Modal visible animationType="slide" transparent onRequestClose={closeOptions}>
          <Pressable style={styles.backdrop} onPress={closeOptions}>
            <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
              <View style={styles.inner}>
                {moment.mine ? (
                  <Button
                    t={t}
                    label="Remove my moment"
                    onPress={async () => {
                      closeOptions();
                      try {
                        await api.deleteMoment(photo.id);
                        momentsChanged();
                      } catch {
                        Alert.alert('Could not remove it', 'Try again in a moment.');
                      }
                    }}
                  />
                ) : confirming ? (
                  /* The second press says what it does rather than asking
                     "are you sure" about a word — the roll's rule. */
                  <Button
                    t={t}
                    primary
                    label="Block — hide each other everywhere"
                    onPress={async () => {
                      closeOptions();
                      try {
                        await api.blockMomentAuthor(photo.id);
                        momentsChanged();
                      } catch {
                        Alert.alert('Could not block', 'Try again in a moment.');
                      }
                    }}
                  />
                ) : (
                  /* Report first, then block: one tells us, the other only
                     changes what you see — the roll's sheet in that order. */
                  <>
                    <Button
                      t={t}
                      label="Report"
                      onPress={() => {
                        closeOptions();
                        void reportContent(api, 'moment', photo.id);
                      }}
                    />
                    <Button t={t} label="Block this person" onPress={() => setConfirming(true)} />
                  </>
                )}
                <Button t={t} label="Cancel" onPress={closeOptions} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {/* Sending it into a chat, inside this modal so it draws on top. */}
      <ChatPicker
        api={api}
        t={t}
        sending={sendingMoment ? { momentId: sendingMoment } : null}
        onClose={() => setSendingMoment(null)}
      />
    </Modal>
  );
}

/** The tile's outer edge, the ring's widths, and the photograph inside. */
const RING = 66;
const RING_RADIUS = 20;
const RING_LINE = 3;
const SEEN_LINE = 1.5;
/** Ring, then a page-coloured gap of 2, then the photograph. */
const SHOT_INSET = RING_LINE + 2;
/** How far the author's face hangs off the tile's corner. */
const BADGE = 24;
const BADGE_HANG = 5;
/**
 * The strip's padding: enough on every side for the badge that hangs off the
 * corner, so no part of a tile ever meets the edge the scroll view clips at.
 */
const ROW_PAD = BADGE_HANG + 3;
/** Between tiles in the viewer's strip, which is also the step it scrolls by. */
const NAV_GAP = 12;

const styles = StyleSheet.create({
  /*
   * Pulled up against the rolls. Home's scroll spaces every child 26 apart,
   * which is right between two cards and far too much under a strip that
   * belongs to the list below it — the negative margin brings that gap to
   * about 10 without the strip learning what the page's gap is any other way.
   * The row's own padding is part of that 10, which is why it is less than 16.
   */
  rowOuter: { flexShrink: 0, marginTop: -ROW_PAD, marginBottom: -24, marginHorizontal: -ROW_PAD },
  row: { gap: 12, padding: ROW_PAD },
  tile: { width: RING + BADGE_HANG, alignItems: 'flex-start', gap: 6 },
  frame: { width: RING, height: RING },
  shot: {
    position: 'absolute',
    top: SHOT_INSET,
    left: SHOT_INSET,
    width: RING - SHOT_INSET * 2,
    height: RING - SHOT_INSET * 2,
    // The radius inside the ring's, less the inset, so the corners are
    // concentric. On the image itself, which clips its own pixels.
    borderRadius: RING_RADIUS - SHOT_INSET,
  },
  badge: {
    position: 'absolute',
    right: -BADGE_HANG,
    bottom: -BADGE_HANG,
    width: BADGE,
    height: BADGE,
    borderRadius: 8,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeImage: { width: '100%', height: '100%' },
  badgeLetter: { fontSize: 10, fontWeight: '700' },
  name: { fontSize: 12, lineHeight: 16, width: RING, textAlign: 'center' },
  /* The bar under the one on screen. Every tile in the viewer's strip has the
     slot, so the row does not jump by three points when it moves. */
  here: { width: 18, height: 3, borderRadius: 2, alignSelf: 'center', marginRight: BADGE_HANG },
  nav: { gap: NAV_GAP },
  /*
   * Home's bar. The card's surface and hairline, the rolls' own radius, and
   * pulled up against them like the strip it replaces: Home spaces every child
   * 26 apart, and this belongs to the list below it, so 12.
   */
  /* Casts the shadow, and holds the spacing to the rolls. */
  barShadow: { borderRadius: 14, marginBottom: -14 },
  /* The viewer's clock: a hairline track, and white filling it as the time
     goes. Under the tiles, over the reaction and comment bar. */
  timeTrack: {
    height: 2.5,
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  timeFill: { height: '100%', backgroundColor: '#fff' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /* The colour's field: the whole bar and past its edges, so the drift never
     shows where it stops. The mask inside does the fading. */
  bloom: { position: 'absolute', top: '-40%', bottom: '-40%', left: '-6%', right: '-6%' },
  barTitle: { fontSize: 16, fontWeight: '600' },
  barEnd: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barNew: { fontSize: 14.5, fontWeight: '600' },
  /* Secondary to the status: smaller and quieter. */
  barChevron: { fontSize: 18, lineHeight: 20 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  inner: { padding: 16, paddingBottom: 40, gap: 12 },
  addRoot: { flex: 1 },
  /* The same status-bar allowance as the roll's picker. */
  addBar: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addCancel: { color: '#fff', fontSize: 15.5 },
  addTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  addShare: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  addFrame: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  addEmpty: { alignItems: 'center', gap: 10, padding: 32 },
  addPlus: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  addPlusGlyph: { color: '#fff', fontSize: 28, fontWeight: '300' },
  addWhy: { color: '#fff', fontSize: 17, fontWeight: '600' },
  addWhySmall: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  /* The glass blue the photo viewer uses: the accent that reads on white is a
     navy on black. */
  addAgain: { color: '#e3e6ea', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 18 },
});
