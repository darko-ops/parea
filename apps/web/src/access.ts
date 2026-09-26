/**
 * The single chokepoint between requests and photos — docs/design.md §6.
 *
 * `authorize()` in @parea/core is pure and knows nothing about the database.
 * This module is the other half: it resolves the relationship facts that
 * decision needs (is this actor a participant? a group admin? what code does
 * the event hold?) and then asks.
 *
 * Route handlers must go through `guard`. Nothing else should query the photo
 * table — events own photos, and there is no path to a photo that does not
 * pass an event through here first.
 */

import { authorize, denyStatus, schema } from '@parea/core';
import type { Capability, Decision, PolicyEvent } from '@parea/core';
import { and, eq, sql } from 'drizzle-orm';

import type { Db } from './db';

export type Requester = {
  actorId: string | null;
  linkToken?: string;
  code?: string;
  capEpoch?: number;
};

export type EventRow = typeof schema.events.$inferSelect;

export async function findEventByLinkToken(
  db: Db,
  linkToken: string,
): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.linkToken, linkToken))
    .limit(1);
  return row ?? null;
}

export async function findEventById(
  db: Db,
  id: string,
): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Whether this actor has claimed an account.
 *
 * Read here rather than carried on the Requester, because the Requester is
 * assembled from things the caller presented and this is not one of them: an
 * actor cannot tell us it is signed in. `accountId` is set by the sign-in
 * merge and by nothing else.
 */
export async function isSignedIn(db: Db, actorId: string | null): Promise<boolean> {
  if (!actorId) return false;
  const [row] = await db
    .select({ accountId: schema.actors.accountId })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  return row?.accountId != null;
}

