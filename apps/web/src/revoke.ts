/**
 * Taking back the links to a photograph that is no longer shown.
 *
 * Image URLs are signed, and the Worker that serves them used to check only
 * the signature and the event's epoch — so a photo deleted by its uploader,
 * removed by a host, quarantined on a report or hidden after an unanswered
 * removal request stayed reachable, by anyone holding a URL, for up to two
 * hours, served from the edge cache. These write the marker the Worker checks
 * first; see `revokedMarkerKey` in `@parea/urls`.
 *
 * Best-effort by design: the database change is what hides the photo from
 * every listing, and it has already happened by the time these run. A marker
 * that fails to write is logged — the URLs then lapse as they always did —
 * rather than undoing a removal somebody asked for.
 */

import { epochMarkerKey, revokedMarkerKey } from '@parea/urls';

import { getStorage } from './storage';

type Served = { eventId: string; contentHash: Buffer | Uint8Array | null };

const hex = (hash: Buffer | Uint8Array) => Buffer.from(hash).toString('hex');

/** This photo's links stop working. A photo never derived has none. */
export async function revokePhotoLinks(photos: Served | Served[]): Promise<void> {
  const storage = getStorage();
  for (const photo of Array.isArray(photos) ? photos : [photos]) {
    if (!photo.contentHash) continue;
    await storage
      .putSmall(revokedMarkerKey(photo.eventId, hex(photo.contentHash)), new TextEncoder().encode('1'), 'text/plain')
      .catch((err) => console.error(`revoke: could not mark ${photo.eventId}: ${err}`));
  }
}

/** A hidden photo is shown again, so its links work again. */
export async function restorePhotoLinks(photo: Served): Promise<void> {
  if (!photo.contentHash) return;
  await getStorage()
    .delete(revokedMarkerKey(photo.eventId, hex(photo.contentHash)))
    .catch((err) => console.error(`restore: could not unmark ${photo.eventId}: ${err}`));
}

/**
 * Every link in an event at once, for an event that has been deleted: the
 * epoch its URLs were signed under is moved past, exactly as rotating the link
 * does, and the Worker refuses them all.
 */
export async function revokeEventLinks(event: { id: string; capEpoch: number }): Promise<void> {
  await getStorage()
    .putSmall(epochMarkerKey(event.id), new TextEncoder().encode(String(event.capEpoch + 1)), 'text/plain')
    .catch((err) => console.error(`revoke: could not move ${event.id}'s epoch: ${err}`));
}
