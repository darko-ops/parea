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
 * And, since albums became public or private and nothing in between, the
 * albums they made. This is the change: the page used to list nothing a
 * stranger was not already in, and "go to their profile and ask" is now how
 * somebody gets into a private album without a link, so the album has to be on
 * the profile to be asked about. What is on it is bounded hard — see
 * `albumsBy`, where a private album is a name and nothing else.
 *
 * Still no friend count, no total, no mutual friends. §3's rule is that a
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

import { PRIVATE, schema } from '@parea/core';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

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
 * One album on somebody's profile, as much of it as the viewer may know.
 *
 * Two shapes in one type, and the flag says which. An unlocked album — public,
 * or private with the viewer already in it — shows its cover and how many
 * photographs are in it, all of which that viewer could see by opening it. A
 * locked one is a name, a date and a button, because everything else is what
 * they are asking for.
 *
 * No cover on a locked album, deliberately: a cover is a photograph out of the
 * album, so drawing one would hand over a piece of the thing being withheld —
 * and it is usually the best piece, since somebody chose it.
 */
export type ProfileAlbum = {
  id: string;
  name: string;
  /** Private, and the viewer is not in it. Decides everything below. */
  locked: boolean;
  coverKey: string | null;
  /** Null when locked. */
  photoCount: number | null;
  /** The album's own day, ISO, or null. Safe on a locked one: it is a date. */
  eventDate: string | null;
  lastActiveAt: string;
};

/**
 * The albums this person made, as somebody else sees them.
 *
 * Theirs — `created_by` — rather than everything they are in. Being in
 * somebody else's private album is that person's fact to disclose, and a
 * profile that listed it would publish it on their behalf.
 *
 * Every album they made is listed, public and private both, which is the point
 * of the page now: a private album that nobody can see exists is one nobody
 * can ask to be let into, and asking is one of the two ways in. What differs
 * is how much of it comes back, and the locked rows carry nothing but a name
 * and a date.
 *
 * Empty for a signed-out viewer, and for either side of a block — the caller
 * has already 404ed on both by the time this runs, and it returns nothing on
 * its own account anyway rather than relying on that.
 */
export async function albumsBy(
  db: Db,
  viewerId: string | null,
  theirActorId: string,
): Promise<ProfileAlbum[]> {
  if (!viewerId) return [];

  const rows = await db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      accessPolicy: schema.events.accessPolicy,
      coverKey: schema.events.coverKey,
      eventDate: schema.events.eventDate,
      lastActiveAt: schema.events.lastActiveAt,
      photoCount: sql<number>`(
        select count(*)::int from "photo" p
        where p.event_id = ${schema.events.id}
          and p.status = 'ready' and p.deleted_at is null
      )`,
      /*
       * Whether the viewer is already in. A participant row, or membership of
       * the group the album belongs to — the same two facts `authorize` reads,
       * so an album that opens is an album this page draws as open.
       */
      joined: sql<boolean>`(
        exists (
          select 1 from "event_participant" ep
          where ep.event_id = ${schema.events.id} and ep.actor_id = ${viewerId}
        ) or exists (
          select 1 from "group_member" gm
          where gm.group_id = ${schema.events.groupId} and gm.actor_id = ${viewerId}
        )
      )`,
    })
    .from(schema.events)
    .where(
      and(eq(schema.events.createdBy, theirActorId), isNull(schema.events.deletedAt)),
    )
    .orderBy(desc(schema.events.lastActiveAt));

  return rows.map((row) => {
    const locked = row.accessPolicy === PRIVATE && !row.joined;
    return {
      id: row.id,
      name: row.name,
      locked,
      coverKey: locked ? null : row.coverKey,
      photoCount: locked ? null : row.photoCount,
      eventDate: row.eventDate,
      lastActiveAt: row.lastActiveAt.toISOString(),
    };
  });
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
