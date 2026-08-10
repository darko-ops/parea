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

import { signImagePath, type ImageKind } from '@parea/urls';

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
      capEpoch,
    });
    return `${config.base}${path}`;
  }

  const storage = getStorage();
  const key =
    hash && kind !== 'orig' ? `${photo.storageKey}.${kind}.jpg` : photo.storageKey;
  return storage.presignGet(key, 3600);
}

/** True when derivatives exist, so callers know a thumbnail is available. */
export function hasDerivatives(photo: PhotoRef): boolean {
  return photo.contentHash !== null;
}
