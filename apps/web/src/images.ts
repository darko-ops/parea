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

import { schema } from '@parea/core';
import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from './db';
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
 * every photograph in an event was upscaled half again and looked it. On a 3×
 * phone it was worse. The tile is the product's subject at the size most
 * people see it, and it was the softest image on the page.
 *
 * Two entries rather than one because the right answer depends on the screen:
 * a 1× laptop genuinely wants the 320, and asking it to fetch 1280 to draw 240
 * is four times the bytes for nothing. `sizes` at the call site is what tells
 * the browser which case it is in.
 *
 * The gap between 320 and 1280 was the real cost, and `card` at 640 closed it:
 * a 2× screen filling a 540-pixel slot now fetches 640 rather than a 1280 it
 * throws most of away. It is offered only for photographs that actually have
 * one — see `hasCard` — because the size arrived after the product had events
 * in it, and a signed URL for an object nobody encoded is a broken tile.
 */
export async function imageSrcSet(
  photo: PhotoRef,
  capEpoch: number,
  format: ImageFormat = 'jpeg',
  /**
   * Whether this photograph has the 640.
   *
   * Asked rather than assumed, and that is the whole reason this parameter
   * exists: `card` was added after the product had photographs in it, so
   * everything ingested before it has thumb, grid and full and nothing
   * between. Offering a URL for a derivative that was never encoded is a
   * signed address for an object that is not there — a broken tile, on the
   * screen this change exists to improve.
   */
  hasCard = false,
): Promise<string | null> {
  if (!hasDerivatives(photo)) return null;
  if (!formatsFor('thumb').includes(format)) return null;

  const [thumb, card, grid] = await Promise.all([
    imageSrc(photo, 'thumb', capEpoch, format),
    hasCard ? imageSrc(photo, 'card', capEpoch, format) : Promise.resolve(null),
    imageSrc(photo, 'grid', capEpoch, format),
  ]);
  // The widths are each derivative's own longest edge, which is what `srcset`
  // means by `w` — not the width of any slot on any page.
  return [`${thumb} 320w`, card && `${card} 640w`, `${grid} 1280w`]
    .filter(Boolean)
    .join(', ');
}

/** True when derivatives exist, so callers know a thumbnail is available. */
export function hasDerivatives(photo: PhotoRef): boolean {
  return photo.contentHash !== null;
}

/**
 * Which of these photographs have the 640, asked once for the whole page.
 *
 * One query rather than a correlated subselect per row: a gallery is up to
 * fifty rows and this is a set membership test, not a column of the photo.
 *
 * It exists at all because `card` was added after the product had events in
 * it. Everything ingested before then has thumb, grid and full and nothing
 * between, and there is no flag on the photo saying so — the `derivative`
 * table is the only thing that knows. Once every photograph has been
 * re-derived this always returns everything, and the parameter it feeds can go.
 */
export async function photosWithCard(
  db: Db,
  photoIds: string[],
): Promise<Set<string>> {
  if (photoIds.length === 0) return new Set();
  const rows = await db
    .select({ photoId: schema.derivatives.photoId })
    .from(schema.derivatives)
    .where(
      and(
        inArray(schema.derivatives.photoId, photoIds),
        eq(schema.derivatives.kind, 'card'),
      ),
    );
  return new Set(rows.map((row) => row.photoId));
}
