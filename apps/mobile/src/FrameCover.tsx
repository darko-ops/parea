/**
 * Between choosing the photographs and naming the album: which one leads, and
 * how it sits.
 *
 * The picker answers "which pictures". The form answers "what was it". This
 * answers the question that fell between them and was never asked: a card on
 * the home screen is a wide letterbox and a phone photograph is a tall
 * rectangle, so something is always cut off — and until now a server-side
 * `position: 'attention'` guessed what. It guesses well on a group shot and
 * badly on the picture somebody actually cares about, and there was no way to
 * disagree with it.
 *
 * ## What is shown is what is stored
 *
 * The window here is the card's own shape — full width, two-thirds as tall,
 * which is 3:2 and is exactly what `ev/<id>/cover.jpg` is encoded at. The
 * position is carried as the two percentages CSS `object-position` takes, so
 * the phone drawing the preview and sharp cropping the upload are running the
 * same rule against the same numbers rather than two approximations of one
 * intention.
 *
 * That also means the default is centred rather than `attention`. Smart-cropped
 * would be the better picture more often than not — and it would be a different
 * picture from the one somebody just looked at and accepted, which is worse
 * than being occasionally worse.
 *
 * ## The row is both controls
 *
 * Tapping a thumbnail promotes it; tapping its ⊗ drops it from the album. The
 * cover used to be "whichever you touched first in the picker", a rule that is
 * invisible while you are picking and irreversible afterwards.
 */

import { Image, type ImageLoadEventData } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { GroupTheme } from './Groups';
import type { LibraryPhoto } from './library';

/**
 * Where the visible window sits over the picture, as CSS `object-position`
 * percentages.
 *
 * 0 is flush left or top, 100 flush right or bottom, 50 centred. Percentages
 * rather than a pixel rect because they survive not knowing the picture's size:
 * the phone reads it off the decoded image, the server reads it off the
 * original, and neither has to agree with the other about anything but this.
 */
export type CoverFraming = { x: number; y: number };

export const CENTRED: CoverFraming = { x: 50, y: 50 };

/** The card's shape, and the shape the cover is stored at. */
export const COVER_ASPECT = 3 / 2;

/**
 * A photograph in the card's window, positioned.
 *
 * Shared with the form on the next screen, which draws the same picture in the
 * same shape and must not disagree with this one about what was framed.
 */
export function CoverFrame({
  uri,
  framing,
  width,
  onNatural,
}: {
  uri: string;
  framing: CoverFraming;
  width: number;
  /** The decoded size, which the dragging needs and the preview does not. */
  onNatural?: (size: { w: number; h: number }) => void;
}) {
  return (
    <Image
      source={{ uri }}
      style={{ width, height: width / COVER_ASPECT }}
      contentFit="cover"
      contentPosition={{ left: `${framing.x}%`, top: `${framing.y}%` }}
      transition={120}
      onLoad={
        onNatural &&
        ((event: ImageLoadEventData) =>
          onNatural({ w: event.source.width, h: event.source.height }))
      }
    />
  );
}

