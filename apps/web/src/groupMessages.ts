/**
 * The thread on a group, and how far anybody has read in any thread.
 *
 * ## Why this exists at all
 *
 * `event_message`'s own comment says a group thread is not coming: "those are
 * three more products, each with its own answer to 'who can see this'". The
 * objection was about access, and it is answered here rather than waived —
 * membership of the group *is* the rule, in both directions. There is no
 * capability, no link, no anonymous reader: `authorize()` does not appear in
 * this file, and `membershipOf` is the only question asked. An event has a
 * link-holder who can read without an account; a group has nobody of the kind.
 * That is what makes this one tractable and the inbox still not.
 *
 * ## What it shares with the event thread
 *
 * The `Message` shape, imported rather than redeclared, because one client
 * component draws both and a thread that behaves differently depending on
 * which room it is in is two threads to reason about. `photoId` is always
 * null — a group owns no photographs, they belong to the events under it — and
 * `reactions` is always empty; see the note on `groupMessages` in the schema.
 *
 * Blocking is enforced the same way and for the same reason: in SQL rather
 * than after the fact, so that adding a `limit` later cannot silently return a
 * short page instead of skipping the rows.
 *
 * ## Read marks
 *
 * The bottom half of this file is not about groups. It answers "how many are
 * waiting for you" for both kinds of thread, because the Groups tab asks the
 * question about both in one render and the two answers have to be computed
 * the same way or the same conversation reads differently in two places.
 */

import { schema } from '@parea/core';
import { and, asc, eq, isNull, not, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import { contributorKey } from './contributors';
import type { Db } from './db';
import { MAX_BODY, type Message } from './messages';

export { MAX_BODY };

/**
 * A group member's key, keyed on the group.
 *
 * The same construction `contributorKey` uses, with the group's id as the
 * salt. An actor id still does not cross this boundary, and the same person in
 * two groups is two different keys — which is the property that stops a client
 * correlating somebody across rooms they were never told are the same person.
 */
export function memberKey(groupId: string, actorId: string): string {
  return contributorKey(groupId, actorId);
}

/**
 * The group's thread, oldest first.
 *
 * The caller has already established membership. This module does not check
 * it — exactly as `messages.ts` does not re-check `authorize()` — because a
 * second access rule is a second place for it to be wrong.
 */
export async function groupMessagesFor(
  db: Db,
  groupId: string,
  viewerId: string | null,
): Promise<Message[]> {
  const rows = await db
    .select({
      id: schema.groupMessages.id,
      body: schema.groupMessages.body,
      createdAt: schema.groupMessages.createdAt,
      editedAt: schema.groupMessages.editedAt,
      deletedAt: schema.groupMessages.deletedAt,
      authorId: schema.groupMessages.authorActorId,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.groupMessages)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.groupMessages.authorActorId))
    .where(
      and(
        eq(schema.groupMessages.groupId, groupId),
        // Both directions, matching how blocks work everywhere else.
        viewerId
          ? not(
              sql`exists (
                select 1 from "block" b
                where (b.blocker_actor_id = ${viewerId}
                       and b.blocked_actor_id = ${schema.groupMessages.authorActorId})
                   or (b.blocked_actor_id = ${viewerId}
                       and b.blocker_actor_id = ${schema.groupMessages.authorActorId})
              )`,
            )
          : undefined,
      ),
    )
    // Time, then id — `created_at` is the transaction clock and ties are real.
    // See the long note in `messages.ts`; the bug it describes is the same bug.
    .orderBy(asc(schema.groupMessages.createdAt), asc(schema.groupMessages.id));

  if (rows.length === 0) return [];

  // One presign per author, not per message.
  const faces = new Map<string, string | null>();
  for (const row of rows) {
    if (faces.has(row.authorId)) continue;
    faces.set(row.authorId, await avatarUrl(row.avatarKey));
  }

  return rows.map((row) => {
    const deleted = row.deletedAt != null;
    return {
      id: row.id,
      body: deleted ? '' : row.body,
      createdAt: row.createdAt.toISOString(),
      edited: row.editedAt != null,
      deleted,
      // A group has no photographs of its own, and no reactions yet.
      photoId: null,
      author: {
        key: memberKey(groupId, row.authorId),
        name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
        mine: viewerId != null && row.authorId === viewerId,
        avatarUrl: faces.get(row.authorId) ?? null,
      },
      reactions: [],
    };
  });
}

/** Adds a message. The caller has already established membership. */
export async function postGroupMessage(
  db: Db,
  groupId: string,
  authorActorId: string,
  body: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.groupMessages)
    .values({ groupId, authorActorId, body })
    .returning({ id: schema.groupMessages.id });
  return row!.id;
}

