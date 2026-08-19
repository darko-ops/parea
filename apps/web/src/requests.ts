/**
 * Everything waiting on an answer from you, in one list.
 *
 * The distinction this module draws is between what has happened and what is
 * being asked. `activity.ts` handles the first — a reaction, a mention, being
 * let in — and every line of it is finished business you can read and forget.
 * These are the other kind: somebody is on the other end waiting, and nothing
 * resolves until you say yes or no.
 *
 * Three sources, because there are three ways somebody can be waiting on you:
 *
 *   - an invitation to an album, which is `event_invite`
 *   - a friend request
 *   - somebody asking into an album *you* run, which is `event_access_request`
 *
 * The third is the one that was missing. It has always been answerable from an
 * album's Members tab and nowhere else, so a host with four albums had four
 * places to look and no reason to look at any of them. A request nobody is told
 * about is a request that gets answered late or not at all, which reads to the
 * person waiting as a refusal — a silent one they cannot even ask about.
 *
 * Group join requests are deliberately not here. They are answered on the group
 * page, and a group is a place you are already in rather than something you are
 * being let into; folding them in would make this a list of two different
 * questions wearing the same buttons.
 */

import { schema } from '@parea/core';
import { and, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import type { Db } from './db';
import { requestsFor } from './friends';
import { imageSrc } from './images';
import { pendingInvites } from './invites';

export type PendingRequestKind = 'invite' | 'friend' | 'join';

export type PendingRequest = {
  /** Unique across kinds: two tables can hand out the same uuid. */
  key: string;
  kind: PendingRequestKind;
  /** The id the answering endpoint wants. */
  id: string;
  /** Which album, for the kinds that have one. Part of the join endpoint's URL. */
  eventId: string | null;
  /** The headline — an album name, or a person's name. */
  title: string;
  /** The line underneath: who is asking, and about what. */
  detail: string;
  /** ISO. */
  at: string;
  /**
   * The picture on the card. Null draws the title's first letter.
   *
   * Whichever thing the card is *about*, which is the same rule the feed's
   * squares follow: an invitation and a request to come in are about an album,
   * so they get its newest photograph; a friend request is about a person, so
   * it gets their face. Deciding between yes and no is easier when you can see
   * what you are deciding about, and an album you have been invited to is one
   * you have never seen.
   *
   * Presigned here rather than handed over as a key. Neither an avatar key nor
   * a storage key crosses this boundary — see `accounts.avatarUrl` and
   * `images.imageSrc`, which is the same discipline every other surface keeps.
   */
  image: string | null;
};

function nameOf(displayName: string | null, handle: string | null): string {
  return displayName?.trim() || (handle ? `@${handle}` : 'Someone');
}

/**
 * Open asks to get into albums this actor administers.
 *
 * `administer` is `isCreator || isGroupAdmin`, and both halves are here — an
 * admin of the group an album belongs to can answer these from the Members tab,
 * so a list that showed only the ones they created would be telling them about
 * a subset of what they are able to act on, which is worse than telling them
 * about none.
 *
 * The group half is an `exists` rather than a join because it is a question,
 * not a source of columns — nothing below reads a membership row, and a join
 * whose result is only ever tested for presence is a join waiting to be given
 * a second matching row by somebody who has forgotten why it was safe.
 */
export async function joinRequestsFor(
  db: Db,
  actorId: string | null,
): Promise<PendingRequest[]> {
  if (!actorId) return [];

  const adminOfItsGroup = exists(
    db
      .select({ one: schema.groupMembers.actorId })
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, schema.events.groupId),
          eq(schema.groupMembers.actorId, actorId),
          eq(schema.groupMembers.role, 'admin'),
        ),
      ),
  );

  const rows = await db
    .select({
      id: schema.eventAccessRequests.id,
      at: schema.eventAccessRequests.createdAt,
      eventId: schema.events.id,
      eventName: schema.events.name,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.eventAccessRequests)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventAccessRequests.eventId))
    .innerJoin(schema.actors, eq(schema.actors.id, schema.eventAccessRequests.actorId))
    .where(
      and(
        eq(schema.eventAccessRequests.status, 'open'),
        isNull(schema.events.deletedAt),
        or(eq(schema.events.createdBy, actorId), adminOfItsGroup),
      ),
    )
    .orderBy(desc(schema.eventAccessRequests.createdAt));

  return rows.map((row) => ({
    key: `join:${row.id}`,
    kind: 'join' as const,
    id: row.id,
    eventId: row.eventId,
    title: nameOf(row.displayName, row.handle),
    detail: `would like to join ${row.eventName}`,
    at: row.at.toISOString(),
    // Filled in by `pendingRequestsFor`, which resolves every card's picture in
    // one pass. Null here rather than a second query per row: this function is
    // also called on its own, by the badge, which counts rows and draws none.
    image: null,
  }));
}

/**
 * The part of the queue the rail's badge was not already counting.
 *
 * `invitesWaiting` counts open invitations along with what is new — so the two
 * kinds it has never known about are friend requests and people asking into an
 * album you run. Without these the badge could read zero while the page it
 * points at says one request is waiting, which is the badge quietly training
 * somebody not to trust it.
 *
 * Counted by fetching the rows rather than by `count(*)`. They are small, and
 * two queries that must agree about what is in the queue are better written as
 * one query asked twice than as two that can drift apart.
 */
