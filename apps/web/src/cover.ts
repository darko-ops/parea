/**
 * Where a cover sits inside the card it is cut to.
 *
 * A card is a wide letterbox and a phone photograph is a tall rectangle, so
 * something is always cut off. The route used to let sharp's `attention`
 * strategy decide what — which guesses well on a group shot and badly on the
 * picture somebody actually cares about, with no way to disagree with it.
 *
 * The phone asks now, on the screen between choosing the photographs and naming
 * the album. This is the half of that agreement which runs on the server.
 *
 * ## Percentages, not a rectangle
 *
 * The wire format is the two numbers CSS `object-position` takes: 0 is flush to
 * the left or top edge, 100 flush to the right or bottom, 50 centred. The phone
 * draws its preview with exactly these against `contentFit: 'cover'`, so the
 * two sides agree by running one rule rather than by two approximations of an
 * intention meeting in the middle.
 *
 * A pixel rectangle would have been the obvious thing and is worse: it is only
 * true at the resolution it was measured at, and the phone is looking at a
 * decoded, downsampled, possibly rotated copy of what the server will read off
 * the original.
 *
 * Kept out of the route because this is the part that can be quietly wrong —
 * off by an axis, or by an orientation — in a way no HTTP status reports.
 */

/**
 * How wide a cover is stored. The height follows the picture — see below.
 *
 * A card is about 600 points across, so 1200 covers a retina screen and nothing
 * beyond it is ever seen.
 */
export const COVER_WIDTH = 1200;

/**
 * The shapes a cover is allowed to be, as width over height.
 *
 * Every cover used to be 3:2, which is the shape of a landscape photograph and
 * the wrong shape for most of what a phone takes. A portrait picture lost its
 * top and bottom to a letterbox on a screen whose whole width was available —
 * so a shelf of albums was a row of short, wide crops of tall, narrow evenings.
 *
 * The bounds are what stop that becoming the opposite problem. Unbounded, a
 * panorama is a hairline and somebody's 9:16 screenshot is a card and a half
 * tall, and a list you scroll past one album at a time is not a shelf. 4:5 is
 * the tallest: an ordinary phone portrait gives up a little top and bottom, and
 * the next card still shows at the bottom of the screen.
 */
export const COVER_WIDEST = 3 / 2;
export const COVER_TALLEST = 4 / 5;

/** What a cover of this picture will be shaped like, once it is stored. */
export function coverAspect(size: { w: number; h: number }): number {
  const natural = size.w / size.h;
  return Math.min(COVER_WIDEST, Math.max(COVER_TALLEST, natural));
}

/** And the pixels that shape comes to. */
export function coverSize(size: { w: number; h: number }): {
  width: number;
  height: number;
} {
  return { width: COVER_WIDTH, height: Math.round(COVER_WIDTH / coverAspect(size)) };
}

export type CoverFraming = { x: number; y: number };

/**
 * The framing a request asked for, or null for one that did not.
 *
 * Null is not a failure: the web has no screen that can frame, and null is what
 * leaves `attention` in place for it. Out-of-range is also null rather than
 * clamped — a caller sending 400 has a bug, and quietly cropping to the right
 * edge would hide it behind a plausible picture.
 */
export function framingOf(url: URL): CoverFraming | null {
  const raw = { x: url.searchParams.get('cx'), y: url.searchParams.get('cy') };
  if (raw.x === null || raw.y === null) return null;
  /*
   * Empty is not zero, though `Number` says it is.
   *
   * `?cx=&cy=` is what a client sends when it meant to send a framing and had
   * none — and `Number('')` is 0, which is a valid framing meaning "flush to
   * the top-left corner". So the one request that most obviously carries a bug
   * was the one answered with a confident crop of somebody's ceiling.
   */
  if (raw.x.trim() === '' || raw.y.trim() === '') return null;

  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x, y };
}

/**
 * The oriented size of an image, from what sharp read off its header.
 *
 * The swap is the whole of it: EXIF orientations 5 through 8 are the quarter
 * turns, and `metadata()` reports the stored dimensions rather than the
 * displayed ones. Cropping a portrait photograph as though it were landscape is
 * the failure this exists to prevent, and it only shows up on pictures taken
 * sideways — which is most of them.
 */
export function orientedSize(meta: {
  width?: number;
  height?: number;
  orientation?: number;
}): { w: number; h: number } | null {
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 0;
  const h = (swap ? meta.width : meta.height) ?? 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * The region `fit: 'cover'` would show, slid to where the caller asked.
 *
 * sharp's `position` takes a gravity or a strategy and never a percentage, so
 * the pan has to be an `extract` before the resize. The arithmetic is the one
 * `object-fit: cover` does: scale until both axes are covered, then move the
 * overhang by the caller's fraction of it.
 *
 * Returns null when there is nothing to cut — an image smaller than the output
 * on both axes has no overhang, and `extract` on a zero-slack region is a round
 * trip through a no-op that can only introduce a rounding error.
 */
export function regionFor(
  size: { w: number; h: number },
  framing: CoverFraming,
): { left: number; top: number; width: number; height: number } | null {
  const target = coverSize(size);
  const scale = Math.max(target.width / size.w, target.height / size.h);

  // What the output covers, measured back in the original's own pixels, and
  // never more of either axis than the original has.
  const width = Math.min(size.w, Math.round(target.width / scale));
  const height = Math.min(size.h, Math.round(target.height / scale));

  const slack = { x: size.w - width, y: size.h - height };
  if (slack.x <= 0 && slack.y <= 0) return null;

  return {
    left: Math.round(slack.x * (framing.x / 100)),
    top: Math.round(slack.y * (framing.y / 100)),
    width,
    height,
  };
}
