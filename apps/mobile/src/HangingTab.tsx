/**
 * The picture that hangs from the top of a profile.
 *
 * Centred, square above and round below, with the front camera's band across
 * the top of it — and everything else on the page reading down the middle
 * underneath. It was written inside `Profile.tsx`, for the one profile that
 * is yours, and that is the half of it that has now been taken back: somebody
 * else's page is the same kind of page, and it was still drawing the shape
 * this one replaced — a picture bleeding off the right edge with the name
 * ranged left beside it.
 *
 * Two screens, one tab. Not two copies agreeing today: the numbers below are
 * a phone's measurements rather than anybody's taste, and a second set of
 * them is how the same face comes to hang differently depending on whose it
 * is.
 *
 * What the caller keeps is the page: the scroll position it feeds in, and
 * whether there is anything to draw yet. This holds the shape, the colour
 * behind it, the retract and the drop.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GroupTheme } from './Groups';
import type { Lens } from './lens';

/**
 * The tab: a strip the camera owns, and a photograph beginning where it ends.
 *
 * `CAP_H` is the island. Not the allowance a scroll starts at, not a margin
 * chosen for the look of it — the distance from the physical top edge to the
 * bottom of the black pill the front camera lives in, plus a couple of points
 * so the picture is not touching it. Everything above 56 is a decision about
 * design; 56 itself is a fact about the phone, and a face drawn into it is a
 * face with a camera through it.
 *
 * This number has been 100, then 72, then 0, and each move was right about
 * the thing before it and wrong about the phone. 100 and 72 were strips of
 * flat colour that pushed somebody's face into the middle of the screen. 0
 * gave the face the top of the screen and gave it to the camera as well.
 *
 * What is in the strip is the photograph's own colour rather than a swatch —
 * its top edge carried up through it, and a scrim over that so the pill has
 * something calm to sit on. So nothing above the picture is dead space, and
 * nothing of the picture is behind the pill.
 */
const TAB_W = 172;
const CAP_H = 56;
/**
 * The picture is square, because the crop is square.
 *
 * This frame has asked for 1:1, then 6:5, then 9:16, and not one of those was
 * ever granted: `allowsEditing` on iOS crops to a square and ignores `aspect`
 * outright, and the endpoint stores a square as well. So every one of those
 * shapes was a portrait box with a square source in it, and `cover` paid the
 * difference out of the sides of somebody's face — which is what you see
 * when you crop yourself carefully and arrive here missing your ears.
 *
 * A box the shape of the crop is the only frame that shows the whole crop.
 * The width is the tab's, so the height is the tab's width.
 */
const PHOTO_H = TAB_W;
export const TAB_H = CAP_H + PHOTO_H;
/**
 * What the tab narrows to as the page moves under it.
 *
 * Named rather than written as `TAB_W - 56` at the one place it was used,
 * because the centring is derived from it as well — and a width that came
 * from one expression and a centre that came from another is exactly how the
 * two came apart: the tab kept its left edge and lost 56 points off the
 * right, so it walked 28 points to the left on the way up.
 */
const TAB_MIN_W = TAB_W - 56;
/**
 * The picture's top edge, carried up through the strip.
 *
 * `BLEED` is how much of that edge is stretched to fill it. Ten points scaled
 * to the strip's height is the colours actually at the top of the picture
 * rather than an average of the whole of it; mirrored, so the row that meets
 * the photograph is the photograph's own first row and the seam is not a
 * seam; blurred, so ten points of somebody's hair is colour rather than an
 * upside-down piece of a photograph.
 *
 * The two numbers are that stretch written as a transform. React Native
 * scales about a view's centre, so the lift is what puts the edge back where
 * the arithmetic wants it: a point `y` down the picture lands at
 * `CAP_H - BLEED_SCALE * y`, which is `CAP_H` at the top of the strip and 0
 * at its bottom.
 */
const BLEED = 10;
const BLEED_SCALE = CAP_H / BLEED;
const BLEED_LIFT = CAP_H - ((1 + BLEED_SCALE) * PHOTO_H) / 2;
/** What is left of the picture once the page has been scrolled. */
const PHOTO_MIN = 26;

