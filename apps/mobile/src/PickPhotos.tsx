/**
 * Choosing the photographs first, and then saying what they were.
 *
 * Making an album used to begin with a form: a name, a place, a cover, and a
 * question about when it happened — four answers before the product had seen a
 * single photograph. This is the other way round, which is the order the thing
 * actually happens in: these are the pictures, *then* that was the evening.
 *
 * ## Why the big one is above the grid
 *
 * Because a thumbnail 120 points across cannot be judged. The grid is for
 * finding, the frame above it is for looking — and the one you last touched is
 * the one in the frame, so tapping along the grid is how you go through them.
 * The shape is borrowed openly: it is the one every phone photographer already
 * knows, and a picker that invents its own layout is a picker people have to
 * read.
 *
 * ## What it hands on
 *
 * Ids, and the window they cover. The window is the answer to a question this
 * flow used to ask out loud — "when was it?" — and somebody who has just chosen
 * the evening's photographs has already answered it, more precisely than a
 * phrase resolved to a six-hour box. Nothing is uploaded here; `resolveForUpload`
 * turns these into files later, behind the form.
 */

import { MAX_PER_SELECTION } from '@parea/upload';
import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { GroupTheme } from './Groups';
import {
  libraryAccess,
  recentPhotos,
  requestLibraryAccess,
  type LibraryAccess,
  type LibraryPhoto,
} from './library';
import { Waiting } from './Waiting';

/** Tiles per row. Three is the contact-sheet convention and fits a thumb. */
const COLUMNS = 3;

/** Hairlines between tiles, so the grid reads as a sheet rather than as cards. */
const GAP = 2;

/** How many to fetch at a time. A screenful and a bit. */
const PAGE = 60;

/** The frame, collapsed: a strip with the photograph in it and a handle. */
const PEEK = 64;

/** The scrubber's handle, and how long it stays after the scrolling stops. */
const THUMB = 44;
const SCRUBBER_LINGER_MS = 1500;

/**
 * The date at a point in the library, as the scrubber's bubble says it.
 *
 * The day for this year — "28 Sep" — because that is how somebody finds last
 * Saturday; the month and year further back — "Sep 2024" — because nobody
 * scrubbing two years down is looking for a day.
 */
