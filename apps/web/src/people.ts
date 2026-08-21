/**
 * One person's page, seen by somebody else.
 *
 * Search could find people and then had nowhere to put them: every row led to
 * `/friends`, a list of your own, which is the wrong answer to "who is this".
 * This is the page a name in a search result goes to.
 *
 * ## What it is allowed to say
 *
 * Exactly what a search result already says — a handle, whatever name they
 * chose to show, and their picture — plus the two things that are about *you
 * and them* rather than about them: whether you are friends, and which events
 * you are both in.
 *
 * Nothing else, and the omissions are the design. No friend count, no count of
 * what they have made, no list of it, no mutual friends. §3's rule is that a
 * person is findable enough to be *asked* and no further; a profile that grew
 * a number would make the search box a way to measure strangers. The one
 * number on the page counts the events *you* are in with them, which is a fact
 * about the viewer's own shelf.
 *
 * The events are safe for a reason worth stating rather than assuming: the
 * list is the *viewer's* own — `eventsFor(db, viewer)`, the home screen —
 * filtered down to the ones this person is also in. Every row was already on
 * the viewer's screen a second ago, and every one of them already lists its
 * members. Nothing is disclosed; the page is doing an intersection the viewer
 * could do by hand.
 *
 * ## Who has no page
 *
 * A handle that belongs to nobody, an actor that is not an account, an actor
 * merged into another, and anybody either side of a block. All of them 404 —
 * the same answer, so the page cannot be used to test whether a handle exists
 * when the answer is one somebody is entitled not to give. That is the same
 * set `findPeople` will not return, which is the property that matters: if it
 * cannot be found, it cannot be visited.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { Db } from './db';
import { eventsFor, type EventListing } from './events';

/**
 * Where you and they stand.
 *
 * `asked` covers a request that was declined as well as one still open, on
 * purpose: telling somebody they were refused is the refuser's to do and not
 * this page's, and it is the same thing `/api/friends` does when it answers a
 * repeat ask with the status it already has.
 */
export type Standing = 'self' | 'friends' | 'asked' | 'asking' | 'none';

export type Profile = {
  actorId: string;
  handle: string;
  displayName: string | null;
  avatarKey: string | null;
  /**
   * What they wrote about themselves.
   *
   * Shown here because it is the one thing on a profile that is not a fact the
   * page derived — somebody chose those words for other people to read, which
   * is what a bio is for. It is already on their own screen; a bio nobody else
   * could see would be a diary.
   */
  bio: string | null;
  standing: Standing;
  /** Only when they have asked you: the id the answering endpoint wants. */
  requestId: string | null;
};

/**
 * The person behind a handle, or null for every reason at once.
 *
 * Case-insensitive, because the handle in a URL has been typed or copied by a
 * person and `lower(handle)` is what the unique index is on — two people
 * cannot differ by case, so matching by case would only ever fail to find
 * somebody who is there.
 */
export async function profileFor(
  db: Db,
  viewerId: string | null,
  handle: string,
): Promise<Profile | null> {
  const wanted = handle.trim().toLowerCase();
  if (!wanted || !viewerId) return null;

  const [person] = await db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
      bio: schema.actors.bio,
    })
    .from(schema.actors)
    .where(
      and(
        // The same three tests `findPeople` applies. A profile for somebody
        // search will not return is a second door with a different lock.
        sql`${schema.actors.accountId} is not null`,
        isNull(schema.actors.mergedIntoId),
        sql`lower(${schema.actors.handle}) = ${wanted}`,
      ),
    )
    .limit(1);

  if (!person?.handle) return null;

  if (person.actorId === viewerId) {
    return { ...person, handle: person.handle, standing: 'self', requestId: null };
  }

  /*
   * A block in either direction ends it here.
   *
   * Blocking is silent — the blocked party is never told — so this must not
   * become the thing that tells them: the answer is the one a made-up handle
   * gets. Both directions, because the person who blocked should not run into
   * them either.
   */
  const [blocked] = await db
    .select({ one: schema.blocks.blockerActorId })
    .from(schema.blocks)
    .where(
      or(
        and(
          eq(schema.blocks.blockerActorId, viewerId),
          eq(schema.blocks.blockedActorId, person.actorId),
        ),
        and(
          eq(schema.blocks.blockerActorId, person.actorId),
          eq(schema.blocks.blockedActorId, viewerId),
        ),
      ),
    )
    .limit(1);
  if (blocked) return null;

  const [friendship] = await db
    .select({ one: schema.friendships.actorId })
    .from(schema.friendships)
    .where(
      and(
        eq(schema.friendships.actorId, viewerId),
        eq(schema.friendships.friendActorId, person.actorId),
      ),
    )
    .limit(1);

  if (friendship) {
    return { ...person, handle: person.handle, standing: 'friends', requestId: null };
  }

  // Theirs first: if you have both asked, the one you can act on is the one
  // pointing at you, and a button that says "Asked" over an unanswered request
  // is the page hiding somebody's question.
  const [incoming] = await db
    .select({ id: schema.friendRequests.id })
    .from(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, person.actorId),
        eq(schema.friendRequests.toActorId, viewerId),
        eq(schema.friendRequests.status, 'open'),
      ),
    )
    .limit(1);

  if (incoming) {
    return { ...person, handle: person.handle, standing: 'asking', requestId: incoming.id };
  }

  const [outgoing] = await db
    .select({ status: schema.friendRequests.status })
    .from(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, viewerId),
        eq(schema.friendRequests.toActorId, person.actorId),
      ),
    )
    .limit(1);

  return {
    ...person,
    handle: person.handle,
    standing: outgoing ? 'asked' : 'none',
    requestId: null,
  };
}

