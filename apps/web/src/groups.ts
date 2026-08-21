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
import { and, asc, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import type { Db } from './db';
import { invitable } from './friends';
import { imageSrc } from './images';
import { getStorage } from './storage';

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

/**
 * The lens a group's tile is drawn in.
 *
 * By a stable hash of the id, so a group keeps its colour between visits — a
 * list whose colours reshuffle on every load is decoration rather than a way
 * of telling two rooms apart. Here rather than in a page because three screens
 * draw the same tile now, and the whole point is that the room you clicked is
 * recognisably the one you arrive in.
 *
 * The tile is always a letter and never a photograph, on every one of them.
 */
const LENSES = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

export function lensFor(id: string): { fill: string; ink: string } {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LENSES[hash % LENSES.length]!;
}

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
 * product is built on: **events are never recommended.** Possession of the link
 * is the access model, so an event surfaced to somebody who was not sent one is
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
  eventCount: number;
  /** ISO, from the newest event in it. Null for a group with no events yet. */
  lastActiveAt: string | null;
};

/**
 * The same list, plus what the group screen's rows draw.
 *
 * Kept as a second function rather than a flag on `myGroups`, because the
 * extra work is not a column or two: it is three events with a signed cover
 * each and three presigned faces, per group. The native client and the
 * endpoint's default still ask the cheap question.
 *
 * ## The covers are allowed here, and the tile is still a letter
 *
 * `.group-tile` says a group's tile must never carry a photograph, because
 * borrowing one from inside would put a picture from a room on a screen that
 * is only the door to it. That reasoning is about *the door* — the search
 * page's card, where the viewer may not be a member — and it stands there
 * untouched. This list is `myGroups`: the viewer is in every group on it, the
 * page is `force-dynamic`, and a removed member's next load has no row and so
 * no covers. The tile itself is unchanged in both places.
 */
export type MyGroupDetailed = MyGroup & {
  /** Up to three, newest first. Fewer when the group has fewer. */
  events: GroupEvent[];
  /** Up to three member pictures, admins first. Null draws a letter. */
  faces: { name: string; avatarUrl: string | null }[];
  /** Everybody the three faces do not show. Zero draws no chip. */
  moreFaces: number;
};

/** How many events a group's row previews before "View all N" takes over. */
export const GROUP_STRIP = 3;
/** How many faces the stack beside a group's name shows. */
export const GROUP_FACES = 3;