export function FrameCover({
  chosen,
  t,
  dark,
  onCancel,
  onNext,
}: {
  /** What the picker handed over, in the order it was chosen. */
  chosen: LibraryPhoto[];
  t: GroupTheme;
  dark: boolean;
  /** Back to the photographs. */
  onCancel: () => void;
  /**
   * On to the form, with the album's photographs in cover-first order and the
   * framing for the one leading them.
   */
  onNext: (photos: LibraryPhoto[], framing: CoverFraming) => void;
}) {
  const { width } = useWindowDimensions();
  const win = useMemo(() => ({ w: width, h: width / COVER_ASPECT }), [width]);

  const [photos, setPhotos] = useState<LibraryPhoto[]>(chosen);
  const [framing, setFraming] = useState<CoverFraming>(CENTRED);
  /** The decoded size of the cover, once it has decoded. Null before that. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const cover = photos[0] ?? null;

  /*
   * How much picture there is to drag, in screen points.
   *
   * Zero on the axis the photograph already fits — a 3:2 picture in a 3:2
   * window has nothing to reveal sideways, and a drag that moves nothing is
   * better than one that moves something by dividing by zero.
   */
  const slack = useMemo(() => {
    if (!natural) return { x: 0, y: 0 };
    const scale = Math.max(win.w / natural.w, win.h / natural.h);
    return {
      x: Math.max(0, natural.w * scale - win.w),
      y: Math.max(0, natural.h * scale - win.h),
    };
  }, [natural, win.w, win.h]);

  /*
   * The responder is built once and reads everything through refs.
   *
   * `PanResponder.create` on every render hands the view a fresh responder
   * mid-drag and drops the gesture — the same trap `SwipeBack` documents, and
   * worth repeating here because this one is a drag people will make slowly.
   */
  const slackRef = useRef(slack);
  slackRef.current = slack;
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const start = useRef(CENTRED);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = framingRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const { x: sx, y: sy } = slackRef.current;
          /*
           * A finger moving right shows more of the picture's left, so the
           * position percentage goes down — the window travels the opposite
           * way to the hand, which is what makes it feel like moving the
           * photograph rather than moving a crop box over it.
           */
          setFraming({
            x: sx > 0 ? clamp(start.current.x - (gesture.dx / sx) * 100) : 50,
            y: sy > 0 ? clamp(start.current.y - (gesture.dy / sy) * 100) : 50,
          });
        },
      }),
    [],
  );

  /** Promoting a photograph reframes it: the old numbers were about another picture. */
  const promote = useCallback((photo: LibraryPhoto) => {
    setPhotos((was) => [photo, ...was.filter((p) => p.id !== photo.id)]);
    setFraming(CENTRED);
    setNatural(null);
  }, []);

  const drop = useCallback(
    (photo: LibraryPhoto) => {
      setPhotos((was) => {
        const left = was.filter((p) => p.id !== photo.id);
        // Dropping the one in the window hands the window to the next, which
        // has never been framed.
        if (was[0]?.id === photo.id) {
          setFraming(CENTRED);
          setNatural(null);
        }
        return left;
      });
    },
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      <View style={styles.bar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.barSide, { color: t.accent }]}>Back</Text>
        </Pressable>
        <Text style={[styles.barTitle, { color: t.fg }]}>Cover</Text>
        <Pressable
          onPress={() => onNext(photos, framing)}
          disabled={photos.length === 0}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityState={{ disabled: photos.length === 0 }}
        >
          <Text
            style={[
              styles.barDo,
              { color: photos.length > 0 ? t.accent : t.dim },
            ]}
          >
            Next
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/*
          Full-bleed and exactly the card's shape, because the promise this
          screen makes is that this is the picture the home screen will show. A
          window inset in a margin would be a smaller version of a different
          rectangle.
        */}
        {cover && (
          <View
            style={[styles.window, { width: win.w, height: win.h }]}
            {...pan.panHandlers}
          >
            <CoverFrame
              uri={cover.uri}
              framing={framing}
              width={win.w}
              onNatural={setNatural}
            />
          </View>
        )}

        <Text style={[styles.hint, { color: t.dim }]}>
          {slack.x > 0 || slack.y > 0
            ? 'Drag the photo to choose what shows on your home screen.'
            : 'This one fits the card exactly — nothing to move.'}
        </Text>

        {/*
          Both controls in one row, because they are both about the same object
          and a second row of the same pictures would be a second answer to
          "which photographs is this album".
        */}
        <View style={styles.rowHead}>
          <Text style={[styles.label, { color: t.dim }]}>IN THIS ALBUM</Text>
          <Text style={[styles.hint, { color: t.dim }]}>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {photos.map((photo, index) => (
            <View key={photo.id} style={styles.cell}>
              <Pressable
                onPress={() => promote(photo)}
                accessibilityRole="button"
                accessibilityLabel={
                  index === 0 ? 'Cover photo' : 'Use this as the cover'
                }
                accessibilityState={{ selected: index === 0 }}
                style={[
                  styles.thumb,
                  {
                    borderColor: index === 0 ? t.accent : 'transparent',
                    borderWidth: index === 0 ? 2 : 0,
                  },
                ]}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.thumbShot}
                  contentFit="cover"
                  transition={100}
                />
              </Pressable>
              {/*
                Outside the picture's corner rather than on it: a ⊗ drawn over
                a thumbnail is a ⊗ over somebody's face as often as not, and
                the two controls have to be tellable apart by thumb.
              */}
              <Pressable
                onPress={() => drop(photo)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                style={[styles.remove, { backgroundColor: t.fg }]}
              >
                <Text style={[styles.removeMark, { color: t.bg }]}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {photos.length === 0 && (
          <Text style={[styles.hint, { color: t.dim }]}>
            Nothing left. Go back and choose some photographs, or make the album
            without any and add them later.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* The same 60pt status-bar allowance the picker and the group page use, so
     the three screens this flow can show start their bars at one height. */
  bar: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barSide: { fontSize: 15.5 },
  barTitle: { fontSize: 16, fontWeight: '600' },
  barDo: { fontSize: 15.5, fontWeight: '700' },
  scroll: { paddingBottom: 48, gap: 12 },
  /* `overflow: hidden` is the frame: the picture inside is larger than this on
     at least one axis, and that overhang is what there is to drag. */
  window: { overflow: 'hidden', backgroundColor: '#8881' },
  hint: { fontSize: 13, lineHeight: 19, paddingHorizontal: 20 },
  rowHead: {
    paddingHorizontal: 20,
    paddingTop: 6,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7 },
  strip: { paddingHorizontal: 20, paddingTop: 8, paddingRight: 28, gap: 14 },
  /* Room above and right of each tile for the ⊗ to sit outside the picture. */
  cell: { paddingTop: 8, paddingRight: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  thumbShot: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeMark: { fontSize: 14, fontWeight: '700', lineHeight: 16 },
});
