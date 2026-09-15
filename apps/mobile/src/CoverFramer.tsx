/**
 * Confirming how the cover sits, on the photograph already chosen.
 *
 * The first picture chosen leads the album — that rule is older than this
 * screen and this screen does not touch it. What it asks is the question that
 * came after and was never asked: a card on the home screen is a wide letterbox
 * and a phone photograph is a tall rectangle, so something is always cut off,
 * and nobody had ever been shown which part.
 *
 * ## Why this is not the system cropper
 *
 * `ImagePicker`'s `allowsEditing` is the obvious answer and cannot be used
 * here: iOS offers that crop UI only as part of *picking*, and there is no
 * public way to hand it an asset you already hold. Reaching for it anyway
 * means opening the library again, which is the whole camera roll in front of
 * somebody who chose these photographs ten seconds ago — "the same act,
 * twice", which is the note left behind when the old `EVENT COVER` field was
 * deleted for doing exactly that.
 *
 * So the shape is borrowed rather than the component: the whole photograph, a
 * fixed frame over it, everything outside the frame dimmed but still visible,
 * and the picture moves under it. Seeing what is being left out is the
 * difference between framing a photograph and guessing at a letterbox.
 *
 * ## What it produces
 *
 * Two numbers, not a cropped file. They are the CSS `object-position`
 * percentages — 0 flush to the left or top, 100 flush to the right or bottom —
 * and `apps/web/src/cover.ts` cuts the stored cover with the same rule. So the
 * original is uploaded untouched and the framing is a fact about it, which is
 * what lets somebody come back and reframe without the picture having been
 * through a lossy round trip in between.
 */

import { Image, type ImageLoadEventData } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { GroupTheme } from './Groups';

/** Where the window sits over the picture, as `object-position` percentages. */
export type CoverFraming = { x: number; y: number };

export const CENTRED: CoverFraming = { x: 50, y: 50 };

/**
 * The shapes a cover may be, as width over height.
 *
 * The same two bounds the encoder applies — `COVER_WIDEST` and `COVER_TALLEST`
 * in `apps/web/src/cover.ts`. A cover takes its picture's own shape between
 * them, so most photographs are not cut at all and the frame below is the whole
 * picture; what the bounds stop is a panorama becoming a hairline and a
 * screenshot becoming a card and a half tall.
 */
export const COVER_WIDEST = 3 / 2;
export const COVER_TALLEST = 4 / 5;

/** What a cover of this picture will be shaped like. Null before it has loaded. */
export function coverAspect(natural: { w: number; h: number } | null): number {
  if (!natural || natural.h <= 0) return COVER_WIDEST;
  return Math.min(COVER_WIDEST, Math.max(COVER_TALLEST, natural.w / natural.h));
}

