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
import { and, eq } from 'drizzle-orm';

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
          .select()
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
