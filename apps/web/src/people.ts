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
 * and them* rather than about them: whether you are friends, and which albums
 * you are both in.
 *
 * Nothing else, and the omissions are the design. No friend count, no album
 * count, no list of what they have made, no mutual friends. §3's rule is that
 * a person is findable enough to be *asked* and no further; a profile that
 * grew a number would make the search box a way to measure strangers.
 *
 * The albums are safe for a reason worth stating rather than assuming: the
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
 * Albums you are both in, taken out of the viewer's own list.
 *
 * The order is deliberate: the viewer's albums first, then the filter. Written
 * the other way round — their albums, then "may the viewer see it" — it would
 * be one forgotten clause away from listing somebody's albums to a stranger,
 * and the forgotten clause would look like an optimisation.
 */
export async function albumsWithBoth(
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
