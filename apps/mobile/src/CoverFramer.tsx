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
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { GroupTheme } from './Groups';

/**
 * Where the window sits over the picture, and how much of it the window holds.
 *
 * `x` and `y` are the `object-position` percentages; `zoom` shrinks the window
 * they place, so the two compose rather than one replacing the other. See
 * `apps/web/src/cover.ts`, which cuts the stored cover from the same numbers.
 */
export type CoverFraming = { x: number; y: number; zoom: number };

/**
 * A picture this screen can put in the frame.
 *
 * Two fields, because two very different things are offered here: photographs
 * chosen off the camera roll on the way into a new album, and photographs
 * already in an existing one. `uri` is whatever draws — a `ph://` asset or a
 * signed URL — and `full` is what should be *sent* when it is not the same
 * thing, which is the remote case: the thumbnail in the strip is 320 pixels
 * across and a cover cut from it would be a cover of a thumbnail.
 */
export type CoverCandidate = {
  id: string;
  uri: string;
  /** What to upload, where that is not `uri`. The local case leaves it unset. */
  full?: string;
};

export const CENTRED: CoverFraming = { x: 50, y: 50, zoom: 1 };

/**
 * How far in somebody may frame.
 *
 * Past this the stored 1200px is being made from fewer than 1200 source pixels
 * of an ordinary phone photograph, and a cover softer than the picture it came
 * from is not a closer look at it. The server clamps to the same number.
 */
export const MAX_ZOOM = 4;

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

/**
 * Where the picture sits, and how big it is drawn, for a given framing.
 *
 * One formula, two renderers: this screen draws the overhang dimmed around the
 * frame, and the form draws the same placement clipped to it. Written twice they
 * would agree until somebody changed one, and the symptom would be a preview
 * that is not the cover — which is the exact failure this whole mechanism
 * exists to prevent.
 */
export function placement(
  natural: { w: number; h: number },
  box: { w: number; h: number },
  framing: CoverFraming,
): { w: number; h: number; slackX: number; slackY: number; left: number; top: number } {
  const scale = Math.max(box.w / natural.w, box.h / natural.h) * framing.zoom;
  const w = natural.w * scale;
  const h = natural.h * scale;
  const slackX = Math.max(0, w - box.w);
  const slackY = Math.max(0, h - box.h);
  return {
    w,
    h,
    slackX,
    slackY,
    left: -slackX * (framing.x / 100),
    top: -slackY * (framing.y / 100),
  };
}

/**
 * The cover as the card will draw it: clipped to the frame, nothing outside.
 *
 * What the form shows above the caption. Not `contentFit` and
 * `contentPosition`, which was enough while position was the only thing being
 * chosen and cannot express a zoom — the window's *size* moves now, and only
 * `placement` knows it.
 */
export function CoverShot({
  uri,
  natural,
  framing,
  width,
  onNatural,
}: {
  uri: string;
  /** Null until the picture has decoded, which is what `onNatural` reports. */
  natural: { w: number; h: number } | null;
  framing: CoverFraming;
  width: number;
  onNatural?: (size: { w: number; h: number }) => void;
}) {
  const box = { w: width, h: width / coverAspect(natural) };
  const shot = natural ? placement(natural, box, framing) : null;

  return (
    <View style={{ width: box.w, height: box.h, overflow: 'hidden' }}>
      <Image
        source={{ uri }}
        style={
          shot
            ? { position: 'absolute', left: shot.left, top: shot.top, width: shot.w, height: shot.h }
            : { width: box.w, height: box.h }
        }
        // Only until it has been measured; `shot` sizes it exactly after that.
        contentFit="cover"
        transition={120}
        onLoad={(event: ImageLoadEventData) =>
          onNatural?.({ w: event.source.width, h: event.source.height })
        }
      />
    </View>
  );
}

