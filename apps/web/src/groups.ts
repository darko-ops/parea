/**
 * Group membership and access — docs/design.md §3.
 *
 * Two ways in, and the difference is the whole design:
 *
 *   From an event you were already in. No approval, because there is nothing
 *   to approve — you had access to those photos already, and joining the group
 *   is just saying "keep me in the loop for the next one". This is the opt-in
 *   taken *after* value has been delivered, which is the same principle as the
 *   account ask.
 *
 *   From search. You found a name and know nothing else, so an admin decides.
 */

import { schema } from '@parea/core';
import { and, count, desc, eq, ilike, isNull } from 'drizzle-orm';

import type { Db } from './db';

export type GroupRow = typeof schema.groups.$inferSelect;

export type Membership = { role: 'member' | 'admin' } | null;

export async function findGroup(db: Db, id: string): Promise<GroupRow | null> {
  const [row] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, id), isNull(schema.groups.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function membershipOf(
  db: Db,
  groupId: string,
  actorId: string | null,
): Promise<Membership> {
  if (!actorId) return null;
  const [row] = await db
    .select({ role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupId, groupId),
        eq(schema.groupMembers.actorId, actorId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function memberCount(db: Db, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));
  return row?.n ?? 0;
}

/**
 * Whether this actor took part in an event belonging to this group.
 *
 * The qualification for joining without approval. Deliberately checks
 * participation rather than mere possession of a link: someone forwarded a
 * link and never used it has no standing, while someone who contributed does.
 */
export async function participatedInGroup(
  db: Db,
  groupId: string,
  actorId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: schema.eventParticipants.actorId })
    .from(schema.eventParticipants)
    .innerJoin(schema.events, eq(schema.eventParticipants.eventId, schema.events.id))
    .where(
      and(
        eq(schema.events.groupId, groupId),
        eq(schema.eventParticipants.actorId, actorId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function addMember(
  db: Db,
  groupId: string,
  actorId: string,
  role: 'member' | 'admin' = 'member',
): Promise<void> {
  await db
    .insert(schema.groupMembers)
    .values({ groupId, actorId, role })
    .onConflictDoNothing();
}

/**
 * The group's events, newest first.
 *
 * Members only — this is the room, not the door. Note it returns events, never
 * photos: a photo is only ever reachable through an event, which is what keeps
 * a future per-collection access rule expressible.
 */
export async function groupEvents(db: Db, groupId: string) {
  return db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      linkToken: schema.events.linkToken,
      eventDate: schema.events.eventDate,
      createdAt: schema.events.createdAt,
    })
    .from(schema.events)
    .where(and(eq(schema.events.groupId, groupId), isNull(schema.events.deletedAt)))
    .orderBy(desc(schema.events.createdAt));
}

/**
 * Name search over findable groups.
 *
 * Returns a door and nothing more: name and member count, no events, no
 * photos, no member names. Unfindable groups are absent entirely rather than
 * returned-and-filtered, so a query cannot confirm that a private group with a
 * given name exists.
 */
export async function searchGroups(db: Db, query: string, limit = 20) {
  const term = query.trim();
  if (term.length < 2) return [];

  const rows = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      memberCount: count(schema.groupMembers.actorId),
    })
    .from(schema.groups)
    .leftJoin(schema.groupMembers, eq(schema.groupMembers.groupId, schema.groups.id))
    .where(
      and(
        eq(schema.groups.findable, true),
        isNull(schema.groups.deletedAt),
        // ILIKE on a short list; a trigram index is the fix if this ever
        // matters, and it will not for a long time.
        sqlIlike(term),
      ),
    )
    .groupBy(schema.groups.id, schema.groups.name)
    .limit(limit);

  return rows;
}

function sqlIlike(term: string) {
  // Escapes the wildcards so a search for "100%" does not match everything.
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return ilike(schema.groups.name, `%${escaped}%`);
}