/**
 * Events you are both in, taken out of the viewer's own list.
 *
 * The order is deliberate: the viewer's events first, then the filter. Written
 * the other way round — their events, then "may the viewer see it" — it would
 * be one forgotten clause away from listing somebody's events to a stranger,
 * and the forgotten clause would look like an optimisation.
 */
export async function eventsWithBoth(
  db: Db,
  viewerId: string | null,
  theirActorId: string,
): Promise<EventListing[]> {
  if (!viewerId || viewerId === theirActorId) return [];

  const mine = await eventsFor(db, viewerId);
  if (mine.length === 0) return [];

  const theirs = await db
    .select({ eventId: schema.eventParticipants.eventId })
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.actorId, theirActorId));

  const inCommon = new Set(theirs.map((row) => row.eventId));
  return mine.filter((listing) => inCommon.has(listing.id));
}

/**
 * Enough faces to fill the row, few enough that it is a row and not a
 * directory. The row scrolls on a phone; on a laptop this is about two
 * screens' worth of the people somebody actually shares evenings with.
 */
export const PEOPLE_ROW_LIMIT = 14;

export type PersonNearby = {
  actorId: string;
  handle: string | null;
  name: string;
  avatarKey: string | null;
  /** Which of the viewer's events they are in. The row filters the grid. */
  eventIds: string[];
};

/**
 * The people you are in events with, most recently active first.
 *
 * The first thing on Home, and it is the same intersection the profile page
 * does, widened: rather than "which events am I in with this person", it is
 * "who is in the events I am in". Nothing is disclosed by it — every person
 * here is somebody the viewer could find by opening any of those events and
 * reading its Members tab.
 *
 * Ordered by the most recent activity of any event they share with the viewer,
 * so the row is about who you are seeing rather than who you have known
 * longest. Guests are included: somebody who opened a link and put twenty
 * photographs in was at the party, whether or not they made an account.
 *
 * The viewer is not in their own row. It would be the one face that filters
 * the grid to everything.
 */
export async function peopleAround(
  db: Db,
  actorId: string | null,
): Promise<PersonNearby[]> {
  if (!actorId) return [];

  /*
   * Raw SQL for the aggregate. The query builder can express this, and
   * `array_agg` over a grouped join with an ordering that is not the grouping
   * key is the point at which it stops reading like the question being asked.
   */
  const rows = await db.execute(sql`
    select a.id as "actorId",
           a.handle as handle,
           coalesce(nullif(btrim(a.display_name), ''), '@' || a.handle, 'Someone') as name,
           a.avatar_key as "avatarKey",
           array_agg(distinct e.id::text) as "eventIds",
           max(e.last_active_at) as "lastActive"
      from "event_participant" mine
      join "event" e on e.id = mine.event_id and e.deleted_at is null
      join "event_participant" theirs on theirs.event_id = e.id
      join "actor" a on a.id = theirs.actor_id
     where mine.actor_id = ${actorId}
       and theirs.actor_id <> ${actorId}
       and a.merged_into_id is null
       and not exists (
         select 1 from "block" b
         where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = a.id)
            or (b.blocker_actor_id = a.id and b.blocked_actor_id = ${actorId})
       )
     group by a.id, a.handle, a.display_name, a.avatar_key
     order by max(e.last_active_at) desc
     limit ${PEOPLE_ROW_LIMIT}
  `);

  // PGlite answers `{rows}` and postgres.js answers an array. Both are true of
  // `db.execute`, and a screen that worked in tests and not in production is
  // how that was found out the first time.
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as {
    actorId: string;
    handle: string | null;
    name: string;
    avatarKey: string | null;
    eventIds: string[];
  }[];

  return list.map((row) => ({
    actorId: row.actorId,
    handle: row.handle,
    name: row.name,
    avatarKey: row.avatarKey,
    eventIds: row.eventIds ?? [],
  }));
}