function scrubLabel(takenAt: number | null, now = new Date()): string {
  if (takenAt == null) return '';
  const d = new Date(takenAt);
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function PickPhotos({
  t,
  Button,
  onCancel,
  onNext,
}: {
  t: GroupTheme;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
  onCancel: () => void;
  /** The chosen photographs, in the order they were chosen. */
  onNext: (chosen: LibraryPhoto[]) => void;
}) {
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  const [access, setAccess] = useState<LibraryAccess>('undetermined');
  const [photos, setPhotos] = useState<LibraryPhoto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /*
   * Chosen, in the order chosen.
   *
   * An array rather than a set, because the order is information: the first one
   * picked leads the album, and a set would hand them back in whatever order
   * the library happened to list them.
   */
  const [chosen, setChosen] = useState<LibraryPhoto[]>([]);
  /** Which one is in the frame. The last one touched, chosen or not. */
  const [showing, setShowing] = useState<LibraryPhoto | null>(null);

  /*
   * The frame folds away.
   *
   * It is a square the width of the phone, which leaves a grid two rows tall
   * on a small screen — fine for judging one photograph, hopeless for finding
   * the next. So it collapses to a strip: swipe it up, or simply scroll the
   * grid down, the way every photo picker on the phone behaves. It comes back
   * when it is pulled down, tapped, the grid is pulled past its top, or a
   * photograph is tapped — that last one because tapping a tile is asking to
   * see it.
   */
  const [collapsed, setCollapsed] = useState(false);
  const frameHeight = useRef(new Animated.Value(width)).current;
  const fold = useCallback(
    (shut: boolean) => {
      setCollapsed(shut);
      Animated.spring(frameHeight, {
        toValue: shut ? PEEK : width,
        useNativeDriver: false,
        bounciness: 0,
        speed: 18,
      }).start();
    },
    [frameHeight, width],
  );
  const frameGesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderRelease: (_, g) => {
          if (g.dy < -24) fold(true);
          else if (g.dy > 24) fold(false);
        },
      }),
    [fold],
  );

  /*
   * The scrubber: a handle on the right edge, and the date where it is.
   *
   * The library loads sixty at a time, so the handle measures what has loaded,
   * and dragging it toward the bottom loads the next page as the grid reaches
   * it — the way down is the same one scrolling takes. It shows while the grid
   * moves and for a moment after, as the phone's own Photos does.
   */
  const list = useRef<FlatList<LibraryPhoto>>(null);
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const offset = useRef(0);
  const lastOffset = useRef(0);
  const thumbTop = useRef(new Animated.Value(0)).current;
  const scrubberOpacity = useRef(new Animated.Value(0)).current;
  const [label, setLabel] = useState('');
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowHeight = tile + GAP;
  const travel = Math.max(1, viewport - THUMB);
  const scrollable = Math.max(1, contentHeight - viewport);

  const showScrubber = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(scrubberOpacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }, [scrubberOpacity]);
  const lingerScrubber = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(scrubberOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }, SCRUBBER_LINGER_MS);
  }, [scrubberOpacity]);
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  /** The date of the row at the top of the grid, for `y` scrolled. */
  const labelAt = useCallback(
    (y: number) => {
      const row = Math.max(0, Math.floor(y / rowHeight));
      const photo = photos?.[Math.min(row * COLUMNS, (photos?.length ?? 1) - 1)];
      return scrubLabel(photo?.takenAt ?? null);
    },
    [photos, rowHeight],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      offset.current = y;
      if (!dragging) thumbTop.setValue(Math.min(travel, Math.max(0, (y / scrollable) * travel)));
      setLabel(labelAt(y));
      // Scrolling down into the grid folds the frame; pulling past the top of
      // the grid opens it again.
      if (!collapsed && y > lastOffset.current + 12 && y > 24) fold(true);
      else if (collapsed && y < -48) fold(false);
      lastOffset.current = y;
    },
    [collapsed, dragging, fold, labelAt, scrollable, thumbTop, travel],
  );

  const scrubGesture = useMemo(() => {
    let start = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start = Math.min(travel, Math.max(0, (offset.current / scrollable) * travel));
        setDragging(true);
        showScrubber();
      },
      onPanResponderMove: (_, g) => {
        const top = Math.min(travel, Math.max(0, start + g.dy));
        thumbTop.setValue(top);
        const y = (top / travel) * scrollable;
        list.current?.scrollToOffset({ offset: y, animated: false });
        setLabel(labelAt(y));
      },
      onPanResponderRelease: () => {
        setDragging(false);
        lingerScrubber();
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        lingerScrubber();
      },
    });
  }, [labelAt, lingerScrubber, scrollable, showScrubber, thumbTop, travel]);

  useEffect(() => {
    void (async () => {
      let state = await libraryAccess();
      // Asked on arrival rather than behind a button: this screen is nothing
      // but the library, so there is no version of it that works without.
      if (state === 'undetermined') state = await requestLibraryAccess();
      setAccess(state);
      if (state === 'denied') {
        setPhotos([]);
        return;
      }
      const first = await recentPhotos(PAGE);
      setPhotos(first.photos);
      setNext(first.next);
      // The newest is in the frame before anybody touches anything: an empty
      // frame over a full grid looks like something failed to load.
      setShowing(first.photos[0] ?? null);
    })();
  }, []);

  const more = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await recentPhotos(PAGE, next);
      setPhotos((was) => [...(was ?? []), ...page.photos]);
      setNext(page.next);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, next]);

  const toggle = useCallback((photo: LibraryPhoto) => {
    setShowing(photo);
    // Tapping a tile is asking to see it: the frame opens if it was folded.
    if (collapsed) fold(false);
    setChosen((was) => {
      if (was.some((p) => p.id === photo.id)) return was.filter((p) => p.id !== photo.id);
      // Full is full — see `MAX_PER_SELECTION`. The tap still puts the
      // photograph in the frame; it just does not add it.
      if (was.length >= MAX_PER_SELECTION) return was;
      return [...was, photo];
    });
  }, [collapsed, fold]);

  if (photos === null) {
    return (
      <View style={[styles.root, styles.centre, { backgroundColor: t.bg }]}>
        <StatusBar style="light" />
        <Waiting size={40} />
      </View>
    );
  }

  if (access === 'denied') {
    return (
      <View style={[styles.root, styles.centre, { backgroundColor: t.bg }]}>
        <StatusBar style="light" />
        <Text style={[styles.why, { color: t.fg }]}>
          Parea cannot see your photos.
        </Text>
        <Text style={[styles.whySmall, { color: t.dim }]}>
          Allow access in Settings to choose from your library — or carry on and
          make the roll now, and add photographs to it afterwards.
        </Text>
        <View style={styles.denied}>
          <Button label="Carry on without" t={t} primary onPress={() => onNext([])} />
          <Button label="Back" t={t} onPress={onCancel} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      {/* White ink: the frame below is a photograph on black, whatever the
          app's theme is. A picker is judged against the pictures in it. */}
      <StatusBar style="light" />

      <View style={styles.bar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={styles.barCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.barTitle}>New roll</Text>
        <Pressable
          onPress={() => onNext(chosen)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={
            chosen.length > 0 ? `Next, with ${chosen.length} chosen` : 'Next, with none chosen'
          }
        >
          {/*
            Always live, even with nothing chosen.

            An album with no photographs in it yet is a real thing — somebody
            making one before the evening, or to hand the link out at it — and
            this screen is not the place to refuse that. The button says how
            many so the count is never a surprise on the next page.
          */}
          <Text style={styles.barNext}>
            Next{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </Text>
        </Pressable>
      </View>

      {chosen.length >= MAX_PER_SELECTION && (
        <Text style={[styles.whySmall, styles.full]}>
          Up to {MAX_PER_SELECTION} at a time. Add the rest after these are in.
        </Text>
      )}

      {/*
        The one you last touched, big.

        Square, and `contain` rather than `cover`: the frame is for judging a
        photograph, and cropping the thing being judged defeats it. A portrait
        shot gets bars either side, which is the honest rendering.
      */}
      <Animated.View style={[styles.frame, { height: frameHeight }]} {...frameGesture.panHandlers}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapsed ? () => fold(false) : undefined}
          disabled={!collapsed}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Show the photo bigger' : undefined}
        >
          {showing ? (
            <ExpoImage
              source={{ uri: showing.uri }}
              style={StyleSheet.absoluteFill}
              // Folded, the strip is a glimpse rather than a judgement, so it
              // fills the strip; open, `contain`, for the reason above.
              contentFit={collapsed ? 'cover' : 'contain'}
              transition={120}
            />
          ) : (
            <Text style={styles.whySmall}>Nothing on this phone to choose from.</Text>
          )}
        </Pressable>
        {/* The handle says the frame moves; it is where a thumb goes to fold it. */}
        <View style={styles.handleWrap} pointerEvents="none">
          <View style={styles.handle} />
        </View>
      </Animated.View>

      <View style={styles.gridWrap} onLayout={(e) => setViewport(e.nativeEvent.layout.height)}>
      <FlatList
        ref={list}
        data={photos}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={showScrubber}
        onScrollEndDrag={lingerScrubber}
        onMomentumScrollEnd={lingerScrubber}
        onContentSizeChange={(_, h) => setContentHeight(h)}
        showsVerticalScrollIndicator={false}
        keyExtractor={(photo) => photo.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: 40 }}
        onEndReached={() => void more()}
        onEndReachedThreshold={1.5}
        ListEmptyComponent={
          <Text style={[styles.whySmall, styles.empty]}>
            No photographs on this phone yet.
          </Text>
        }
        renderItem={({ item }) => {
          const at = chosen.findIndex((p) => p.id === item.id);
          const on = at > -1;
          return (
            <Pressable
              onPress={() => toggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={{ width: tile, height: tile }}
            >
              <ExpoImage
                source={{ uri: item.uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                // No transition: a grid of sixty fading in on scroll is a grid
                // that looks like it is struggling.
                transition={0}
              />
              {/*
                The number, not a tick.

                Which order they were chosen in is the order they will be in,
                and the first one leads the album — so the badge says where this
                one sits rather than merely that it is in.
              */}
              {on && (
                <>
                  <View style={styles.chosenWash} />
                  <View style={[styles.badge, { backgroundColor: t.accent }]}>
                    <Text style={[styles.badgeText, { color: t.onAccent }]}>{at + 1}</Text>
                  </View>
                </>
              )}
            </Pressable>
          );
        }}
      />
      {/*
        The scrubber, over the grid's right edge. Only once there is more than
        a screenful to move through.
      */}
      {contentHeight > viewport * 1.5 && (
        <Animated.View
          style={[styles.scrubber, { opacity: scrubberOpacity }]}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[styles.thumbRow, { transform: [{ translateY: thumbTop }] }]}
            {...scrubGesture.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel={label ? `Scroll by date, at ${label}` : 'Scroll by date'}
          >
            {label !== '' && (
              <View style={[styles.bubble, dragging && styles.bubbleDragging]}>
                <Text style={styles.bubbleText}>{label}</Text>
              </View>
            )}
            <View style={[styles.thumb, { backgroundColor: t.accent }]}>
              <View style={[styles.thumbGrip, { backgroundColor: t.onAccent }]} />
              <View style={[styles.thumbGrip, { backgroundColor: t.onAccent }]} />
            </View>
          </Animated.View>
        </Animated.View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  why: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  whySmall: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: 'rgba(255,255,255,0.7)' },
  denied: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
  empty: { padding: 32 },
  full: { paddingHorizontal: 16, paddingBottom: 10 },
  /* The same 72pt status-bar allowance every screen in this project starts at. */
  bar: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barCancel: { color: '#fff', fontSize: 15.5 },
  barTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  barNext: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  frame: {
    width: '100%',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  handleWrap: { position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  gridWrap: { flex: 1 },
  /* A column down the right edge, as tall as the grid; the handle moves in it. */
  scrubber: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 160 },
  thumbRow: {
    position: 'absolute',
    top: 0,
    right: 4,
    height: THUMB,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thumb: {
    width: 28,
    height: THUMB,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thumbGrip: { width: 10, height: 2, borderRadius: 1, opacity: 0.8 },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,20,0.86)',
  },
  bubbleDragging: { backgroundColor: 'rgba(20,20,20,0.96)' },
  bubbleText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  /* Chosen tiles are dimmed rather than outlined: a border on a 129pt tile in a
     grid with 2pt gutters reads as the gutter changing colour. */
  chosenWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