/**
 * Editing, restricted to the author.
 *
 * The `eq` on the author is the authorisation, not a filter: a request naming
 * somebody else's message updates no rows and is reported as a refusal rather
 * than a silent success.
 */
export async function editGroupMessage(
  db: Db,
  messageId: string,
  actorId: string,
  body: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.groupMessages)
    .set({ body, editedAt: new Date() })
    .where(
      and(
        eq(schema.groupMessages.id, messageId),
        eq(schema.groupMessages.authorActorId, actorId),
        // An edit to a tombstone would resurrect a deleted message.
        isNull(schema.groupMessages.deletedAt),
      ),
    )
    .returning({ id: schema.groupMessages.id });
  return rows.length > 0;
}

/**
 * Deleting: the row stays, the body goes.
 *
 * Overwritten rather than flagged, so there is nothing left to leak — the same
 * decision `deleteMessage` makes about an event's thread, and the reason the
 * length CHECK permits an empty body.
 */
export async function deleteGroupMessage(
  db: Db,
  messageId: string,
  actorId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.groupMessages)
    .set({ body: '', deletedAt: new Date() })
    .where(
      and(
        eq(schema.groupMessages.id, messageId),
        eq(schema.groupMessages.authorActorId, actorId),
        isNull(schema.groupMessages.deletedAt),
      ),
    )
    .returning({ id: schema.groupMessages.id });
  return rows.length > 0;
}

/** Which group a message belongs to, for a route that was handed only its id. */
export async function groupOfMessage(db: Db, messageId: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: schema.groupMessages.groupId })
    .from(schema.groupMessages)
    .where(eq(schema.groupMessages.id, messageId))
    .limit(1);
  return row?.groupId ?? null;
}

// --- what a list of conversations needs -------------------------------------

/**
 * The one line a conversation shows when it is a row rather than a screen.
 *
 * Deliberately not a `Message`: a row draws a name, some words and a time, and
 * handing it the full shape would mean presigning an avatar and building a
 * reaction map for every conversation on the tab in order to throw both away.
 */
export type ThreadSummary = {
  /** Null for a thread nobody has said anything in. A door, not an error. */
  lastMessage: { author: string; body: string; at: string; mine: boolean } | null;
  /** Posted since this viewer last read it. Zero for a signed-out viewer. */
  unreadCount: number;
};

export const EMPTY_SUMMARY: ThreadSummary = { lastMessage: null, unreadCount: 0 };

/**
 * A name for a row, without presigning anything.
 *
 * "Someone" rather than a blank is the same fallback the thread itself uses;
 * a row that reads `: whose is the one of the table?` is worse than a row that
 * names nobody in particular.
 */
const nameOf = (displayName: string | null, handle: string | null) =>
  displayName?.trim() || (handle ? `@${handle}` : 'Someone');

/**
 * The rows out of `db.execute`, whichever driver answered.
 *
 * postgres-js hands back an array; PGlite hands back `{ rows }`. Every raw
 * query in this codebase deals with that inline — see `groups.ts` — and doing
 * it four more times here is four more places to forget.
 */
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];

/**
 * A list of ids as SQL, for an `in (…)`.
 *
 * Interpolating the array directly binds it as one parameter, which Postgres
 * will not accept on the right of `in` — it becomes `in $1` against an array
 * and matches nothing. `sql.join` expands it into one placeholder per id, so
 * every value is still bound rather than pasted.
 */
const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * Last message and unread count for many event threads at once.
 *
 * One query for the last messages and one for the counts, rather than two per
 * conversation: the Groups tab renders every event chat this person can reach,
 * and a per-row query makes opening a tab an N+1 against the busiest table in
 * the product.
 *
 * `DISTINCT ON` is Postgres-specific and is the reason this is raw SQL rather
 * than the query builder — it is the one way to get "the newest row per group"
 * in a single pass, and the alternative is a window function wrapped in a
 * subquery that says the same thing at twice the length.
 *
 * A deleted message still counts and still shows: it is a gap that says
 * somebody said something and took it back, and a thread that silently
 * shortens is the thing the tombstone exists to prevent.
 */
