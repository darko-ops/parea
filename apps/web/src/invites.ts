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
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

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
