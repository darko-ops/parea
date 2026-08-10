/**
 * The albums someone can reach — the data behind the app's home and profile.
 *
 * "Album" is the word the product uses out loud for what the schema calls an
 * event. They are the same thing; the schema keeps `event` because that is
 * what §3 and every policy rule call it, and renaming a table to match a label
 * would be a migration paid for nothing.
 *
 * Two ways to be in one, and both count:
 *
 *   - you presented a credential once, so there is an `event_participant` row;
 *   - you are in the group it belongs to, which reaches events you have never
 *     opened. This is what a group is *for* (§3), and it is why a member sees
 *     next Sunday's dinner without anyone sending them anything.
 *
 * Deliberately not "every event you could reach if you still had the link".
 * A link is a credential someone was sent, not a membership, and listing
 * events on the strength of one would put an album someone opened once and
 * forgot on their home screen forever.
 */

import { schema } from '@parea/core';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import type { Db } from './db';

export type Album = {
  id: string;
  name: string;
  linkToken: string;
  place: string | null;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  groupId: string | null;
  groupName: string | null;
  /** People who have been in it, which is what "members" means on a card. */
  memberCount: number;
  photoCount: number;
  lastActiveAt: string;
};

export async function albumsFor(db: Db, actorId: string | null): Promise<Album[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      linkToken: schema.events.linkToken,
      place: schema.events.place,
      eventDate: schema.events.eventDate,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
      groupId: schema.events.groupId,
      groupName: schema.groups.name,
      lastActiveAt: schema.events.lastActiveAt,
      // Counted in the query rather than per row: a home screen that issues
      // two round trips per album is a home screen that is slow at exactly
      // the point someone has a lot of them.
      memberCount: sql<number>`(
        select count(*)::int from "event_participant" ep
        where ep.event_id = ${schema.events.id}
      )`,
      photoCount: sql<number>`(
        select count(*)::int from "photo" p
        where p.event_id = ${schema.events.id}
          and p.status = 'ready' and p.deleted_at is null
      )`,
    })
    .from(schema.events)
    .leftJoin(schema.groups, eq(schema.groups.id, schema.events.groupId))
    .where(
      and(
        isNull(schema.events.deletedAt),
        or(
          sql`exists (
            select 1 from "event_participant" ep
            where ep.event_id = ${schema.events.id} and ep.actor_id = ${actorId}
          )`,
          sql`exists (
            select 1 from "group_member" gm
            where gm.group_id = ${schema.events.groupId} and gm.actor_id = ${actorId}
          )`,
        ),
      ),
    )
    // Most recently active first: a timeline is about what is happening, and
    // the album people are still adding to is the one worth being near the top.
    .orderBy(desc(schema.events.lastActiveAt));

  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    lastActiveAt: row.lastActiveAt.toISOString(),
  }));
}
