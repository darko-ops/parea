/**
 * Who is in an event.
 *
 * Members, not contributors — the two are different lists and the product uses
 * both. `contributors.ts` answers "whose photographs are these", which is what
 * the filter row and the mention list need. This answers "who is in here",
 * which is what the head's faces and the Members tab show, and it includes the
 * people who have been let in and not added anything yet.
 *
 * Deliberately visible to everybody in the event rather than to the host
 * alone. That is a change in what an event discloses: it was possible to be in
 * one without knowing who else was, and it is not any more. The reasoning is
 * that a thread already prints the name of anybody who speaks in it, an album
 * is a room rather than a broadcast, and "who else can see this photograph of
 * me" is a question the people in it are entitled to an answer to.
 */

import { schema } from '@parea/core';
import { asc, eq } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import type { Db } from './db';

export type Member = {
  actorId: string;
  /** Display name, else handle, else "Someone" — never an id. */
  name: string;
  handle: string | null;
  /** Presigned and short-lived; null both for "no picture" and "not an account". */
  avatarUrl: string | null;
  /** Whose event it is. Drawn first and labelled. */
  isCreator: boolean;
};

/**
 * Everyone, oldest first, with the creator lifted to the front.
 *
 * Bounded, and the bound is high rather than tight: this is one query per
 * event page and an album with more than this many people in it is not a thing
 * the product has yet. It exists so that a runaway — a link pasted somewhere
 * public — cannot turn one page render into a thousand presigned URLs.
 */
export const MEMBER_LIMIT = 200;

export async function membersOf(db: Db, eventId: string): Promise<Member[]> {
  const [event] = await db
    .select({ createdBy: schema.events.createdBy })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));

  const rows = await db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.eventParticipants)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.eventParticipants.actorId))
    .where(eq(schema.eventParticipants.eventId, eventId))
    .orderBy(asc(schema.eventParticipants.firstSeenAt))
    .limit(MEMBER_LIMIT);

  const members = await Promise.all(
    rows.map(async (row) => ({
      actorId: row.actorId,
      name:
        row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
      handle: row.handle,
      // Presigned here, one HMAC per row and no round trip. The key itself
      // never crosses the boundary; see `accounts.avatarUrl`.
      avatarUrl: await avatarUrl(row.avatarKey),
      isCreator: row.actorId === event?.createdBy,
    })),
  );

  // The host first, then arrival order. Sorted after the query rather than in
  // it because "is the creator" is a comparison against another table's column
  // and an ORDER BY expression for it reads far worse than one line here.
  return members.sort((a, b) => Number(b.isCreator) - Number(a.isCreator));
}
