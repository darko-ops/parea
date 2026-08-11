/**
 * Turning event listings into the things a card renders.
 *
 * Kept out of the component because both halves need testing and neither
 * needs React: the meta line has rules, and the image URLs have to be signed
 * against the event's `cap_epoch` — rotate an event's link and its thumbnails
 * stop resolving, which is the point.
 */

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

/**
 * How long ago, in the shortest form that is still true.
 *
 * Rounded down deliberately. "added to 20m ago" describing something 25
 * minutes old is fine; "an hour ago" describing something 35 minutes old
 * invites someone to think they missed more than they did.
 */
export function ago(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;

  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

/**
 * The line under the name: who, then where or when.
 *
 * The photo count is deliberately absent — it is already the large number on
 * the right of the same row, and saying it twice in one card is the kind of
 * duplication that makes a design feel like a form.
 *
 * The newest event shows recency instead of place, because on the card at the
 * top of the list "added to 20m ago" is the fact that makes someone open it.
 * Everything below it shows place if it has one, since by then *where* tells
 * them apart better than *when*.
 */
export function metaFor(
  listing: Pick<EventListing, 'memberCount' | 'place' | 'lastActiveAt'>,
  options: { newest: boolean; now: Date },
): string {
  const people = `${listing.memberCount} ${listing.memberCount === 1 ? 'person' : 'people'}`;
  const recency = `added to ${ago(new Date(listing.lastActiveAt), options.now)}`;
  const second = options.newest ? recency : (listing.place ?? recency);
  return `${people} · ${second}`;
}

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