export async function eventThreadSummaries(
  db: Db,
  eventIds: string[],
  viewerId: string | null,
): Promise<Map<string, ThreadSummary>> {
  const summaries = new Map<string, ThreadSummary>();
  if (eventIds.length === 0) return summaries;

  const latest = rowsOf<{
    event_id: string;
    body: string;
    created_at: Date;
    deleted_at: Date | null;
    author_actor_id: string;
    display_name: string | null;
    handle: string | null;
  }>(await db.execute(sql`
    select distinct on (m.event_id)
      m.event_id, m.body, m.created_at, m.deleted_at, m.author_actor_id,
      a.display_name, a.handle
    from "event_message" m
    join "actor" a on a.id = m.author_actor_id
    where m.event_id in (${idList(eventIds)})
    order by m.event_id, m.created_at desc, m.id desc
  `));

  for (const row of latest) {
    summaries.set(row.event_id, {
      lastMessage: {
        author: nameOf(row.display_name, row.handle),
        body: row.deleted_at != null ? 'Message deleted' : row.body,
        at: new Date(row.created_at).toISOString(),
        mine: viewerId != null && row.author_actor_id === viewerId,
      },
      unreadCount: 0,
    });
  }

  if (viewerId) {
    const counts = rowsOf<{ event_id: string; unread: number }>(await db.execute(sql`
      select m.event_id, count(*)::int as unread
      from "event_message" m
      left join "event_thread_read" r
        on r.event_id = m.event_id and r.actor_id = ${viewerId}
      where m.event_id in (${idList(eventIds)})
        -- Your own messages are never waiting for you.
        and m.author_actor_id <> ${viewerId}
        and (r.read_at is null or m.created_at > r.read_at)
      group by m.event_id
    `));
    for (const row of counts) {
      const existing = summaries.get(row.event_id) ?? { ...EMPTY_SUMMARY };
      summaries.set(row.event_id, { ...existing, unreadCount: row.unread });
    }
  }

  return summaries;
}

/** The same two questions about group threads. See `eventThreadSummaries`. */
export async function groupThreadSummaries(
  db: Db,
  groupIds: string[],
  viewerId: string | null,
): Promise<Map<string, ThreadSummary>> {
  const summaries = new Map<string, ThreadSummary>();
  if (groupIds.length === 0) return summaries;

  const latest = rowsOf<{
    group_id: string;
    body: string;
    created_at: Date;
    deleted_at: Date | null;
    author_actor_id: string;
    display_name: string | null;
    handle: string | null;
  }>(await db.execute(sql`
    select distinct on (m.group_id)
      m.group_id, m.body, m.created_at, m.deleted_at, m.author_actor_id,
      a.display_name, a.handle
    from "group_message" m
    join "actor" a on a.id = m.author_actor_id
    where m.group_id in (${idList(groupIds)})
    order by m.group_id, m.created_at desc, m.id desc
  `));

  for (const row of latest) {
    summaries.set(row.group_id, {
      lastMessage: {
        author: nameOf(row.display_name, row.handle),
        body: row.deleted_at != null ? 'Message deleted' : row.body,
        at: new Date(row.created_at).toISOString(),
        mine: viewerId != null && row.author_actor_id === viewerId,
      },
      unreadCount: 0,
    });
  }

  if (viewerId) {
    const counts = rowsOf<{ group_id: string; unread: number }>(await db.execute(sql`
      select m.group_id, count(*)::int as unread
      from "group_message" m
      left join "group_thread_read" r
        on r.group_id = m.group_id and r.actor_id = ${viewerId}
      where m.group_id in (${idList(groupIds)})
        and m.author_actor_id <> ${viewerId}
        and (r.read_at is null or m.created_at > r.read_at)
      group by m.group_id
    `));
    for (const row of counts) {
      const existing = summaries.get(row.group_id) ?? { ...EMPTY_SUMMARY };
      summaries.set(row.group_id, { ...existing, unreadCount: row.unread });
    }
  }

  return summaries;
}

/**
 * "I have read this thread up to now."
 *
 * Upserted with a `now()` the database chooses rather than one the caller
 * sends: a phone with a wrong clock would otherwise mark a thread read into
 * next week and never show an unread count again.
 *
 * Never moves backwards. Two screens can be open on one conversation, and the
 * one that was opened first should not un-read what the second has seen.
 */
export async function markEventThreadRead(
  db: Db,
  eventId: string,
  actorId: string,
): Promise<void> {
  await db
    .insert(schema.eventThreadReads)
    .values({ eventId, actorId })
    .onConflictDoUpdate({
      target: [schema.eventThreadReads.actorId, schema.eventThreadReads.eventId],
      set: { readAt: sql`now()` },
      where: sql`"event_thread_read"."read_at" < now()`,
    });
}

export async function markGroupThreadRead(
  db: Db,
  groupId: string,
  actorId: string,
): Promise<void> {
  await db
    .insert(schema.groupThreadReads)
    .values({ groupId, actorId })
    .onConflictDoUpdate({
      target: [schema.groupThreadReads.actorId, schema.groupThreadReads.groupId],
      set: { readAt: sql`now()` },
      where: sql`"group_thread_read"."read_at" < now()`,
    });
}
