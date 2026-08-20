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
import { and, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

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
      // Carried so a client opening an event from here can still auto-select.
      // Without them the native client falls through to the system picker for
      // every event reached through a group, which is most of them once a
      // group exists — and the reason it would is invisible.
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
    })
    .from(schema.events)
    .where(and(eq(schema.events.groupId, groupId), isNull(schema.events.deletedAt)))
    .orderBy(desc(schema.events.createdAt));
}

/**
 * The groups this actor belongs to.
 *
 * Design §1 lists persistent group identity as something native has and the
 * web does not, and this is what makes it true of the *actor* rather than of
 * a device: a list held in local storage is lost on reinstall, and a person
 * who reinstalls has not left their groups.
 *
 * A door's worth of information per group, same as search — the room is
 * behind `GET /api/groups/<id>`, which checks membership again rather than
 * trusting that this list produced the id.
 */
export async function groupsFor(db: Db, actorId: string | null) {
  if (!actorId) return [];
  return db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      role: schema.groupMembers.role,
      joinedAt: schema.groupMembers.joinedAt,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
    .where(
      and(eq(schema.groupMembers.actorId, actorId), isNull(schema.groups.deletedAt)),
    )
    .orderBy(desc(schema.groupMembers.joinedAt));
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

/**
 * How many groups the search page will offer, and how many friends it names.
 *
 * Four groups because it is a two-column grid two rows deep, and because a
 * recommendation list long enough to scroll is a feed. Two names because that
 * is how somebody says this out loud — "Priya and Dee are in that one" — and
 * the third name is where a sentence becomes a membership list.
 */
export const SUGGESTED_GROUP_LIMIT = 4;
export const MUTUALS_NAMED = 2;

/** A findable group somebody could ask to be let into, and why they might. */
export type SuggestedGroup = {
  id: string;
  name: string;
  memberCount: number;
  /** The actor's own friends who are in it — at most `MUTUALS_NAMED` of them. */
  mutuals: {
    id: string;
    name: string | null;
    handle: string | null;
    avatarKey: string | null;
  }[];
  /** All of them, including the ones not named. */
  mutualCount: number;
  /** Whether this person has already asked and is waiting on an admin. */
  asked: boolean;
};

/**
 * Findable groups this person's friends are in — the one recommendation the
 * product makes about a place rather than about a person.
 *
 * The rule it lives under is worth stating because it is the rule the whole
 * product is built on: **albums are never recommended.** Possession of the link
 * is the access model, so an album surfaced to somebody who was not sent one is
 * a door nobody opened. A group is the exception and only barely — what comes
 * back is a name, a count and nothing from inside, and the person still has to
 * ask to be let in. This is a suggestion of somewhere to knock.
 *
 * What makes it honest is the mutuals. Every group here is one a friend is
 * already in, which means it was reachable by asking that friend; naming them
 * says so on the card rather than presenting the group as something the
 * product knows about you. Nothing else about the group crosses this line — no
 * events, no photographs, no member list beyond the friends the reader has
 * themselves.
 *
 * `findable` is checked here exactly as `searchGroups` checks it: an unfindable
 * group is absent rather than returned-and-filtered, so no count or ordering
 * can betray that one exists.
 */
export async function suggestedGroupsFor(
  db: Db,
  actorId: string | null,
  limit = SUGGESTED_GROUP_LIMIT,
): Promise<SuggestedGroup[]> {
  if (!actorId) return [];

  const answer = await db.execute(sql`
    select
      g.id   as "id",
      g.name as "name",
      (
        select count(*)::int from "group_member" m where m.group_id = g.id
      )              as "memberCount",
      count(*)::int  as "mutualCount",
      json_agg(
        json_build_object(
          'id', a.id,
          'name', a.display_name,
          'handle', a.handle,
          'avatarKey', a.avatar_key
        )
        -- A stable order, so the two friends named on a card are the same two
        -- on the next visit. Someone who joined and then dropped off the line
        -- reads as the product changing its mind about who is in there.
        order by a.display_name asc, a.id asc
      )              as "mutuals",
      exists (
        select 1 from "group_join_request" r
        where r.group_id = g.id and r.actor_id = ${actorId} and r.status = 'open'
      )              as "asked"
    from "friendship" mine
    join "group_member" gm on gm.actor_id = mine.friend_actor_id
    join "groups" g on g.id = gm.group_id
    join "actor" a on a.id = mine.friend_actor_id
    where mine.actor_id = ${actorId}
      and g.findable = true
      and g.deleted_at is null
      -- Somewhere you already are is not somewhere to discover.
      and not exists (
        select 1 from "group_member" me
        where me.group_id = g.id and me.actor_id = ${actorId}
      )
    group by g.id, g.name
    -- The strongest suggestion is the one the most of your own people are in.
    order by count(*) desc, g.name asc
    limit ${limit}
  `);

  // PGlite answers `{rows}` and postgres.js answers an array. Both are true of
  // `db.execute`, and a screen that worked in tests and not in production is
  // how that was found out the first time.
  const rows = (
    Array.isArray(answer) ? answer : (answer as { rows: unknown[] }).rows
  ) as SuggestedGroup[];

  return rows.map((row) => ({
    ...row,
    // Named on the card, and the rest are a number. Sent short rather than
    // sent whole and sliced in the browser: a card that draws two faces has no
    // use for the other nine, and they would be nine names in the payload.
    mutuals: row.mutuals.slice(0, MUTUALS_NAMED),
  }));
}

function sqlIlike(term: string) {
  // Escapes the wildcards so a search for "100%" does not match everything.
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return ilike(schema.groups.name, `%${escaped}%`);
}

/**
 * The groups you are in, with enough to tell them apart.
 *
 * `groupsFor` answers the same question in one line each and is what the
 * native client reads on launch — a name, a role and nothing to pay for. This
 * is the page's version: the same list, plus the two numbers that make a group
 * recognisable at a glance and the last time anything happened in one.
 *
 * Kept separate rather than widening `groupsFor`, because that call happens on
 * every app launch before anybody has asked for a group screen, and these are
 * two more aggregates per row for a list nobody has opened.
 *
 * Ordered by what happened most recently, not by when you joined. A list of
 * rooms should be in the order they are worth looking in; `joined_at` puts the
 * group you were added to yesterday above the one you have been posting in for
 * a year.
 */
export type MyGroup = {
  id: string;
  name: string;
  role: 'member' | 'admin';
  memberCount: number;
  albumCount: number;
  /** ISO, from the newest album in it. Null for a group with no albums yet. */
  lastActiveAt: string | null;
};

export async function myGroups(db: Db, actorId: string | null): Promise<MyGroup[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      role: schema.groupMembers.role,
      /*
       * Correlated subselects rather than joins.
       *
       * Joining members and events at once multiplies the rows against each
       * other — three members and four albums is twelve, and both counts come
       * back as twelve. `count(distinct)` would paper over it and hide the
       * shape of the mistake from whoever adds a third join.
       */
      memberCount: sql<number>`(
        select count(*)::int from "group_member" m
        where m.group_id = ${schema.groups.id}
      )`,
      albumCount: sql<number>`(
        select count(*)::int from "event" e
        where e.group_id = ${schema.groups.id} and e.deleted_at is null
      )`,
      lastActiveAt: sql<Date | null>`(
        select max(e.last_active_at) from "event" e
        where e.group_id = ${schema.groups.id} and e.deleted_at is null
      )`,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
    .where(
      and(eq(schema.groupMembers.actorId, actorId), isNull(schema.groups.deletedAt)),
    );

  return rows
    .map((row) => ({
      ...row,
      lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt).toISOString() : null,
    }))
    /*
     * Newest activity first, and a group with nothing in it last rather than
     * first. Sorting nulls naively puts the empty group at the top, which is
     * the one with least to show.
     */
    .sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
}
