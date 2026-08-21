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

import { ago, dateLabel, CARD_FACES, isLive } from "@parea/cards";

import { avatarUrl } from "./accounts";
import { imageSources, imageSrc } from "./images";
import { getStorage } from "./storage";
import type { EventListing } from "./events";

export type CardEvent = {
  id: string;
  /** Only used to build an `/e/<token>` href; never rendered. */
  linkToken?: string;
  name: string;
  photoCount: number;
  /**
   * The one image the card leads with, and the encodings for it.
   *
   * `grid`, not `thumb`. The card used to draw four tiles about 145px wide, so
   * a 320px derivative was two device pixels for every CSS one and sharp. It
   * now draws a single 290–360px cover 320px tall, which on a retina screen is
   * upwards of 720 device pixels across — and the same 320px file stretched
   * over that is the blur. `grid` is 1280px, the next size the deriver already
   * makes for every photograph, so this costs no backfill.
   *
   * The AVIF sits in `sources` and the JPEG in `src`, because the browser is
   * the only party that knows what it can decode — and at 1280px the AVIF is
   * most of what keeps the bigger picture from being a bigger download.
   *
   * Null for an event with no photographs and no cover, which draws the empty
   * card instead.
   */
  cover: { src: string; sources: { type: string; src: string }[] } | null;
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
   * Whose event it is, as the line under the title says it.
   *
   * Both, always: the name is what somebody recognises and the handle is what
   * is unique, and a card that printed one of them made you guess which. Each
   * can be absent on its own — an account is optional in this product, and so
   * is a display name — and what is left stands alone rather than leaving a
   * gap where the other was.
   */
  creatorName: string | null;
  creatorHandle: string | null;
  /** Yours, so the line reads "You" rather than your own name back at you. */
  mine: boolean;
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
   * The event's own day, as "Fri 14 Mar", or null for one that never said.
   *
   * Formatted here rather than in the component for the reason `added` is:
   * `Intl` on the server and `Intl` in the browser can disagree about a
   * locale, and React discards a tree whose text does not match. The card asks
   * a question about an evening — this is the evening, not the upload.
   */
  date: string | null;
  /**
   * Being added to right now.
   *
   * An hour, which is the width of the claim the badge makes: "being added to
   * now" is false about something that stopped forty minutes ago in a way that
   * "today" would not be. Computed against the server's clock, so it does not
   * flicker on a device whose own is wrong.
   */
  live: boolean;
  /**
   * The faces on the card: whoever made it, then whoever else is in it.
   *
   * Signed URLs and names, capped by `CARD_FACES`. The name rides along for
   * the letter that stands in when there is no picture and for the alt-free
   * circle's accessible name — never a silhouette, which is a photograph of
   * nobody.
   */
  faces: { name: string; avatar: string | null }[];
  /** How many people the faces do not show. Zero draws no chip. */
  moreFaces: number;
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
 * The one image that stands for an event: its cover, or its newest photograph.
 *
 * Used by every surface that draws a single thumbnail for an event — search
 * results, the events two people share — so that "the picture the event leads
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
      const shot = listing.mosaic[0];
      const first = shot
        ? {
            eventId: listing.id,
            storageKey: shot.storageKey,
            contentHash: shot.hash ? Buffer.from(shot.hash, 'hex') : null,
          }
        : null;
      return {
        id: listing.id,
        name: listing.name,
        photoCount: listing.photoCount,
        /*
         * The cover if the event has one, else its newest photograph.
         *
         * One image now, where this used to hand over four: the mosaic is gone
         * from the web card, and this is the same question `leadImage` answers
         * for the search rows and the events-in-common list. A cover object is
         * one presigned URL with no derivatives — it was re-encoded once, on
         * the way in, to the size it is drawn at — so it arrives with an empty
         * `sources` and the browser takes the JPEG.
         */
        cover: cover
          ? { src: cover, sources: [] }
          : first
            ? {
                src: await imageSrc(first, 'grid', listing.capEpoch),
                sources: await imageSources(first, 'grid', listing.capEpoch),
              }
            : null,
        added: ago(new Date(listing.lastActiveAt), now),
        date: dateLabel(listing.eventDate ?? listing.startsAt ?? listing.firstPhotoAt),
        live: isLive(listing.lastActiveAt, now),
        /*
         * Three faces and a number, both decided here.
         *
         * The listing fetches one more than the card draws so that the
         * overflow is honest without a second query — but the number the chip
         * shows is `memberCount` minus what is drawn, not the difference
         * between two limits, because the fourth row is fetched to prove there
         * is a fourth and not to be counted.
         */
        faces: await Promise.all(
          listing.faces.slice(0, CARD_FACES).map(async (face) => ({
            name: face.name,
            avatar: await avatarUrl(face.avatarKey),
          })),
        ),
        moreFaces: Math.max(0, listing.memberCount - CARD_FACES),
        creatorName: listing.creator.name,
        creatorHandle: listing.creator.handle,
        mine: listing.mine,
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
