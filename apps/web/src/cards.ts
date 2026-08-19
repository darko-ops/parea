/**
 * Turning event listings into the things a card renders.
 *
 * Kept out of the component because it has to be testable and does not need
 * React: the image URLs are signed against the event's `cap_epoch`, so
 * rotating an event's link stops its thumbnails resolving, which is the point.
 *
 * The relative time comes from `@parea/cards`, shared with the native client —
 * a time that rounds differently on the two is exactly the kind of quiet
 * divergence a second copy produces.
 */

import { ago } from "@parea/cards";

import { avatarUrl } from "./accounts";
import { imageSrc } from "./images";
import { getStorage } from "./storage";
import type { EventListing } from "./events";

export type CardEvent = {
  id: string;
  /** Only used to build an `/e/<token>` href; never rendered. */
  linkToken?: string;
  name: string;
  photoCount: number;
  /** Signed thumbnail URLs, most recent first. Empty renders no mosaic. */
  mosaic: string[];
  /**
   * When it was last added to, as "3 days ago".
   *
   * Built here rather than in the component because it is a relative time: the
   * server and the browser would round it differently, and React throws away
   * the whole tree when the two disagree. `ago` is shared with the native
   * client, so "3 days ago" means the same thing on both.
   *
   * No "added" in front of it any more. On a card whose other line is a name
   * and a handle, the only time anything can be talking about is the last time
   * something arrived, and the word was the longest part of the shortest fact.
   */
  added: string;
  /**
   * Whose album it is — the picture beside the title, and the handle beside
   * the caption. Either can be null: an account is optional here, and so is a
   * picture.
   */
  creatorAvatar: string | null;
  creatorHandle: string | null;
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

/**
 * The cover's URL, presigned for an hour.
 *
 * The same treatment an avatar gets, and for the same reason: a cover has no
 * derivatives for the image Worker to address — it was re-encoded once, on the
 * way in, and there is nothing smaller to serve. See `/api/events/[id]/cover`.
 */
export async function coverSrc(key: string | null): Promise<string | null> {
  if (!key) return null;
  return getStorage().presignGet(key, 3600);
}

/**
 * The one image that stands for an album: its cover, or its newest photograph.
 *
 * Used by every surface that draws a single thumbnail for an album — search
 * results, the albums two people share — so that "the picture the album leads
 * with" means the same thing in all of them and in the card, which leads with
 * the same image because `toCards` puts it first in the mosaic.
 */
export async function leadImage(
  listing: EventListing,
  capEpoch = listing.capEpoch,
): Promise<string | null> {
  const cover = await coverSrc(listing.coverKey);
  if (cover) return cover;
  const first = listing.mosaic[0];
  if (!first) return null;
  return imageSrc(
    {
      eventId: listing.id,
      storageKey: first.storageKey,
      contentHash: first.hash ? Buffer.from(first.hash, "hex") : null,
    },
    "thumb",
    capEpoch,
  );
}

/** Signs every mosaic thumbnail and builds the meta line. */
export async function toCards(
  listings: EventListing[],
  now: Date = new Date(),
): Promise<CardEvent[]> {
  return Promise.all(
    listings.map(async (listing) => {
      const cover = await coverSrc(listing.coverKey);
      return {
        id: listing.id,
        name: listing.name,
        photoCount: listing.photoCount,
        /*
         * The cover first, then the photographs.
         *
         * Prepended rather than given a field of its own, because "the picture
         * the album leads with" is exactly what the first mosaic tile already
         * is: the layout draws it largest, the blurred bleed under the text is
         * taken from it, and the search rows use it as their thumbnail. A
         * separate `cover` prop would mean four surfaces each deciding again
         * which image wins.
         */
        mosaic: [
          ...(cover ? [cover] : []),
          ...(await Promise.all(
            listing.mosaic.map((photo) =>
              imageSrc(
                {
                  eventId: listing.id,
                  storageKey: photo.storageKey,
                  contentHash: photo.hash
                    ? Buffer.from(photo.hash, "hex")
                    : null,
                },
                "thumb",
                listing.capEpoch,
              ),
            ),
          )),
        ],
        added: ago(new Date(listing.lastActiveAt), now),
        // Presigned here, one per key. Local HMAC rather than a round trip, so
        // a page of six cards is not six round trips to storage.
        creatorAvatar: await avatarUrl(listing.creator.avatarKey),
        creatorHandle: listing.creator.handle,
        caption: listing.caption,
        contributorCount: listing.contributorCount,
        memberCount: listing.memberCount,
        arrivingCount: listing.arrivingCount,
        lastActiveAt: listing.lastActiveAt,
        linkToken: listing.linkToken,
      };
    }),
  );
}
