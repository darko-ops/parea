/**
 * The two halves of "somebody else's event".
 *
 * Events splits by nothing — it is everything you can reach, newest first,
 * which is right for a home screen and wrong for the question "what am I
 * waiting on?". These are the two answers that question has:
 *
 *   - events you were let into, which someone else made;
 *   - events you have asked to be let into and have not been.
 *
 * The second had nowhere to live at all. Asking to join a private event wrote
 * a row, showed a sentence once, and then the only way to find out whether the
 * host had answered was to open the link again and see what happened.
 */

import { schema } from '@parea/core';
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { Db } from './db';
import { eventsFor, type EventListing } from './events';

/**
 * Events you are in that you did not make.
 *
 * Built by subtraction rather than by a `created_by <> me` in the main query,
 * so `EventListing` does not have to start carrying the host's actor id — that
 * shape is serialised straight out of `/api/events` to both clients, and an
 * identifier added for one screen's convenience is an identifier published
 * everywhere.
 */
export async function invitedEvents(
  db: Db,
  actorId: string | null,
): Promise<EventListing[]> {
  if (!actorId) return [];

  const reachable = await eventsFor(db, actorId);
  if (reachable.length === 0) return [];

  const mine = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.createdBy, actorId),
        inArray(
          schema.events.id,
          reachable.map((e) => e.id),
        ),
      ),
    );

  const own = new Set(mine.map((row) => row.id));
  return reachable.filter((event) => !own.has(event.id));
}

export type AskedToJoin = {
  eventId: string;
  name: string;
  status: 'open' | 'approved' | 'declined';
  askedAt: string;
};

/**
 * What you have asked for and not yet been given.
 *
 * Approved rows are left out: being approved makes you a participant, so the
 * event is in the other tab and in Events, and a list that kept saying
 * "approved" beside it would be a second copy of the same fact going stale in
 * its own way.
 *
 * Declined rows stay. A request that simply vanished would read as one that
 * was never sent, and the honest answer to "did they see it?" is yes.
 */
export async function askedToJoin(
  db: Db,
  actorId: string | null,
): Promise<AskedToJoin[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      eventId: schema.eventAccessRequests.eventId,
      name: schema.events.name,
      status: schema.eventAccessRequests.status,
      askedAt: schema.eventAccessRequests.createdAt,
    })
    .from(schema.eventAccessRequests)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventAccessRequests.eventId))
    .where(
      and(
        eq(schema.eventAccessRequests.actorId, actorId),
        // A deleted event is gone for everyone, including the person still
        // waiting on its host.
        isNull(schema.events.deletedAt),
        inArray(schema.eventAccessRequests.status, ['open', 'declined']),
      ),
    )
    .orderBy(desc(schema.eventAccessRequests.createdAt));

  return rows.map((row) => ({
    ...row,
    status: row.status as AskedToJoin['status'],
    askedAt: row.askedAt.toISOString(),
  }));
}

/**
 * How many things have arrived since this person last opened Invites.
 *
 * Two sources, and they are the two ways something can happen *to* you here:
 * you were let into an event you did not make, or a request you sent was
 * answered with a no. An approved request is not counted twice — approval
 * writes the participant row, so it is already the first kind.
 *
 * Deliberately not "everything in the tabs". A badge is a claim that there is
 * something new, and a number that only goes down when you look is a number
 * that stops meaning anything. `invites_seen_at` is what makes it a claim
 * about news rather than about volume.
 *
 * The known imprecision: opening somebody's link makes you a participant right
 * then, so it lands here as one new thing even though you just did it
 * yourself. Nothing distinguishes that row from the one approval writes, and
 * inventing a column to tell them apart would cost more than the wrong badge
 * does — it clears the moment they look, which they are already doing.
 */