export async function otherRequestsWaiting(
  db: Db,
  actorId: string | null,
): Promise<number> {
  if (!actorId) return 0;
  const [friends, joins] = await Promise.all([
    requestsFor(db, actorId),
    joinRequestsFor(db, actorId),
  ]);
  return friends.length + joins.length;
}

/**
 * The whole list, newest first.
 *
 * Unbounded on purpose. Every other list in this product is capped because it
 * is a feed and nobody reaches the end of one, but this is a queue: the number
 * on the bubble is a promise about how much is left, and a cap would make it a
 * promise about how much is shown.
 */
export async function pendingRequestsFor(
  db: Db,
  actorId: string | null,
): Promise<PendingRequest[]> {
  if (!actorId) return [];

  const [invites, friends, joins] = await Promise.all([
    pendingInvites(db, actorId),
    // The same query the Friends page runs, rather than a second one shaped
    // slightly differently: two surfaces showing one queue have to agree about
    // what is in it, and the cheapest way to guarantee that is one query.
    requestsFor(db, actorId),
    joinRequestsFor(db, actorId),
  ]);

  const all: PendingRequest[] = [
    ...invites.map((invite) => ({
      key: `invite:${invite.id}`,
      kind: 'invite' as const,
      id: invite.id,
      eventId: invite.eventId,
      title: invite.eventName,
      // "Marcus invited you to Beach Weekend", said in two lines: the album is
      // the headline and this is who asked. Warmer than "asked you", which
      // reads like a form somebody filled in about you.
      detail: invite.caption
        ? `${invite.from} invited you · ${invite.caption}`
        : `${invite.from} invited you`,
      at: invite.createdAt,
      image: null as string | null,
    })),
    ...friends.map((friend) => ({
      key: `friend:${friend.id}`,
      kind: 'friend' as const,
      id: friend.id,
      eventId: null,
      title: nameOf(friend.displayName, friend.handle),
      detail: 'would like to be friends',
      at: friend.askedAt,
      image: null as string | null,
    })),
    ...joins,
  ];

  const sorted = all.sort((a, b) => b.at.localeCompare(a.at));

  /*
   * Every card's picture, in two queries rather than one per card.
   *
   * Album covers for the kinds about albums, faces for the kind about a
   * person, and both resolved after the merge so a card gets one lookup
   * whichever list it came from.
   */
  const [covers, faces] = await Promise.all([
    coversFor(db, sorted.flatMap((r) => (r.eventId ? [r.eventId] : []))),
    facesFor(db, friends.map((f) => f.actorId)),
  ]);

  return Promise.all(
    sorted.map(async (request) => ({
      ...request,
      image:
        request.kind === 'friend'
          ? (faces.get(request.id) ?? null)
          : request.eventId
            ? (covers.get(request.eventId) ?? null)
            : null,
    })),
  );
}

/**
 * The newest photograph in each of these albums, presigned.
 *
 * `distinct on` rather than a correlated subselect per row: this is asked
 * about a handful of albums at once, and one pass over the photo table
 * indexed by event is cheaper than one subselect per card.
 *
 * An album nobody has added to yet is simply absent from the map, which the
 * caller draws as a letter — the same fallback the cards use.
 */
async function coversFor(db: Db, eventIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (eventIds.length === 0) return out;

  const rows = await db
    .select({
      eventId: schema.events.id,
      capEpoch: schema.events.capEpoch,
      storageKey: schema.photos.storageKey,
      hash: sql<string | null>`encode(${schema.photos.contentHash}, 'hex')`,
    })
    .from(schema.photos)
    .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
    .where(
      and(
        inArray(schema.photos.eventId, eventIds),
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
      ),
    )
    .orderBy(schema.photos.eventId, desc(schema.photos.uploadedAt));

  for (const row of rows) {
    // First per album wins, which the ordering makes the newest. Cheaper than
    // `distinct on` through the query builder and identical in effect for a
    // list this size.
    if (out.has(row.eventId)) continue;
    out.set(
      row.eventId,
      await imageSrc(
        {
          eventId: row.eventId,
          storageKey: row.storageKey,
          contentHash: row.hash ? Buffer.from(row.hash, 'hex') : null,
        },
        'thumb',
        row.capEpoch,
      ),
    );
  }
  return out;
}

/**
 * The asker's picture on each friend request, keyed by the request's own id.
 *
 * By request rather than by actor, because that is what the card has in its
 * hand — and because one person can only have one open request to you, so the
 * two are the same map with a different key and this one needs no second
 * lookup at the call site.
 */
async function facesFor(db: Db, actorIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (actorIds.length === 0) return out;

  const rows = await db
    .select({
      requestId: schema.friendRequests.id,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.friendRequests)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendRequests.fromActorId))
    .where(
      and(
        inArray(schema.friendRequests.fromActorId, actorIds),
        eq(schema.friendRequests.status, 'open'),
      ),
    );

  for (const row of rows) {
    const url = await avatarUrl(row.avatarKey);
    if (url) out.set(row.requestId, url);
  }
  return out;
}