export function HangingTab({
  t,
  avatar,
  initial,
  lens,
  scrollY,
  onPress,
  label,
}: {
  t: GroupTheme;
  /** Their picture, or nothing — in which case a letter on their own lens. */
  avatar: string | null;
  /** That letter. Never a silhouette, which is the rule every face follows. */
  initial: string;
  /** Their colour, keyed on the handle, so it is theirs on every screen. */
  lens: Lens;
  /**
   * How far the page under it has been scrolled.
   *
   * The caller's, because the caller owns the scroll view. The tab does not
   * move with it — it retracts, which is what makes it read as fixed to the
   * screen rather than as the first row of the content.
   */
  scrollY: Animated.Value;
  /**
   * Pressing it, where there is something to press for.
   *
   * Your own picture opens the editor. Somebody else's is a photograph and
   * nothing more, so the tab is drawn as a plain view there rather than as a
   * control that does nothing — see the same argument beside `Friends` on
   * their page.
   */
  onPress?: () => void;
  label?: string;
}) {
  /**
   * The tab's arrival.
   *
   * A transform, and therefore native, which is the whole reason it is on a
   * view of its own: the retract below is width and height, which are layout
   * and JS-driven, and React Native refuses the pair on one node.
   *
   * It runs on mount and there is no latch, because mounting *is* the latch —
   * this component is not drawn until there is something to put in it, and it
   * is not taken down again while the screen is alive. A tab that replayed
   * its entrance every time somebody came back to the page would be one that
   * never settles.
   */
  const drop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(drop, {
      toValue: 1,
      damping: 14,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
  }, [drop]);

  /*
   * The tab retracts as the page moves under it.
   *
   * 170 points of scroll takes it from 172 × 228 to 116 × 82 and then stops.
   * It keeps the top edge and the bottom corners; what changes is how much of
   * it there is, which is what makes it read as being pulled back up rather
   * than scrolling away.
   */
  const k = scrollY.interpolate({
    inputRange: [0, 170],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  /**
   * What the tab is made of, behind the picture.
   *
   * One value used twice, which is the point: the cap and the panel are two
   * views, and a tab that is two colours is two objects. Whatever sits behind
   * the photograph is what the strip above it is — the lens for somebody with
   * no picture, and the line colour for somebody whose picture has not
   * decoded yet.
   */
  const tabBack = avatar ? t.line : lens.fill;

  const tabWidth = k.interpolate({ inputRange: [0, 1], outputRange: [TAB_W, TAB_MIN_W] });
  /*
   * Half the width it currently has, so the centre stays the centre.
   *
   * `left: '50%'` puts the tab's *left edge* on the middle of the screen and
   * the margin pulls it back by half its width. That half was a constant —
   * half the resting width — so while the tab narrowed the left edge did not
   * move and the right edge came in alone. The comment on `tab` claimed it
   * narrowed symmetrically; it drifted 28 points left instead, which is what
   * you see at the end of a scroll.
   *
   * Interpolated from the same `k` as the width, so the two cannot disagree.
   * It is a layout property like the width and shares its JS driver, so this
   * adds a number to a frame that was already being laid out rather than a
   * measurement pass — which was the reason `alignSelf` was turned down.
   */
  const tabInset = k.interpolate({ inputRange: [0, 1], outputRange: [-TAB_W / 2, -TAB_MIN_W / 2] });
  /*
   * The cap does not retract; only the picture under it does.
   *
   * It is the unsafe zone, and the unsafe zone is the same height however far
   * the page has been scrolled. Shrinking the whole tab would walk the
   * photograph back up under the camera on the way past.
   */
  const tabHeight = k.interpolate({
    inputRange: [0, 1],
    outputRange: [TAB_H, CAP_H + PHOTO_MIN],
  });

  /*
    The picture, beginning where the camera stops.

    The box is square because the crop is square, so `cover` has nothing to
    trim: every pixel somebody kept is drawn. It starts at `CAP_H` because the
    alternative is a face with a camera through it, and as high as it goes is
    only worth having as high as the phone allows.

    No top corners on the image: a rounded corner is a frame announcing
    itself, and the only shape anybody should be able to see is the bottom of
    the bookmark.
  */
  const face = avatar ? (
    <Image source={{ uri: avatar }} style={styles.tabFill} contentFit="cover" transition={120} />
  ) : (
    <View style={[styles.tabFill, styles.tabBlank]}>
      <Text style={[styles.letter, { color: lens.ink }]}>{initial}</Text>
    </View>
  );

  return (
    /*
      Two views, one inside the other, and the nesting is not arrangement. The
      outer one is width and height, which are layout and therefore JS-driven
      by the scroll; the inner one is the entrance, which is a transform and
      runs natively. On one view React Native refuses the pair outright.
    */
    <Animated.View
      style={[
        styles.tab,
        { width: tabWidth, marginLeft: tabInset, height: tabHeight, shadowColor: t.fg },
      ]}
    >
      <Animated.View
        style={[
          styles.tabFill,
          {
            transform: [
              {
                translateY: drop.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-TAB_H * 1.05, 0],
                }),
              },
            ],
          },
        ]}
      >
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={[styles.photo, { backgroundColor: tabBack }]}
          >
            {face}
          </Pressable>
        ) : (
          <View style={[styles.photo, { backgroundColor: tabBack }]}>{face}</View>
        )}

        {/*
          The camera's strip: the picture's colour, and a shadow to sit in.

          Two layers over `tabBack`, and neither of them is a photograph
          anybody is meant to read. The first is the top edge of theirs,
          stretched up through the strip and blurred, so what is above the
          picture is the picture's own colour rather than a swatch chosen by
          the app. The second is a scrim over that, strongest at the very top
          and gone by the foot of it, so the black pill has something calm to
          sit on and there is no line where it ends.

          Dark rather than a blur for the scrim: a `BlurView` is uniform and
          stops dead at its own edge, which is a seam — the same reason the
          cover's glass covers a whole header or nothing. See `CoverGlass`.

          Both only over a photograph. Somebody who has not set one has a flat
          colour and a letter up there, which is quiet already, and a shadow
          across the top of it would be weather.
        */}
        <View style={[styles.cap, { backgroundColor: tabBack }]} pointerEvents="none">
          {avatar && (
            <>
              <Image
                source={{ uri: avatar }}
                style={styles.bleed}
                contentFit="cover"
                blurRadius={20}
                transition={120}
              />
              <LinearGradient
                colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0)']}
                locations={[0, 0.5, 1]}
                style={styles.shade}
              />
            </>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /*
   * The tab: flush to the physical top, centred, square above and round below.
   *
   * `left: '50%'` rather than `alignSelf`, because the width is animated and a
   * centring that depends on it would re-measure on every frame of the
   * retract. That puts the tab's left edge on the middle of the screen; what
   * brings it back to centre is `tabInset`, which is animated beside the
   * width rather than held here — see the note on it. A constant margin here
   * is what made the tab drift left as it narrowed.
   */
  tab: {
    position: 'absolute',
    top: 0,
    left: '50%',
    zIndex: 2,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  tabFill: { width: '100%', height: '100%' },
  /*
   * The camera's strip, and the clip that keeps the bleed inside it.
   *
   * It does not retract with the tab: the island is the same height however
   * far the page has been scrolled, so this is pinned to the top and the
   * picture below it is what shrinks.
   */
  cap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CAP_H,
    overflow: 'hidden',
    zIndex: 1,
  },
  /*
   * The picture's top edge, stretched up to fill the strip.
   *
   * Laid out as the picture is — the same width and the same square height —
   * so `cover` frames it identically and row zero is the same row in both.
   * The transform then flips it and scales it about its centre; `BLEED_LIFT`
   * is what puts row zero back on the strip's bottom edge. Listed
   * translate-then-scale, which React Native applies to a point in the other
   * order, so the lift is in unscaled points.
   */
  bleed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PHOTO_H,
    transform: [{ translateY: BLEED_LIFT }, { scaleY: -BLEED_SCALE }],
  },
  /* The shadow the pill sits in, over the whole strip and nothing below it. */
  shade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  /*
   * The picture: everything below the strip, and square at rest.
   *
   * `bottom: 0` rather than `height: PHOTO_H`, because the tab's height is
   * animated and the retract has to come out of the picture rather than out
   * of the camera's strip. At rest `TAB_H - CAP_H` is `PHOTO_H`, which is
   * `TAB_W`, so the box is square and `cover` trims nothing.
   */
  photo: { position: 'absolute', top: CAP_H, left: 0, right: 0, bottom: 0 },
  tabBlank: { alignItems: 'center', justifyContent: 'center' },
  /* Sized for the frame rather than for the 64pt disc this replaced: a letter
     chosen for a thumbnail is lost in a box several times the area. */
  letter: { fontSize: 38, fontWeight: '700' },
});