export function CoverFramer({
  uri,
  initial = CENTRED,
  t,
  onCancel,
  onConfirm,
}: {
  /** The photograph leading the album. */
  uri: string;
  /** Where it sat last time, for somebody coming back to change their mind. */
  initial?: CoverFraming;
  t: GroupTheme;
  onCancel: () => void;
  onConfirm: (framing: CoverFraming) => void;
}) {
  const { width, height } = useWindowDimensions();

  const [framing, setFraming] = useState<CoverFraming>(initial);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  /*
   * The frame is the card, and the stage is bigger than the frame.
   *
   * That difference is the point: the overhang has to be somewhere a person can
   * see it, or this is the letterbox again with extra steps. For most
   * photographs there is now no overhang at all — the frame is the picture —
   * and this screen says so rather than pretending there is a decision.
   */
  const frame = useMemo(() => {
    const w = width - 32;
    return { w, h: w / coverAspect(natural) };
  }, [width, natural]);
  const stage = useMemo(
    () => ({ w: width, h: Math.min(height * 0.62, frame.h * 1.6) }),
    [width, height, frame.h],
  );


  /** The picture at the size that covers the frame, and what hangs over it. */
  const shot = useMemo(() => {
    if (!natural) return null;
    const scale = Math.max(frame.w / natural.w, frame.h / natural.h);
    const w = natural.w * scale;
    const h = natural.h * scale;
    return { w, h, slackX: Math.max(0, w - frame.w), slackY: Math.max(0, h - frame.h) };
  }, [natural, frame.w, frame.h]);

  /*
   * Built once and read through refs. `PanResponder.create` on every render
   * hands the view a fresh responder mid-drag and drops the gesture — the trap
   * `SwipeBack` documents, and this is a drag people make slowly.
   */
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const start = useRef(initial);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = framingRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const current = shotRef.current;
          if (!current) return;
          /*
           * A finger moving right shows more of the picture's left, so the
           * percentage goes down — the frame travels the opposite way to the
           * hand, which is what makes this feel like moving the photograph
           * rather than dragging a box across it.
           *
           * An axis with no overhang stays centred rather than dividing by
           * zero: a 3:2 photograph has nothing to reveal sideways.
           */
          setFraming({
            x:
              current.slackX > 0
                ? clamp(start.current.x - (gesture.dx / current.slackX) * 100)
                : 50,
            y:
              current.slackY > 0
                ? clamp(start.current.y - (gesture.dy / current.slackY) * 100)
                : 50,
          });
        },
      }),
    [],
  );

  const onLoad = useCallback((event: ImageLoadEventData) => {
    setNatural({ w: event.source.width, h: event.source.height });
  }, []);

  // Where the frame sits in the stage, and the picture relative to it.
  const frameLeft = (stage.w - frame.w) / 2;
  const frameTop = (stage.h - frame.h) / 2;
  const left = shot ? frameLeft - shot.slackX * (framing.x / 100) : frameLeft;
  const top = shot ? frameTop - shot.slackY * (framing.y / 100) : frameTop;

  const movable = Boolean(shot && (shot.slackX > 0 || shot.slackY > 0));

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.root, { backgroundColor: '#000' }]}>
        <View style={styles.bar}>
          <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
            <Text style={styles.barSide}>Cancel</Text>
          </Pressable>
          <Text style={styles.barTitle}>Cover</Text>
          <Pressable
            onPress={() => onConfirm(framing)}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={[styles.barDo, { color: t.accent }]}>Use</Text>
          </Pressable>
        </View>

        <View style={[styles.stage, { width: stage.w, height: stage.h }]} {...pan.panHandlers}>
          {/*
            The whole photograph, at the size that covers the frame. Not clipped
            to it: what is outside is the thing being given up, and a person
            deciding that has to be able to see it.
          */}
          <Image
            source={{ uri }}
            style={{
              position: 'absolute',
              left,
              top,
              width: shot?.w ?? frame.w,
              height: shot?.h ?? frame.h,
            }}
            contentFit="fill"
            transition={120}
            onLoad={onLoad}
          />

          {/*
            Four rectangles rather than one with a hole in it, because React
            Native has no hole. They are what makes the frame read as a frame.
          */}
          <View style={[styles.scrim, { left: 0, top: 0, right: 0, height: frameTop }]} />
          <View style={[styles.scrim, { left: 0, bottom: 0, right: 0, height: frameTop }]} />
          <View
            style={[styles.scrim, { left: 0, top: frameTop, width: frameLeft, height: frame.h }]}
          />
          <View
            style={[styles.scrim, { right: 0, top: frameTop, width: frameLeft, height: frame.h }]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.frame,
              { left: frameLeft, top: frameTop, width: frame.w, height: frame.h },
            ]}
          />
        </View>

        <Text style={styles.hint}>
          {movable
            ? 'Drag the photo to choose what shows on the card.'
            : 'This one fits the card exactly — nothing to move.'}
        </Text>
      </View>
    </Modal>
  );
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center' },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /* White ink throughout: this screen is a photograph on black, whatever the
     app's theme is, for the same reason the picker is. */
  barSide: { color: '#fff', fontSize: 15.5 },
  barTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  barDo: { fontSize: 15.5, fontWeight: '700' },
  stage: { alignSelf: 'center', overflow: 'hidden' },
  scrim: { position: 'absolute', backgroundColor: '#000000b0' },
  frame: { position: 'absolute', borderWidth: 1, borderColor: '#ffffffcc' },
  hint: {
    color: '#ffffffb0',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
  },
});
