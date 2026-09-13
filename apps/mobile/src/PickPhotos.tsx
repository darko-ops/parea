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

import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
    setChosen((was) =>
      was.some((p) => p.id === photo.id)
        ? was.filter((p) => p.id !== photo.id)
        : [...was, photo],
    );
  }, []);

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
          make the album now, and add photographs to it afterwards.
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
        <Text style={styles.barTitle}>New album</Text>
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

      {/*
        The one you last touched, big.

        Square, and `contain` rather than `cover`: the frame is for judging a
        photograph, and cropping the thing being judged defeats it. A portrait
        shot gets bars either side, which is the honest rendering.
      */}
      <View style={[styles.frame, { height: width }]}>
        {showing ? (
          <ExpoImage
            source={{ uri: showing.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
          />
        ) : (
          <Text style={styles.whySmall}>Nothing on this phone to choose from.</Text>
        )}
      </View>

      <FlatList
        data={photos}
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
  frame: { width: '100%', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
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