export function CoverFramer({
  photos,
  coverId,
  initial = CENTRED,
  t,
  stripLabel = 'IN THIS ALBUM',
  onCancel,
  onConfirm,
}: {
  /**
   * The photographs another one can be tried from.
   *
   * Which photograph leads is a question you cannot answer without seeing it
   * in the frame — a picture that is the obvious choice in a grid of
   * thumbnails is often the wrong one once it is a card, and finding that out
   * used to mean backing out of here, tapping a different tile, and coming in
   * again to look.
   *
   * An id and something to draw, and deliberately no more. This began as
   * `LibraryPhoto[]`, which is a camera roll asset — right for the create
   * screen, where the album does not exist yet, and wrong for the other caller
   * this screen now has: changing the cover of an album that is already there
   * frames its *own* photographs, which live on the server and arrive as
   * signed URLs. Narrowing the prop to what is actually drawn is what lets one
   * screen serve both without learning the difference.
   */
  photos: CoverCandidate[];
  /** Which of them leads at the moment. */
  coverId: string;
  /** Where it sat last time, for somebody coming back to change their mind. */
  initial?: CoverFraming;
  t: GroupTheme;
  /**
   * What the row of thumbnails is.
   *
   * "IN THIS ALBUM" is true of both callers and reads differently in each: on
   * the create screen it is the photographs about to be uploaded, and on an
   * existing album it is the ones already there. The default is the older
   * caller's words.
   */
  stripLabel?: string;
  onCancel: () => void;
  /**
   * Both answers at once, and only on `Use`.
   *
   * Trying a photograph in the frame is not choosing it: Cancel has to put back
   * the cover *and* the framing this opened with, which it cannot do if trying
   * one had already changed the album.
   */
  onConfirm: (coverId: string, framing: CoverFraming) => void;
}) {
  const { width, height } = useWindowDimensions();

  const [chosen, setChosen] = useState(coverId);
  // The framing that arrived describes the photograph that arrived. Trying
  // another starts it centred, which is the only honest default for a picture
  // nobody has framed.
  const [framing, setFraming] = useState<CoverFraming>(initial);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const cover = photos.find((photo) => photo.id === chosen) ?? photos[0] ?? null;

  const tryPhoto = useCallback(
    (photo: CoverCandidate) => {
      if (photo.id === chosen) return;
      setChosen(photo.id);
      // Zoom goes back with the position: it was how close somebody stood to a
      // different picture.
      setFraming(photo.id === coverId ? initial : CENTRED);
      // Another picture, another shape — and the frame is sized off this.
      setNatural(null);
    },
    [chosen, coverId, initial],
  );

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


  /**
   * The picture at the size it is drawn, and what hangs over the frame.
   *
   * `zoom` multiplies the scale that merely covers the frame, so 1 is "as
   * little as will do" and everything above it is overhang to drag through.
   * That is also why zoom makes framing meaningful for a photograph already
   * inside the bounds: at 1 there is nothing to move, and at 2 there is half
   * the picture.
   */
  const shot = useMemo(
    () => (natural ? placement(natural, frame, framing) : null),
    [natural, frame, framing],
  );

  /*
   * Built once and read through refs. `PanResponder.create` on every render
   * hands the view a fresh responder mid-drag and drops the gesture — the trap
   * `SwipeBack` documents, and this is a drag people make slowly.
   */
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const framingRef = useRef(framing);
  framingRef.current = framing;
  /** The framing, and the gesture offset, as they were when the hand last settled. */
  const start = useRef({ framing: initial, dx: 0, dy: 0 });
  /** The finger spread a pinch began at, or null while one finger is down. */
  const pinch = useRef<{ span: number; zoom: number } | null>(null);
  const fingers = useRef(0);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = { framing: framingRef.current, dx: 0, dy: 0 };
          pinch.current = null;
          fingers.current = 0;
        },
        onPanResponderMove: (event, gesture) => {
          const current = shotRef.current;
          if (!current) return;
          const touches = event.nativeEvent.touches;

          /*
           * Re-based whenever the hand changes shape.
           *
           * `gesture.dx` counts from the first finger down, and a second finger
           * landing or leaving does not reset it — so without this, lifting one
           * finger after a pinch makes the picture leap by however far the
           * gesture had travelled. Everything is measured from the last moment
           * the touch count was stable instead.
           */
          if (touches.length !== fingers.current) {
            fingers.current = touches.length;
            start.current = {
              framing: framingRef.current,
              dx: gesture.dx,
              dy: gesture.dy,
            };
            pinch.current = null;
          }

          if (touches.length >= 2) {
            const span = spanOf(touches[0]!, touches[1]!);
            // The first move with two fingers down only records where they
            // started; zooming from a span of nothing is a jump to the cap.
            if (!pinch.current || pinch.current.span <= 0) {
              pinch.current = { span, zoom: start.current.framing.zoom };
              return;
            }
            setFraming((was) => ({
              ...was,
              zoom: clampZoom((pinch.current!.zoom * span) / pinch.current!.span),
            }));
            return;
          }

          /*
           * A finger moving right shows more of the picture's left, so the
           * percentage goes down — the frame travels the opposite way to the
           * hand, which is what makes this feel like moving the photograph
           * rather than dragging a box across it.
           *
           * An axis with no overhang stays centred rather than dividing by
           * zero: a photograph inside the bounds, at zoom 1, has nothing to
           * reveal either way.
           */
          const dx = gesture.dx - start.current.dx;
          const dy = gesture.dy - start.current.dy;
          setFraming((was) => ({
            ...was,
            x:
              current.slackX > 0
                ? clamp(start.current.framing.x - (dx / current.slackX) * 100)
                : 50,
            y:
              current.slackY > 0
                ? clamp(start.current.framing.y - (dy / current.slackY) * 100)
                : 50,
          }));
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
  const left = frameLeft + (shot?.left ?? 0);
  const top = frameTop + (shot?.top ?? 0);

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
            onPress={() => cover && onConfirm(cover.id, framing)}
            disabled={!cover}
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
            source={{ uri: cover?.uri ?? '' }}
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
            ? 'Drag to move it, pinch to zoom in.'
            : 'This one fits the card exactly. Pinch to zoom in.'}
        </Text>

        {/*
          The album, so a different photograph can be tried in the frame.

          No ⊗ here, unlike the same row on the form. This screen is about which
          picture leads and how it sits; throwing one out of the album is a
          different decision, and offering it on a black screen next to a
          control that only changes what is *shown* would put two very different
          outcomes a thumb's width apart.
        */}
        {photos.length > 1 && (
          <View style={styles.strip}>
            <Text style={styles.stripLabel}>{stripLabel}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stripRow}
            >
              {photos.map((photo) => {
                const leading = photo.id === chosen;
                return (
                  <Pressable
                    key={photo.id}
                    onPress={() => tryPhoto(photo)}
                    accessibilityRole="button"
                    accessibilityLabel={leading ? 'Cover photo' : 'Try this as the cover'}
                    accessibilityState={{ selected: leading }}
                    style={[
                      styles.thumb,
                      {
                        borderColor: leading ? t.accent : 'transparent',
                        borderWidth: leading ? 2 : 0,
                        opacity: leading ? 1 : 0.65,
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
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, value));
}

/** How far apart two fingers are. */
function spanOf(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number },
): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
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
  /* At the foot rather than under the hint, so the frame stays centred in the
     screen however many photographs the album has. */
  strip: { position: 'absolute', left: 0, right: 0, bottom: 40, gap: 10 },
  stripLabel: {
    color: '#ffffff8c',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    paddingHorizontal: 20,
  },
  stripRow: { paddingHorizontal: 20, paddingRight: 28, gap: 10 },
  thumb: { width: 58, height: 58, borderRadius: 8, overflow: 'hidden' },
  thumbShot: { width: '100%', height: '100%' },
});
