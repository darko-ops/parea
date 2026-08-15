/**
 * The events someone can reach — the data behind the app's home and profile.
 *
 * The product says "event", the schema says `event`, and this file says
 * `EventListing` for one row of the list. It briefly said "album" everywhere —
 * a second word for one thing, which cost a sentence of explanation in every
 * file that touched it and bought nothing.
 *
 * Two ways to be in one, and both count:
 *
 *   - you presented a credential once, so there is an `event_participant` row;
 *   - you are in the group it belongs to, which reaches events you have never
 *     opened. This is what a group is *for* (§3), and it is why a member sees
 *     next Sunday's dinner without anyone sending them anything.
 *
 * Deliberately not "every event you could reach if you still had the link".
 * A link is a credential someone was sent, not a membership, and listing
 * events on the strength of one would put an event someone opened once and
 * forgot on their home screen forever.
 */

import { schema } from '@parea/core';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import type { Db } from './db';

/** Enough of a photo to build a signed thumbnail URL from, and no more. */
export type MosaicPhoto = {
  id: string;
  storageKey: string;
  /** Hex, or null for a photo that has not been through the deriver. */
  hash: string | null;
};

/**
 * How many photos a card's mosaic can show.
 *
 * The layouts use one hero tile plus supporting tiles; four covers every
 * arrangement in the design with nothing spare. Fetching more would be paid
 * for on every card of every home screen and thrown away.
 */
export const MOSAIC_TILES = 4;

export type EventListing = {
  id: string;
  name: string;
  linkToken: string;
  /** Needed to sign the mosaic's image URLs; rotating a link invalidates them. */
  capEpoch: number;
  /** Most recent first. Empty for an event nobody has added to yet. */
  mosaic: MosaicPhoto[];
  place: string | null;
  /** The host's line under the name. Drawn on the card, under the title. */
  caption: string | null;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  groupId: string | null;
  groupName: string | null;
  /** People who have been in it, which is what "members" means on a card. */
  memberCount: number;
  photoCount: number;
  /**
   * People who actually put something in, which is a different number.
   *
   * The card used to draw one lens per contributor on the reasoning that a
   * circle per *member* turns "who was there" into "who has the link". The
   * card draws members now — asked for, and defensible: a member is somebody
   * who was let in rather than anybody who ever loaded the page, and the card
   * is trying to prompt the ones who have not added anything yet. This is kept
   * because the number is still a different fact and other things read it.
   */
  contributorCount: number;
  /**
   * Whose album it is: the handle, and their picture if they have one.
   *
   * A key rather than a URL, and it stays a key until something presigns it —
   * the bucket is private, so a URL is a short-lived capability and one stored
   * or shipped raw is a credential with an expiry attached.
   */
  creator: { handle: string | null; avatarKey: string | null };
  /**
   * The first few members other than the creator, for the row of faces.
   *
   * Bounded in the query at the number the card draws. Fetching every member
   * of an album to render three circles is a list that grows without bound on
   * the screen with the most rows on it.
   */
  members: { avatarKey: string | null }[];
  /**
   * Uploaded and not through the deriver yet.
   *
   * The difference between an event that is being added to right now and one
   * that was added to twenty minutes ago, which `lastActiveAt` cannot tell
   * apart on its own.
   */
  arrivingCount: number;
  lastActiveAt: string;
};

/**
 * How many member faces a card draws before it starts counting instead.
 *
 * Here rather than in the component because it bounds a query: the point of
 * the cap is that an album with two hundred people costs the same to list as
 * one with three.
 */
export const CARD_FACES = 3;

