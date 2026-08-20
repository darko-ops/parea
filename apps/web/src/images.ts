/**
 * Building the URLs the grid renders — docs/design.md §11.
 *
 * Two modes, and the difference matters for cost rather than correctness:
 *
 *   - With the image Worker configured, URLs are hour-bucketed signed paths.
 *     Every viewer of an event within the same hour gets byte-identical URLs,
 *     so the edge cache actually works and a popular event's thumbnails stop
 *     hitting R2 entirely.
 *   - Without it (development, or before the Worker is deployed), URLs are
 *     presigned per request. Correct, and uncacheable — every thumbnail is an
 *     origin read forever. Fine locally, expensive in production.
 *
 * Either way the browser fetches bytes from somewhere that is not this
 * process.
 */

import {
  formatsFor,
  signImagePath,
  type ImageFormat,
  type ImageKind,
} from '@parea/urls';

export { epochMarkerKey } from '@parea/urls';

import { getStorage } from './storage';

export type PhotoRef = {
  eventId: string;
  storageKey: string;
  contentHash: Uint8Array | null;
};

function workerConfig(): { base: string; secret: string } | null {
  const base = process.env.IMAGE_BASE_URL;
  const secret = process.env.IMAGE_SECRET ?? process.env.SESSION_SECRET;
  return base && secret ? { base: base.replace(/\/$/, ''), secret } : null;
}

/**
 * A photo that has not been through the deriver has no content hash and no
 * derivatives, so there is nothing for the Worker to address and nothing
 * smaller than the original to serve. Falls back to a presigned original.
 */
export async function imageSrc(
  photo: PhotoRef,
  kind: ImageKind,
  capEpoch: number,
  format: ImageFormat = 'jpeg',
): Promise<string> {
  const config = workerConfig();
  const hash = photo.contentHash
    ? Buffer.from(photo.contentHash).toString('hex')
    : null;

  if (config && hash) {
    const path = await signImagePath(config.secret, {
      eventId: photo.eventId,
      hash,
      kind,
      format,
      capEpoch,
    });
    return `${config.base}${path}`;
  }

  const storage = getStorage();
  const ext = format === 'avif' ? 'avif' : 'jpg';
  const key =
    hash && kind !== 'orig' ? `${photo.storageKey}.${kind}.${ext}` : photo.storageKey;
  return storage.presignGet(key, 3600);
}

/**
 * Every encoding of one size, best first.
 *
 * The client renders these as `<source>` elements and the browser takes the
 * first it can decode — which is the only place the decision can be made
 * correctly, because it is the only place that knows what the decoder is.
 * Negotiating on `Accept` at the edge would make one cached response answer
 * for viewers who disagree about AVIF; see the note in @parea/urls.
 */
export async function imageSources(
  photo: PhotoRef,
  kind: ImageKind,
  capEpoch: number,
): Promise<{ type: string; src: string }[]> {
  if (!hasDerivatives(photo)) return [];
  return Promise.all(
    formatsFor(kind).map(async (format) => ({
      type: format === 'avif' ? 'image/avif' : 'image/jpeg',
      src: await imageSrc(photo, kind, capEpoch, format),
    })),
  );
}

/**
 * One `srcset` across two sizes, so the browser can pick by how big the slot
 * actually is.
 *
 * The gallery was handed a single 320px thumbnail and drew it into a column
 * roughly 240 CSS pixels wide — which on a 2× screen is 480 device pixels, so
 * every photograph in an album was upscaled half again and looked it. On a 3×
 * phone it was worse. The tile is the product's subject at the size most
 * people see it, and it was the softest image on the page.
 *
 * Two entries rather than one because the right answer depends on the screen:
 * a 1× laptop genuinely wants the 320, and asking it to fetch 1280 to draw 240
 * is four times the bytes for nothing. `sizes` at the call site is what tells
 * the browser which case it is in.
 *
 * The gap between them is the real cost and worth naming: the sizes are 320
 * and 1280 with nothing between, so a 2× screen fetches 1280 to fill 480. A
 * `card` derivative around 640 is the proper fix and it is not a small one —
 * every photograph already ingested would need re-deriving before it could be
 * relied on. Until then the choice is soft or heavy, and heavy is the one that
 * can be undone later.
 */
export async function imageSrcSet(
  photo: PhotoRef,
  capEpoch: number,
  format: ImageFormat = 'jpeg',
): Promise<string | null> {
  if (!hasDerivatives(photo)) return null;
  if (!formatsFor('thumb').includes(format)) return null;

  const [thumb, grid] = await Promise.all([
    imageSrc(photo, 'thumb', capEpoch, format),
    imageSrc(photo, 'grid', capEpoch, format),
  ]);
  // The widths are the derivative's own longest edge, which is what `srcset`
  // means by `w` — not the width of any slot on any page.
  return `${thumb} 320w, ${grid} 1280w`;
}

/** True when derivatives exist, so callers know a thumbnail is available. */
export function hasDerivatives(photo: PhotoRef): boolean {
  return photo.contentHash !== null;
}
