/**
 * Friends — asking, answering, and who is one.
 *
 * The product's position until now was that there is nobody to find: an
 * account was an email address, and handles existed so a host could tell who
 * was knocking. Making handles searchable is a real change to that, and the
 * things it makes possible are bounded on purpose — you can be found by your
 * handle, and the only thing being found leads to is somebody asking. Nothing
 * here lists a person's events, their photos, or who else they know.
 *
 * The shape follows the two requests that already exist, for groups and for
 * private events: a request table for the conversation, and a separate table
 * for the thing it grants. A bug in the first can lose an ask, which is
 * visible and fixable by asking again; only the second makes anyone friends.
 */

import { handleKey, schema } from '@parea/core';
import { and, eq, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm';

import type { Db } from './db';
import { hashPhone, normalisePhone } from './phone';

/**
 * What a person looks like to somebody who is not them.
 *
 * `avatarKey` is a storage key and not a URL, like `EventListing.coverKey`:
 * this type is read on the server, and every boundary that hands it to a
 * client signs it there — see `/api/friends` and `/api/people`, which emit a
 * presigned `avatar` and never the key. A key crossing that line is an
 * internal address published, and it does not expire.
 *
 * Which is also why the field is named for what it is. A `Person` handed
 * straight to a client component serialises every property it has, declared
 * in the receiving type or not, so the name is the warning.
 */
export type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  avatarKey: string | null;
};

/** The most a search will return. Enough to find who you meant, and not a page. */
export const SEARCH_LIMIT = 10;
/** Below this a search is a way to enumerate handles rather than to find one. */
export const SEARCH_MIN = 2;

/**
 * Find people by handle.
 *
 * Prefix only, and never on the display name: display names are not unique and
 * are not something anyone chose to be findable by, whereas a handle is
 * exactly that. Signed-in accounts only, so a guest actor — which exists for
 * anybody who ever opened a link — is not a person in a list.
 *
 * Blocked people are excluded in both directions. Someone you blocked should
 * not surface, and you should not surface to them: a block that still let them
 * find you and ask to be friends would be a block in name only.
 */
export async function findPeople(
  db: Db,
  actorId: string | null,
  query: string,
): Promise<Person[]> {
  const key = handleKey(query);
  if (key.length < SEARCH_MIN) return [];

  const rows = await db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.actors)
    .where(
      and(
        // An account, not a device. `account_id` is set by sign-in and nothing
        // else, which is the same test everything here uses for "a person".
        sql`${schema.actors.accountId} is not null`,
        sql`${schema.actors.mergedIntoId} is null`,
        sql`lower(${schema.actors.handle}) like ${`${key}%`}`,
        actorId ? ne(schema.actors.id, actorId) : sql`true`,
        actorId
          ? sql`not exists (
              select 1 from "block" b
              where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = ${schema.actors.id})
                 or (b.blocker_actor_id = ${schema.actors.id} and b.blocked_actor_id = ${actorId})
            )`
          : sql`true`,
      ),
    )
    .orderBy(schema.actors.handle)
    .limit(SEARCH_LIMIT);

  return rows;
}

/** Everyone this actor is friends with. */
export async function friendsOf(db: Db, actorId: string | null): Promise<Person[]> {
  if (!actorId) return [];
  return db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.friendships)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendships.friendActorId))
    .where(eq(schema.friendships.actorId, actorId))
    .orderBy(schema.actors.handle);
}

/**
 * People your friends are friends with, and you are not.
 *
 * The one suggestion this product makes about people, and it is deliberately
 * the weakest one available: a friend of a friend is somebody you can already
 * reach by asking the friend, so the suggestion saves a message rather than
 * disclosing a relationship you had no route to.
 *
 * ## What a count discloses, and what a list would
 *
 * The row says "2 mutual friends" and never which two. That is not squeamish
 * about a small number — naming them tells the person reading it who two of
 * *their own* friends are friends with, which is a fact about those two that
 * neither was asked about. The count is the same shape of information every
 * product of this kind shows, and the names are the line past it.
 *
 * ## Everybody who must not appear
 *
 * Yourself, obviously. People you are already friends with, because a
 * suggestion is an offer to ask. Anybody with a request open in either
 * direction, because asking twice is not a feature. And anybody either of you
 * has blocked — a block hides two people from each other everywhere, and a
 * suggestion screen is exactly where a missed exclusion becomes a person
 * reappearing in front of somebody who cut them off.
 */
export type Suggestion = Person & { mutuals: number };

/** Enough to be worth a screen, few enough to read. */
export const SUGGESTION_LIMIT = 12;

export async function suggestionsFor(
  db: Db,
  actorId: string | null,
): Promise<Suggestion[]> {
  if (!actorId) return [];

  const rows = await db.execute<{
    actorId: string;
    handle: string | null;
    displayName: string | null;
    avatarKey: string | null;
    mutuals: number;
  }>(sql`
    select
      a.id            as "actorId",
      a.handle        as "handle",
      a.display_name  as "displayName",
      a.avatar_key    as "avatarKey",
      count(*)::int   as "mutuals"
    from "friendship" mine
    join "friendship" theirs on theirs.actor_id = mine.friend_actor_id
    join "actor" a on a.id = theirs.friend_actor_id
    where mine.actor_id = ${actorId}
      and theirs.friend_actor_id <> ${actorId}
      -- An account, not a device: the same test everything here uses for "a
      -- person", and the same one the handle search applies.
      and a.account_id is not null
      and a.merged_into_id is null
      and not exists (
        select 1 from "friendship" f
        where f.actor_id = ${actorId} and f.friend_actor_id = a.id
      )
      and not exists (
        select 1 from "friend_request" r
        where (r.from_actor_id = ${actorId} and r.to_actor_id = a.id)
           or (r.from_actor_id = a.id and r.to_actor_id = ${actorId})
      )
      and not exists (
        select 1 from "block" b
        where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = a.id)
           or (b.blocker_actor_id = a.id and b.blocked_actor_id = ${actorId})
      )
    group by a.id, a.handle, a.display_name
    -- Most mutual friends first: the strongest suggestion is the one the most
    -- of your own people already know.
    order by count(*) desc, a.handle asc
    limit ${SUGGESTION_LIMIT}
  `);

  return [...rows];
}

