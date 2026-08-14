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
  /** Only used to build an `/e/<token>` href; never rendered. */
  linkToken?: string;
  name: string;
  photoCount: number;
  /** Signed thumbnail URLs, most recent first. Empty renders no mosaic. */
  mosaic: string[];
  /** The one line under the name. */
  meta: string;
  /** Where it was. Sits beside the lenses on the card; null renders neither. */
  place: string | null;
  /** The host's own line, under the title. Null draws nothing. */
  caption: string | null;
  /** How many lenses to draw. Capped at four when it is drawn, not here. */
  contributorCount: number;
  /** People in it at all, contributors or not. The empty card counts these. */
  memberCount: number;
  /** Uploaded and still being processed. Drives the "still coming in" label. */
  arrivingCount: number;
  /** ISO. Used to decide whether an event is live enough to lead the page. */
  lastActiveAt: string;
  /**
   * Where the card goes. Defaults to the event, which works for anybody whose
   * browser already holds a capability for it — everybody who arrived by
   * following a link, which until invitations was everybody.
   */
  href?: string;
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
      place: listing.place,
      caption: listing.caption,
      contributorCount: listing.contributorCount,
      memberCount: listing.memberCount,
      arrivingCount: listing.arrivingCount,
      lastActiveAt: listing.lastActiveAt,
      linkToken: listing.linkToken,
    })),
  );
}