export async function myGroupsDetailed(
  db: Db,
  actorId: string | null,
  since: Date,
): Promise<MyGroupDetailed[]> {
  const groups = await myGroups(db, actorId);

  return Promise.all(
    groups.map(async (group) => {
      const [events, people] = await Promise.all([
        groupArchive(db, group.id, actorId, since, GROUP_STRIP),
        groupPeople(db, group.id),
      ]);
      return {
        ...group,
        events,
        faces: people.slice(0, GROUP_FACES).map((person) => ({
          name: person.name,
          avatarUrl: person.avatarUrl,
        })),
        moreFaces: Math.max(0, people.length - GROUP_FACES),
      };
    }),
  );
}

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
       * other — three members and four events is twelve, and both counts come
       * back as twelve. `count(distinct)` would paper over it and hide the
       * shape of the mistake from whoever adds a third join.
       */
      memberCount: sql<number>`(
        select count(*)::int from "group_member" m
        where m.group_id = ${schema.groups.id}
      )`,
      eventCount: sql<number>`(
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

/**
 * The newest ready photograph in an event, as the event's picture.
 *
 * The cover if the host set one, else this. Same rule `leadImage` follows, so
 * "the picture the event leads with" means one thing everywhere — a group's
 * strip and the event's own card should not disagree about which photograph
 * stands for it.
 */
const EVENT_SHOT = sql<{ storageKey: string; hash: string | null } | null>`(
  select json_build_object(
    'storageKey', p.storage_key,
    'hash', encode(p.content_hash, 'hex')
  )
  from "photo" p
  where p.event_id = "event".id
    and p.status = 'ready' and p.deleted_at is null
  order by p.uploaded_at desc
  limit 1
)`;

/**
 * How many photographs have arrived in an event since this person last looked.
 *
 * A deliberate substitution, and worth stating plainly: the design asks for
 * "added to since you last opened it", and there is no such timestamp. Nothing
 * in the schema records when somebody opened an event — `event_participant`
 * holds `first_seen_at` and nothing else — and adding one means writing a read
 * receipt on every event view, which is a record of when a person looked at
 * something that this product has no other reason to keep. `activity.ts`
 * already turns that trade down for the thread, for the same reason.
 *
 * So the boundary is the one the product already keeps: `invites_seen_at`,
 * which is what Activity means by "since you last looked". It clears when you
 * check Activity rather than when you open the event — a coarser promise than
 * the design's, made out of a fact that already exists rather than a new one
 * kept about somebody.
 *
 * Never your own photographs: something you added is not news to you.
 */
const FRESH = (actorId: string, since: Date) => sql<number>`(
  select count(*)::int from "photo" p
  where p.event_id = "event".id
    and p.status = 'ready' and p.deleted_at is null
    and p.uploader_id is distinct from ${actorId}
    -- Bound as text and cast, not as a Date. The driver hands a Date straight
    -- to its binary encoder here and it arrives at a path expecting a string,
    -- which fails at bind time rather than in SQL — an error that reads like a
    -- broken query and is not one.
    and p.uploaded_at > ${since.toISOString()}::timestamptz
)`;

/** An event as a group screen draws it. */
export type GroupEvent = {
  id: string;
  name: string;
  /** Presigned, or null for an event with nothing in it yet. */
  cover: string | null;
  photoCount: number;
  /** Contributor pictures, at most three, plus how many people in total. */
  faces: (string | null)[];
  people: number;
  /** ISO date the event is filed under. `eventDate`, else its first activity. */
  at: string;
  /** Arrived since this person last looked. Zero draws no pip. */
  fresh: number;
};

/**
 * The events in a group, newest first.
 *
 * Replaces the four bare links `groupEvents` fed the group screen: a product
 * whose subject is photographs was drawing its archive as a list of blue words
 * and a raw ISO date. Everything here is what makes a row recognisable — the
 * picture, who is in it, how much of it there is, and when.
 *
 * Members only, exactly as `groupEvents` was: this is the room, not the door.
 * Still events and never photos, so a per-event rule stays expressible.
 */
export async function groupArchive(
  db: Db,
  groupId: string,
  actorId: string | null,
  since: Date,
  limit?: number,
): Promise<GroupEvent[]> {
  const rows = await db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      capEpoch: schema.events.capEpoch,
      coverKey: schema.events.coverKey,
      eventDate: schema.events.eventDate,
      lastActiveAt: schema.events.lastActiveAt,
      createdAt: schema.events.createdAt,
      shot: EVENT_SHOT,
      photoCount: sql<number>`(
        select count(*)::int from "photo" p
        where p.event_id = "event".id
          and p.status = 'ready' and p.deleted_at is null
      )`,
      people: sql<number>`(
        select count(*)::int from "event_participant" ep
        where ep.event_id = "event".id
      )`,
      /*
       * Three contributor avatars, as keys, in arrival order.
       *
       * `array_agg` over a lateral rather than a join, for the reason every
       * other count on this row is a subselect: joining participants would
       * multiply the photo count by the number of people.
       */
      faceKeys: sql<(string | null)[]>`coalesce((
        select array_agg(a.avatar_key)
        from (
          select ep2.actor_id
          from "event_participant" ep2
          where ep2.event_id = "event".id
          order by ep2.first_seen_at asc
          limit 3
        ) picked
        join "actor" a on a.id = picked.actor_id
      ), '{}')`,
      fresh: actorId ? FRESH(actorId, since) : sql<number>`0`,
    })
    .from(schema.events)
    .where(and(eq(schema.events.groupId, groupId), isNull(schema.events.deletedAt)))
    .orderBy(desc(schema.events.lastActiveAt))
    .limit(limit ?? 200);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      cover: await eventCover(row),
      photoCount: row.photoCount,
      faces: await Promise.all((row.faceKeys ?? []).map((key) => avatarUrl(key))),
      people: row.people,
      // The event's own date when the host gave it one, else when it was last
      // added to — never `created_at`, which is when somebody made the page.
      at: (row.eventDate
        ? new Date(`${row.eventDate}T00:00:00Z`)
        : row.lastActiveAt
      ).toISOString(),
      fresh: row.fresh,
    })),
  );
}

/** The cover the host chose, else the newest photograph, else nothing. */
async function eventCover(row: {
  id: string;
  capEpoch: number;
  coverKey: string | null;
  shot: { storageKey: string; hash: string | null } | null;
}): Promise<string | null> {
  if (row.coverKey) return getStorage().presignGet(row.coverKey, 3600);
  if (!row.shot) return null;
  // `grid` rather than `thumb`. These are drawn at 180px and at a third of an
  // 820px column, which on a 2× screen is 360 and 520 device pixels — a 320px
  // thumbnail is soft at both, which is the mistake the event cards already
  // made once.
  return imageSrc(
    {
      eventId: row.id,
      storageKey: row.shot.storageKey,
      contentHash: row.shot.hash ? Buffer.from(row.shot.hash, 'hex') : null,
    },
    'grid',
    row.capEpoch,
  );
}

/** Somebody in a group, for the faces on both screens. */
export type GroupPerson = {
  actorId: string;
  name: string;
  /** The first name only, for the label under a face. */
  firstName: string;
  avatarUrl: string | null;
  role: 'member' | 'admin';
};

/**
 * Everybody in a group: admins first, then by how long they have been in it.
 *
 * The design asks for "admins first, then most recently active", and gives its
 * own reason — "so the stack is stable between loads rather than reshuffling".
 * Most-recently-active is the one ordering that does not hold still: it moves
 * every time anybody adds a photograph, which is exactly the reshuffle the
 * requirement exists to prevent. Joining order does hold still, and is the
 * order the room actually filled up in.
 */
export async function groupPeople(db: Db, groupId: string): Promise<GroupPerson[]> {
  const rows = await db
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
      role: schema.groupMembers.role,
      joinedAt: schema.groupMembers.joinedAt,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.groupMembers.actorId))
    .where(eq(schema.groupMembers.groupId, groupId))
    .orderBy(asc(schema.groupMembers.joinedAt))
    .limit(200);

  const people = await Promise.all(
    rows.map(async (row) => {
      const name = row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone');
      return {
        actorId: row.actorId,
        name,
        firstName: name.replace(/^@/, '').split(/\s+/)[0]!,
        avatarUrl: await avatarUrl(row.avatarKey),
        role: row.role,
      };
    }),
  );

  return people.sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin'));
}

/**
 * Asking somebody into a group, rather than waiting to be asked.
 *
 * Shaped after the event invite in `app/api/events/[id]/invites`, because it
 * is the same act about a different room, and the two answer to the same
 * screen. Three properties carry over and each is load-bearing:
 *
 *   - **Only an admin may ask.** The group's equivalent of `administer`. This
 *     is not a way for anybody in a group to pull people into it — which
 *     matters more here than for an event, because otherwise the approval on
 *     `group_join_request` is trivially bypassed by asking a friend inside to
 *     invite you.
 *   - **Being invited is an offer, not a fact.** It would be one line to write
 *     the membership outright and it would mean one person's guest list
 *     writing itself into another person's account. The row is `open` until
 *     answered, and accepting is what makes somebody a member.
 *   - **Blocks are the consent gate.** `invitable` refuses a guest device, a
 *     merged actor, and either direction of a block. It is the same check the
 *     event path makes and the only thing standing between somebody and being
 *     added by a person they have cut off.
 *
 * The bypass question this raises is worth answering out loud: an invitation
 * *does* skip the join request, and it has to, because the person who would
 * approve that request is the person who sent this. One rule taken in two
 * directions — an admin decides who is in the group.
 */
export async function inviteToGroup(
  db: Db,
  groupId: string,
  invitedBy: string,
  targets: string[],
): Promise<string[]> {
  const invited: string[] = [];

  for (const target of targets) {
    if (target === invitedBy) continue;
    if (!(await invitable(db, invitedBy, target))) continue;
    // Somebody already in it is not somebody to ask.
    if (await membershipOf(db, groupId, target)) continue;

    /*
     * Asking again does not overwrite an answer. `onConflictDoNothing` rather
     * than an upsert: re-inviting somebody who declined would turn "no" back
     * into "waiting", which is an admin overruling a decision that was not
     * theirs to make.
     */
    const [row] = await db
      .insert(schema.groupInvites)
      .values({ groupId, actorId: target, invitedByActorId: invitedBy })
      .onConflictDoNothing()
      .returning({ id: schema.groupInvites.id });
    if (row) invited.push(target);
  }

  return invited;
}

/**
 * Answering one. Returns false for an invitation that is not this person's to
 * answer, or that has already been answered.
 *
 * Scoped by actor in the statement rather than checked first and written
 * second: two statements is a window, and the window is "may I answer this"
 * asked about a row something else could have changed. The same shape
 * `editMessage` uses, for the same reason.
 *
 * Accepting writes the membership inside the same call, so there is no state
 * where an invitation is accepted and the person is not in the group.
 */
export async function answerGroupInvite(
  db: Db,
  inviteId: string,
  actorId: string,
  accept: boolean,
): Promise<boolean> {
  const [row] = await db
    .update(schema.groupInvites)
    .set({
      status: accept ? 'accepted' : 'declined',
      respondedAt: new Date(),
    })
    .where(
      and(
        eq(schema.groupInvites.id, inviteId),
        eq(schema.groupInvites.actorId, actorId),
        eq(schema.groupInvites.status, 'open'),
      ),
    )
    .returning({ groupId: schema.groupInvites.groupId });

  if (!row) return false;
  if (accept) await addMember(db, row.groupId, actorId);
  return true;
}

/** An open invitation, as the screen that answers it needs it. */
export type PendingGroupInvite = {
  id: string;
  groupId: string;
  groupName: string;
  /** Who asked. Deciding needs to know from whom. */
  from: string;
  createdAt: string;
};

/**
 * Group invitations waiting on an answer from this person.
 *
 * Only `open` ones. A declined invitation stays in the table so the same admin
 * cannot ask again by accident and so the record survives, but it is not a
 * thing anybody is waiting on — the same rule `pendingInvites` follows for
 * events, and the reason the two read alike.
 */
export async function pendingGroupInvites(
  db: Db,
  actorId: string | null,
): Promise<PendingGroupInvite[]> {
  if (!actorId) return [];

  const rows = await db
    .select({
      id: schema.groupInvites.id,
      groupId: schema.groups.id,
      groupName: schema.groups.name,
      createdAt: schema.groupInvites.createdAt,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.groupInvites)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupInvites.groupId))
    .innerJoin(
      schema.actors,
      eq(schema.actors.id, schema.groupInvites.invitedByActorId),
    )
    .where(
      and(
        eq(schema.groupInvites.actorId, actorId),
        eq(schema.groupInvites.status, 'open'),
        // An invitation to a group that has since been deleted is not an
        // invitation; it is a row pointing at nothing.
        isNull(schema.groups.deletedAt),
      ),
    )
    .orderBy(desc(schema.groupInvites.createdAt));

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    from: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Who has already been asked and not answered, so the picker can say so. */
export async function invitedTo(db: Db, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ actorId: schema.groupInvites.actorId })
    .from(schema.groupInvites)
    .where(
      and(
        eq(schema.groupInvites.groupId, groupId),
        eq(schema.groupInvites.status, 'open'),
      ),
    );
  return rows.map((row) => row.actorId);
}

/**
 * How many clusters a screen may show. Two, and the cap is the argument.
 *
 * Past two this stops reading as "I recognise these people" and starts reading
 * as a list of suggestions — which is the thing this product does not do to
 * people. A third waits until one of the first two is acted on.
 */
export const CLUSTER_LIMIT = 2;

/** Faces drawn on a cluster card before the overflow chip takes over. */
export const CLUSTER_FACES = 3;

/**
 * A set of people you keep ending up in the same events as.
 *
 * Never a group, and the copy must never call it one: it is an observation
 * about events the actor was already in, not a thing that exists. Nobody is
 * told about it, nothing is written when it is shown, and it is only ever
 * computed for the person it is about.
 */
export type Cluster = {
  /** Stable across loads, so React keys and "which card" survive a refresh. */
  key: string;
  /**
   * Everybody in it, named and faced.
   *
   * All of them, not the three the card draws: the form turns each into a
   * removable chip, and fetching the rest when somebody presses the button
   * would put a request in the one path that is meant to write and fetch
   * nothing at all.
   */
  people: { actorId: string; name: string; avatarUrl: string | null }[];
  personIds: string[];
  faces: { name: string; avatarUrl: string | null }[];
  /** Everybody past `CLUSTER_FACES`, as a number for the overflow chip. */
  moreFaces: number;
  /** "Priya, Tomás, Maya + 8 others" — worded here, drawn as one string. */
  names: string;
  sharedEventCount: number;
  /** Borrowed from the most recent shared event, or null when none fits. */
  suggestedName: string | null;
};

/**
 * Event names that say *that* something happened and not *which*.
 *
 * Borrowed as a group name they are worse than nothing: "Photos" names every
 * group the same, and a name you have to fix is more work than a name you have
 * to write. The form drops its suggestion and its hint line for these.
 */
const GENERIC = new Set([
  'photos',
  'pics',
  'pictures',
  'event',
  'party',
  'trip',
  'weekend',
  'dinner',
  'holiday',
  'vacation',
  'birthday',
  'wedding',
  'untitled',
]);

const MONTHS =
  /,?\s+(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

/**
 * The name to offer for a group made from a cluster.
 *
 * The most recent shared event's name, dated. "Naxos, September" becomes
 * "Naxos 2025": the month goes because the year is about to be added and
 * "Naxos, September 2025" is a filing reference, and the year goes on because
 * these are recurring — a group named "Naxos" alongside next year's is two
 * rooms with one name.
 *
 * A name that already carries a year is left exactly as it is. A generic one
 * is refused rather than improved, and the form asks for a name instead.
 */
export function suggestedNameFrom(name: string | null, when: Date | null): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  const bare = trimmed.replace(MONTHS, '').trim();
  if (!bare || GENERIC.has(bare.toLowerCase())) return null;
  if (/\b\d{4}\b/.test(bare)) return bare;
  return when ? `${bare} ${when.getUTCFullYear()}` : bare;
}

/**
 * The people who keep turning up in the same events as this actor.
 *
 * ## What makes this safe to show
 *
 * Every row behind it is an event the actor is a participant of, so it reveals
 * nothing they could not already read. It is computed per request for one
 * person, never stored, never sent to anybody, and pressing the button it sits
 * beside still writes nothing — see `CreateGroupCard`.
 *
 * ## Why the cluster is the exact set of shared events
 *
 * People are grouped by the *set* of events they share with the actor, so a
 * cluster is "the four of us who were at these three evenings" rather than a
 * bag of people with something loosely in common. Exact equality rather than
 * overlap because overlap has no natural stopping point: two people sharing
 * one event with a third pull in everybody within two hops, and the card ends
 * up naming somebody the actor met once. The cost is that one person missing
 * from one evening splits the cluster, which is the failure that shows nothing
 * rather than the failure that shows the wrong people.
 *
 * ## The shape of the query
 *
 * One statement. This runs on every `/groups` load, so the thing it must not
 * be is a lookup per candidate: the co-presence join is done in the database
 * against `event_participant`'s primary key, and only the clustering — over a
 * result set bounded by the actor's own events — happens here.
 */
export async function recurringClusters(
  db: Db,
  actorId: string | null,
): Promise<Cluster[]> {
  if (!actorId) return [];

  const rows = (await db.execute(sql`
    with mine as (
      select p.event_id
      from event_participant p
      join event e on e.id = p.event_id and e.deleted_at is null
      where p.actor_id = ${actorId}
    ),
    shared as (
      select p.actor_id, p.event_id
      from event_participant p
      join mine on mine.event_id = p.event_id
      where p.actor_id <> ${actorId}
    ),
    recurring as (
      select actor_id from shared group by actor_id having count(*) >= 2
    )
    select
      s.actor_id      as actor_id,
      a.display_name  as display_name,
      a.handle        as handle,
      a.avatar_key    as avatar_key,
      s.event_id      as event_id,
      e.name          as event_name,
      coalesce(e.event_date::timestamptz, e.starts_at, e.created_at) as event_at
    from shared s
    join recurring r on r.actor_id = s.actor_id
    join actor a on a.id = s.actor_id
    join event e on e.id = s.event_id
    -- A guest device is not somebody to put in a group: being added has to
    -- mean something that survives the browser it happened in. The same rule
    -- invitable() applies, which the create route applies again on the way in.
    where a.account_id is not null and a.merged_into_id is null
    order by s.actor_id, s.event_id
    limit 2000
  `)) as unknown as Record<string, unknown>[] | { rows: Record<string, unknown>[] };

  // `db.execute` answers a `{ rows }` object on postgres.js and a bare array on
  // PGlite. Both appear in this codebase — production and the test suite — so
  // neither shape may be assumed.
  const all: Record<string, unknown>[] = Array.isArray(rows) ? rows : (rows.rows ?? []);
  if (all.length === 0) return [];

  type Person = { id: string; name: string; avatarKey: string | null; events: Set<string> };
  const people = new Map<string, Person>();
  const events = new Map<string, { name: string; at: Date | null }>();

  for (const row of all) {
    const id = String(row.actor_id);
    const eventId = String(row.event_id);
    let person = people.get(id);
    if (!person) {
      const display = (row.display_name as string | null)?.trim();
      const handle = row.handle as string | null;
      person = {
        id,
        name: display || (handle ? `@${handle}` : 'Someone'),
        avatarKey: (row.avatar_key as string | null) ?? null,
        events: new Set(),
      };
      people.set(id, person);
    }
    person.events.add(eventId);
    if (!events.has(eventId)) {
      const at = row.event_at ? new Date(row.event_at as string) : null;
      events.set(eventId, {
        name: String(row.event_name ?? ''),
        at: at && !Number.isNaN(at.getTime()) ? at : null,
      });
    }
  }

  const byShape = new Map<string, Person[]>();
  for (const person of people.values()) {
    const shape = [...person.events].sort().join(',');
    const bucket = byShape.get(shape);
    if (bucket) bucket.push(person);
    else byShape.set(shape, [person]);
  }

  /*
   * Everybody the actor is already in a group with, per group.
   *
   * A cluster whose people are all together in one room already is not a
   * recognition, it is the product telling somebody about something they did
   * last week. This is the check that stops the section nagging, which is why
   * dismissal is not built.
   */
  const grouped = await db
    .select({ groupId: schema.groupMembers.groupId, actorId: schema.groupMembers.actorId })
    .from(schema.groupMembers)
    .where(
      sql`${schema.groupMembers.groupId} in (
        select group_id from group_member where actor_id = ${actorId}
      )`,
    );
  const rooms = new Map<string, Set<string>>();
  for (const row of grouped) {
    const room = rooms.get(row.groupId) ?? new Set<string>();
    room.add(row.actorId);
    rooms.set(row.groupId, room);
  }

  const clusters = [...byShape.entries()]
    .map(([shape, members]) => {
      const eventIds = shape.split(',');
      const newest = eventIds
        .map((id) => events.get(id))
        .reduce<{ name: string; at: Date | null } | null>(
          (best, one) =>
            !one ? best : !best || (one.at?.getTime() ?? 0) > (best.at?.getTime() ?? 0) ? one : best,
          null,
        );
      return { shape, members, sharedEventCount: eventIds.length, newest };
    })
    // Already all in one room together. The actor is in every one of their own
    // groups, so only the other members have to be checked.
    .filter(
      ({ members }) =>
        ![...rooms.values()].some((room) => members.every((person) => room.has(person.id))),
    )
    /*
     * Most events shared first, then the most recent. Deterministic all the way
     * down — a card that changes places between two loads reads as a feed, and
     * the face stack has to be stable for the same reason.
     */
    .sort(
      (a, b) =>
        b.sharedEventCount - a.sharedEventCount ||
        (b.newest?.at?.getTime() ?? 0) - (a.newest?.at?.getTime() ?? 0) ||
        a.shape.localeCompare(b.shape),
    )
    .slice(0, CLUSTER_LIMIT);

  return Promise.all(
    clusters.map(async ({ shape, members, sharedEventCount, newest }) => {
      const ordered = [...members].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const shown = ordered.slice(0, CLUSTER_FACES);
      const firstNames = shown.map((person) => person.name.replace(/^@/, '').split(/\s+/)[0]!);
      const more = ordered.length - shown.length;
      const withFaces = await Promise.all(
        ordered.map(async (person) => ({
          actorId: person.id,
          name: person.name,
          avatarUrl: await avatarUrl(person.avatarKey),
        })),
      );
      return {
        key: shape,
        people: withFaces,
        personIds: ordered.map((person) => person.id),
        faces: withFaces
          .slice(0, CLUSTER_FACES)
          .map(({ name, avatarUrl: src }) => ({ name, avatarUrl: src })),
        moreFaces: more,
        // "+ N others", not "and": a set, not a sentence. The names are first
        // names because that is how somebody refers to the people they keep
        // seeing, and the surname adds length without adding recognition.
        names: more > 0 ? `${firstNames.join(', ')} + ${more} others` : firstNames.join(', '),
        sharedEventCount,
        suggestedName: suggestedNameFrom(newest?.name ?? null, newest?.at ?? null),
      };
    }),
  );
}

/** How many near-misses the create form offers. Four, per the handoff. */
export const ALSO_THERE_LIMIT = 4;

/**
 * People you have been at exactly one event with, most recent first.
 *
 * The create form's "add somebody who was not at those events" row. One event
 * is deliberately the whole rule: two or more and they are a cluster of their
 * own, which the page has already offered above; zero and they are a stranger,
 * who belongs in the member search rather than in a row of suggestions.
 *
 * Same guard as everywhere else — an account, not a passing device — so what
 * is offered here is what the create route will accept.
 */
export async function sharedOnceWith(
  db: Db,
  actorId: string | null,
  exclude: string[] = [],
): Promise<{ actorId: string; name: string; avatarUrl: string | null }[]> {
  if (!actorId) return [];

  const rows = (await db.execute(sql`
    with mine as (
      select p.event_id
      from event_participant p
      join event e on e.id = p.event_id and e.deleted_at is null
      where p.actor_id = ${actorId}
    ),
    shared as (
      select p.actor_id, p.event_id
      from event_participant p
      join mine on mine.event_id = p.event_id
      where p.actor_id <> ${actorId}
    )
    select
      s.actor_id     as actor_id,
      a.display_name as display_name,
      a.handle       as handle,
      a.avatar_key   as avatar_key,
      max(coalesce(e.event_date::timestamptz, e.starts_at, e.created_at)) as newest
    from shared s
    join actor a on a.id = s.actor_id
    join event e on e.id = s.event_id
    where a.account_id is not null and a.merged_into_id is null
    group by s.actor_id, a.display_name, a.handle, a.avatar_key
    having count(*) = 1
    order by newest desc nulls last
    limit ${ALSO_THERE_LIMIT + exclude.length}
  `)) as unknown as Record<string, unknown>[] | { rows: Record<string, unknown>[] };

  const all: Record<string, unknown>[] = Array.isArray(rows) ? rows : (rows.rows ?? []);
  const skip = new Set(exclude);

  return Promise.all(
    all
      .filter((row) => !skip.has(String(row.actor_id)))
      .slice(0, ALSO_THERE_LIMIT)
      .map(async (row) => {
        const display = (row.display_name as string | null)?.trim();
        const handle = row.handle as string | null;
        return {
          actorId: String(row.actor_id),
          name: display || (handle ? `@${handle}` : 'Someone'),
          avatarUrl: await avatarUrl((row.avatar_key as string | null) ?? null),
        };
      }),
  );
}
