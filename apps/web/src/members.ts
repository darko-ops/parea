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
import { and, asc, eq } from 'drizzle-orm';

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

/**
 * The People tab: everybody in the album, and everybody who was asked and has
 * not arrived.
 *
 * `membersOf` answers "who is in here", which is what the header's faces need.
 * This is the fuller question a page devoted to people asks — how much each
 * person has put in, and who is still outstanding — and it is one query more
 * rather than one per row.
 *
 * What it deliberately does not do is invent a hierarchy. A role here is a
 * description of what somebody has done, not a rank: the host, the people who
 * have added photographs, the people who have only looked. Management is on
 * the manage screen and stays there.
 */
export type Roster = {
  actorId: string | null;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  /** How many of the photographs on this page are theirs. */
  photoCount: number;
  role: 'creator' | 'contributor' | 'viewer' | 'invited';
  /** For somebody invited and not yet arrived: when the invitation was sent. */
  invitedAt: string | null;
};

export async function rosterFor(
  db: Db,
  eventId: string,
  counts: Map<string, number>,
): Promise<Roster[]> {
  const members = await membersOf(db, eventId);

  const joined: Roster[] = members.map((member) => ({
    actorId: member.actorId,
    name: member.name,
    handle: member.handle,
    avatarUrl: member.avatarUrl,
    photoCount: counts.get(member.actorId) ?? 0,
    role: member.isCreator
      ? ('creator' as const)
      : (counts.get(member.actorId) ?? 0) > 0
        ? ('contributor' as const)
        : ('viewer' as const),
    invitedAt: null,
  }));

  /*
   * Asked and not here yet.
   *
   * Open invitations only: a declined one is a person's answer, and repeating
   * it on a roster every time somebody opens the tab would be the product
   * relaying a no on their behalf. Accepted ones are already above, as members.
   */
  const inside = new Set(members.map((member) => member.actorId));
  const invited = await db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
      createdAt: schema.eventInvites.createdAt,
    })
    .from(schema.eventInvites)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.eventInvites.actorId))
    .where(
      and(
        eq(schema.eventInvites.eventId, eventId),
        eq(schema.eventInvites.status, 'open'),
      ),
    )
    .orderBy(asc(schema.eventInvites.createdAt))
    .limit(MEMBER_LIMIT);

  const waiting: Roster[] = await Promise.all(
    invited
      .filter((row) => !inside.has(row.actorId))
      .map(async (row) => ({
        actorId: row.actorId,
        name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
        handle: row.handle,
        avatarUrl: await avatarUrl(row.avatarKey),
        photoCount: 0,
        role: 'invited' as const,
        invitedAt: row.createdAt.toISOString(),
      })),
  );

  return [...joined, ...waiting];
}