export async function eventsFor(
  db: Db,
  actorId: string | null,
): Promise<EventListing[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      linkToken: schema.events.linkToken,
      place: schema.events.place,
      caption: schema.events.caption,
      eventDate: schema.events.eventDate,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
      groupId: schema.events.groupId,
      groupName: schema.groups.name,
      capEpoch: schema.events.capEpoch,
      lastActiveAt: schema.events.lastActiveAt,
      /*
       * The card leads with photos, so the photos come back with the list.
       * A lateral top-4 per event in one statement rather than a query per
       * card: the alternative is N+1 round trips on exactly the screen that
       * has the most rows, and it degrades as someone uses the product more.
       *
       * The hash is hex-encoded here because that is the form the URL signer
       * wants; handing back raw bytea would mean a Buffer round trip for
       * nothing.
       */
      mosaic: sql<MosaicPhoto[]>`(
        select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
          select p.id,
                 p.storage_key as "storageKey",
                 encode(p.content_hash, 'hex') as hash
          from "photo" p
          where p.event_id = ${schema.events.id}
            and p.status = 'ready' and p.deleted_at is null
          order by p.uploaded_at desc
          limit ${MOSAIC_TILES}
        ) t
      )`,
      // Counted in the query rather than per row: a home screen that issues
      // two round trips per event is a home screen that is slow at exactly
      // the point someone has a lot of them.
      memberCount: sql<number>`(
        select count(*)::int from "event_participant" ep
        where ep.event_id = ${schema.events.id}
      )`,
      photoCount: sql<number>`(
        select count(*)::int from "photo" p
        where p.event_id = ${schema.events.id}
          and p.status = 'ready' and p.deleted_at is null
      )`,
      contributorCount: sql<number>`(
        select count(distinct p.uploader_id)::int from "photo" p
        where p.event_id = ${schema.events.id}
          and p.status = 'ready' and p.deleted_at is null
      )`,
      // 'pending' is the state between the bytes landing and the deriver
      // finishing. Anything else — failed, removed, quarantined — is not
      // arriving, it has arrived and been dealt with.
      arrivingCount: sql<number>`(
        select count(*)::int from "photo" p
        where p.event_id = ${schema.events.id}
          and p.status = 'pending' and p.deleted_at is null
      )`,
      creatorHandle: schema.actors.handle,
      creatorAvatarKey: schema.actors.avatarKey,
      /*
       * The faces on the card, oldest first, and never the creator's — theirs
       * is drawn beside the title, and the same person twice on one card reads
       * as two people.
       *
       * `json_agg` of a bounded subselect rather than a join: a join would
       * multiply every event row by its members and the counts above would all
       * have to become `count(distinct …)` to survive it.
       */
      members: sql<{ avatarKey: string | null }[]>`(
        select coalesce(json_agg(row_to_json(m)), '[]'::json) from (
          select a.avatar_key as "avatarKey"
          from "event_participant" ep
          join "actor" a on a.id = ep.actor_id
          where ep.event_id = ${schema.events.id}
            and ep.actor_id <> ${schema.events.createdBy}
          order by ep.first_seen_at asc
          limit ${CARD_FACES}
        ) m
      )`,
    })
    .from(schema.events)
    .leftJoin(schema.groups, eq(schema.groups.id, schema.events.groupId))
    // Left, not inner: an actor row is never missing, but an inner join here
    // would silently drop an album if one ever were.
    .leftJoin(schema.actors, eq(schema.actors.id, schema.events.createdBy))
    .where(
      and(
        isNull(schema.events.deletedAt),
        or(
          sql`exists (
            select 1 from "event_participant" ep
            where ep.event_id = ${schema.events.id} and ep.actor_id = ${actorId}
          )`,
          sql`exists (
            select 1 from "group_member" gm
            where gm.group_id = ${schema.events.groupId} and gm.actor_id = ${actorId}
          )`,
        ),
      ),
    )
    // Most recently active first, and only that. A timeline is about what is
    // happening, and the event people are still adding to is the one worth
    // being near the top. There was briefly a second ordering — alphabetical
    // by place — which existed to answer "the Greece one"; search answers that
    // without re-ordering anything, and one list in one order is a home screen
    // somebody can build a memory of.
    .orderBy(desc(schema.events.lastActiveAt));

  return rows.map(({ creatorHandle, creatorAvatarKey, ...row }) => ({
    ...row,
    // `encode()` on a null bytea is null, and json_agg keeps the key, so a
    // photo mid-ingest arrives as {hash: null} rather than being dropped.
    mosaic: (row.mosaic ?? []).filter((p) => p.hash !== null),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    lastActiveAt: row.lastActiveAt.toISOString(),
    creator: { handle: creatorHandle, avatarKey: creatorAvatarKey },
    members: row.members ?? [],
  }));
}
