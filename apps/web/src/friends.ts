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

/** What a person looks like to somebody who is not them. */
export type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
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
    })
    .from(schema.friendships)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendships.friendActorId))
    .where(eq(schema.friendships.actorId, actorId))
    .orderBy(schema.actors.handle);
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
