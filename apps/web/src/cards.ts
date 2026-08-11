/**
 * Turning event listings into the things a card renders.
 *
 * Kept out of the component because it has to be testable and does not need
 * React: the image URLs are signed against the event's `cap_epoch`, so
 * rotating an event's link stops its thumbnails resolving, which is the point.
 *
 * The meta line itself lives in `@parea/cards`, shared with the native client
 * — a relative time that rounds differently on the two is exactly the kind of
 * quiet divergence a second copy produces.
 */

import { metaFor } from '@parea/cards';

import { imageSrc } from './images';
import type { EventListing } from './events';

export type CardEvent = {
  id: string;
  name: string;
  photoCount: number;
  /** Signed thumbnail URLs, most recent first. Empty renders no mosaic. */
  mosaic: string[];
  /** The one line under the name. */
  meta: string;
};

/** Signs every mosaic thumbnail and builds the meta line. */
export async function toCards(
  listings: EventListing[],
  now: Date = new Date(),
): Promise<CardEvent[]> {
  return Promise.all(
    listings.map(async (listing, index) => ({
      id: listing.id,
      name: listing.name,
      photoCount: listing.photoCount,
      mosaic: await Promise.all(
        listing.mosaic.map((photo) =>
          imageSrc(
            {
              eventId: listing.id,
              storageKey: photo.storageKey,
              contentHash: photo.hash ? Buffer.from(photo.hash, 'hex') : null,
            },
            'thumb',
            listing.capEpoch,
          ),
        ),
      ),
      meta: metaFor(listing, { newest: index === 0, now }),
    })),
  );
}