export async function invitesWaiting(db: Db, actorId: string | null): Promise<number> {
  if (!actorId) return 0;

  const [me] = await db
    .select({ seenAt: schema.actors.invitesSeenAt })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  if (!me) return 0;

  // Null means never looked. `> null` is null in SQL and would count nothing,
  // which is the opposite of what never-looked should mean.
  const since = me.seenAt ?? new Date(0);

  const [letIn] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.eventParticipants)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
    .where(
      and(
        eq(schema.eventParticipants.actorId, actorId),
        ne(schema.events.createdBy, actorId),
        isNull(schema.events.deletedAt),
        gt(schema.eventParticipants.firstSeenAt, since),
      ),
    );

  /*
   * An invitation waiting on an answer counts regardless of when it was seen.
   *
   * Everything else on this badge is news — you were let in, a host answered —
   * and news stops being news once looked at. An unanswered question does not:
   * it is still unanswered after you have read it, and a badge that cleared
   * would be the product forgetting something it asked you.
   */
  const [offered] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.eventInvites)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventInvites.eventId))
    .where(
      and(
        eq(schema.eventInvites.actorId, actorId),
        eq(schema.eventInvites.status, 'open'),
        isNull(schema.events.deletedAt),
      ),
    );

  const [refused] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.eventAccessRequests)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventAccessRequests.eventId))
    .where(
      and(
        eq(schema.eventAccessRequests.actorId, actorId),
        eq(schema.eventAccessRequests.status, 'declined'),
        isNull(schema.events.deletedAt),
        isNotNull(schema.eventAccessRequests.resolvedAt),
        gt(schema.eventAccessRequests.resolvedAt, since),
      ),
    );

  return (letIn?.n ?? 0) + (refused?.n ?? 0) + (offered?.n ?? 0);
}

/**
 * The boundary, read before it is moved.
 *
 * One timestamp for the whole list rather than a flag per line — the cost
 * `activity.ts` names at the top of itself, and the reason the feed can be
 * derived at all. Activity needs it to mark which rows arrived since the last
 * look, and it has to be read *before* `markInvitesSeen` runs on the same
 * render, or every row is read the moment it is drawn and nothing is ever new.
 *
 * Null means never looked, which the caller has to treat as "everything is
 * new" rather than as "nothing is": comparing against null in SQL returns
 * null, and in JavaScript returns false, and both are the wrong answer.
 */
export async function invitesSeenAtFor(
  db: Db,
  actorId: string | null,
): Promise<Date | null> {
  if (!actorId) return null;
  const [me] = await db
    .select({ seenAt: schema.actors.invitesSeenAt })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  return me?.seenAt ?? null;
}

/** Looking is what clears it. Called when the Invites page renders. */
export async function markInvitesSeen(db: Db, actorId: string | null): Promise<void> {
  if (!actorId) return;
  await db
    .update(schema.actors)
    .set({ invitesSeenAt: new Date() })
    .where(eq(schema.actors.id, actorId));
}

export type PendingInvite = {
  id: string;
  eventId: string;
  eventName: string;
  /** The host's line under the name, if they wrote one. */
  caption: string | null;
  /** Who asked. A name, because deciding needs to know from whom. */
  from: string;
  createdAt: string;
};

/**
 * Invitations waiting on an answer from this person.
 *
 * Only `open` ones. A declined invitation stays in the table so the same host
 * cannot ask again by accident and so the record survives, but it is not a
 * thing anybody is waiting on, and a list of decisions already made is not a
 * list somebody wants.
 */
export async function pendingInvites(
  db: Db,
  actorId: string | null,
): Promise<PendingInvite[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      id: schema.eventInvites.id,
      eventId: schema.events.id,
      eventName: schema.events.name,
      caption: schema.events.caption,
      createdAt: schema.eventInvites.createdAt,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.eventInvites)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventInvites.eventId))
    .innerJoin(
      schema.actors,
      eq(schema.actors.id, schema.eventInvites.invitedByActorId),
    )
    .where(
      and(
        eq(schema.eventInvites.actorId, actorId),
        eq(schema.eventInvites.status, 'open'),
        // An invitation to an event that has since been deleted is not an
        // invitation; it is a row pointing at nothing.
        isNull(schema.events.deletedAt),
      ),
    )
    .orderBy(desc(schema.eventInvites.createdAt));

  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    eventName: row.eventName,
    caption: row.caption,
    from: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
    createdAt: row.createdAt.toISOString(),
  }));
}