/**
 * Whether what somebody typed is a number rather than a name.
 *
 * Deliberately narrow: a leading `+` and then digits. Without the `+` this
 * would have to guess a country, and a wrong guess is a lookup that silently
 * finds nobody — which reads as "they are not on here" rather than as "that is
 * not how to type it".
 */
export function looksLikePhone(query: string): boolean {
  return /^\+[\d\s()\-.]{6,}$/.test(query.trim());
}

/**
 * The one person whose number this is, if they are findable at all.
 *
 * Exact, because possession of the number is the permission: somebody who has
 * it can already ring you, and this saves them asking what your handle is. A
 * partial match would turn that into a way to walk the account table.
 *
 * The same exclusions as the handle search — yourself, and anybody either of
 * you has blocked — and the same answer shape, so nothing about the response
 * says which door it came through.
 */
export async function findByPhone(
  db: Db,
  actorId: string | null,
  query: string,
): Promise<Person[]> {
  const e164 = normalisePhone(query);
  if (!e164) return [];

  const rows = await db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.phoneHash, hashPhone(e164)),
        sql`${schema.actors.accountId} is not null`,
        sql`${schema.actors.mergedIntoId} is null`,
        actorId ? ne(schema.actors.id, actorId) : sql`true`,
        actorId
          ? sql`not exists (
              select 1 from "block" b
              where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = ${schema.actors.id})
                 or (b.blocker_actor_id = ${schema.actors.id} and b.blocked_actor_id = ${actorId})
            )`
          : sql`true`,
      ),
    )
    .limit(1);

  return rows;
}

export type FriendRequest = Person & { id: string; askedAt: string };

/** The people waiting on an answer from this actor. */
export async function requestsFor(
  db: Db,
  actorId: string | null,
): Promise<FriendRequest[]> {
  if (!actorId) return [];
  const rows = await db
    .select({
      id: schema.friendRequests.id,
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
      askedAt: schema.friendRequests.createdAt,
    })
    .from(schema.friendRequests)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendRequests.fromActorId))
    .where(
      and(
        eq(schema.friendRequests.toActorId, actorId),
        eq(schema.friendRequests.status, 'open'),
      ),
    )
    .orderBy(schema.friendRequests.createdAt);

  return rows.map((r) => ({ ...r, askedAt: r.askedAt.toISOString() }));
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ actorId: schema.friendships.actorId })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.actorId, a), eq(schema.friendships.friendActorId, b)))
    .limit(1);
  return row != null;
}

/**
 * Make two people friends, and drop the request that got them there.
 *
 * Both rows in one transaction. Half a friendship is a state nothing in the
 * product knows how to read: they would appear in one person's list and not
 * the other's, and the one who could not see it has nothing to click to fix
 * it.
 */
export async function befriend(db: Db, a: string, b: string): Promise<void> {
  if (a === b) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.friendships)
      .values([
        { actorId: a, friendActorId: b },
        { actorId: b, friendActorId: a },
      ])
      .onConflictDoNothing();
  });
}

/** Both directions, because being unfriended by half is not a state either. */
export async function unfriend(db: Db, a: string, b: string): Promise<void> {
  await db
    .delete(schema.friendships)
    .where(
      or(
        and(eq(schema.friendships.actorId, a), eq(schema.friendships.friendActorId, b)),
        and(eq(schema.friendships.actorId, b), eq(schema.friendships.friendActorId, a)),
      ),
    );
}

/**
 * Whether one person may put another into an event they host.
 *
 * Not friendship — the Members screen searches every handle, and a host who
 * can find somebody has to be able to add them. What is left is the two things
 * that were doing the real work inside the friendship check: the target is an
 * account rather than a passing device, and neither party has blocked the
 * other.
 *
 * Deliberately the same predicate `findPeople` applies, so what a host can see
 * and what a host can act on are the same set. A search that offers somebody
 * the server will then refuse is a bug that looks like a permissions message.
 */
export async function invitable(
  db: Db,
  hostId: string,
  targetId: string,
): Promise<boolean> {
  if (hostId === targetId) return false;

  const [row] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.id, targetId),
        // An account, not a guest device — being added has to mean something
        // that survives the browser it happened in.
        isNotNull(schema.actors.accountId),
        isNull(schema.actors.mergedIntoId),
        not(
          sql`exists (
            select 1 from "block" b
            where (b.blocker_actor_id = ${hostId} and b.blocked_actor_id = ${targetId})
               or (b.blocked_actor_id = ${hostId} and b.blocker_actor_id = ${targetId})
          )`,
        ),
      ),
    );

  return row != null;
}