async function resolveFacts(db: Db, event: EventRow, requester: Requester) {
  const [participant, membership, code] = await Promise.all([
    requester.actorId
      ? db
          .select({
            role: schema.eventParticipants.role,
            /*
             * How they got in, read off the same row rather than in a query of
             * its own.
             *
             * Two `exists` on the select that was already being made, so the
             * chokepoint costs the same number of round trips it always did —
             * and both are lookups on a primary key. They are only ever asked
             * about somebody who has a participant row, because that row is
             * what "in" means and this only says how it was earned.
             *
             * Why it is asked at all: the stored capability is a cookie in one
             * browser, and somebody who accepted an invitation on their phone
             * has that row and no cookie anywhere else. See `admitted` in
             * `authorize`.
             */
            admitted: sql<boolean>`
              exists (
                select 1 from "event_invite" i
                where i.event_id = ${event.id}
                  and i.actor_id = ${requester.actorId}
                  and i.status = 'accepted'
              ) or exists (
                select 1 from "event_access_request" r
                where r.event_id = ${event.id}
                  and r.actor_id = ${requester.actorId}
                  and r.status = 'approved'
              )`,
          })
          .from(schema.eventParticipants)
          .where(
            and(
              eq(schema.eventParticipants.eventId, event.id),
              eq(schema.eventParticipants.actorId, requester.actorId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    requester.actorId && event.groupId
      ? db
          .select()
          .from(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.groupId, event.groupId),
              eq(schema.groupMembers.actorId, requester.actorId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    // Only looked up when a code was actually presented — an event's code is
    // not something a request should be able to learn by asking.
    requester.code
      ? db
          .select()
          .from(schema.codes)
          .where(eq(schema.codes.eventId, event.id))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    isParticipant: participant.length > 0,
    /*
     * Let in by name rather than by link — an invitation accepted or a request
     * approved. Read here so `authorize` can treat it the way it treats a
     * group membership: a relationship the album's owner made, which a link
     * rotation is not about.
     */
    admitted: participant[0]?.admitted === true,
    /*
     * Off the row that was already fetched, rather than a second query.
     *
     * Being a host of an album is a property of being in it — the role lives
     * on the participant row precisely so there is no state where somebody is
     * a host of an album they have left, and no second table to disagree with
     * this one.
     */
    isEventHost: participant[0]?.role === 'host',
    isGroupMember: membership.length > 0,
    isGroupAdmin: membership[0]?.role === 'admin',
    eventCode: code[0]?.words ?? null,
  };
}

export async function decide(
  db: Db,
  event: EventRow,
  capability: Capability,
  requester: Requester,
): Promise<Decision> {
  const [facts, signedIn] = await Promise.all([
    resolveFacts(db, event, requester),
    isSignedIn(db, requester.actorId),
  ]);
  return authorize(
    requester.actorId ? { id: requester.actorId, hasAccount: signedIn } : null,
    capability,
    { event: event as PolicyEvent },
    {
      linkToken: requester.linkToken,
      code: requester.code,
      capEpoch: requester.capEpoch,
      ...facts,
    },
  );
}

export class AccessError extends Error {
  constructor(readonly status: 404 | 403, readonly reason: string) {
    super(reason);
  }
}

/**
 * Throws an AccessError on denial. Routes convert it with `toResponse`.
 *
 * Deliberately throws rather than returning a Decision: a handler that forgets
 * to check a returned value is a silent authorization bypass, while a handler
 * that forgets to catch is a 500. Fail loud.
 */
export async function guard(
  db: Db,
  event: EventRow,
  capability: Capability,
  requester: Requester,
): Promise<void> {
  const decision = await decide(db, event, capability, requester);
  if (!decision.allow) {
    throw new AccessError(denyStatus(decision.reason), decision.reason);
  }
}

export function toResponse(err: unknown): Response {
  if (err instanceof AccessError) {
    return Response.json(
      // A 404 says nothing beyond "no". Only callers who already proved access
      // learn why they were refused.
      err.status === 404 ? { error: 'not_found' } : { error: err.reason },
      { status: err.status },
    );
  }
  throw err;
}

/** Records that an actor is now "in", which is what `joins_open` gates on. */
export async function recordParticipant(
  db: Db,
  eventId: string,
  actorId: string,
): Promise<void> {
  await db
    .insert(schema.eventParticipants)
    .values({ eventId, actorId })
    .onConflictDoNothing();
}

/**
 * How many people a link rotation will actually shut out.
 *
 * Not "the participants", which is what this used to count and what the warning
 * in front of the button used to say. Three kinds of person keep access through
 * a rotation, and none of them is holding the link: whoever made the album, the
 * members of its group, and anybody let in by name — an invitation accepted or
 * a request approved. See `admitted` in `authorize` for why the last of those
 * is a credential a new link is not about.
 *
 * Here rather than in the route because it is the same question `decide` asks,
 * phrased for a whole album at once: a count that disagreed with the decision
 * would be a warning about something that is not going to happen.
 */
export async function lockedOutByRotation(
  db: Db,
  event: Pick<EventRow, 'id' | 'createdBy' | 'groupId'>,
): Promise<number> {
  /*
   * Outer columns are spelt out literally — `ep.actor_id` — rather than
   * interpolated. These are select-list subqueries, and drizzle renders
   * `${schema.eventParticipants.actorId}` in a query with no join as a bare
   * `"actor_id"`, which resolves against the *inner* table first. See
   * `correlated-subqueries.test.ts` for the two bugs that cost.
   */
  const [row] = await db
    .select({
      count: sql<number>`count(*) filter (
        where ep.actor_id <> ${event.createdBy}
          and not exists (
            select 1 from "group_member" gm
            where gm.group_id = ${event.groupId}
              and gm.actor_id = ep.actor_id
          )
          and not exists (
            select 1 from "event_invite" i
            where i.event_id = ep.event_id
              and i.actor_id = ep.actor_id
              and i.status = 'accepted'
          )
          and not exists (
            select 1 from "event_access_request" r
            where r.event_id = ep.event_id
              and r.actor_id = ep.actor_id
              and r.status = 'approved'
          )
      )::int`,
    })
    .from(sql`"event_participant" ep`)
    .where(sql`ep.event_id = ${event.id}`);

  return row?.count ?? 0;
}
