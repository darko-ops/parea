/**
 * The thread on an event — reading it, adding to it, and taking things back.
 *
 * Access is not decided here. Every caller has already been through
 * `authorize()` — `view` to read, `contribute` to post — and this module
 * assumes that has happened, exactly as `contributors.ts` assumes the rows it
 * is handed came through `visiblePhotos`. Putting a second access rule in here
 * would be a second place for it to be wrong.
 *
 * What *is* here is the other kind of visibility: a message from somebody you
 * have blocked. Photos already have `visiblePhotos` for this; messages need
 * the same thing and it has to be the same list of people, or blocking
 * somebody would hide their photographs and leave their conversation up.
 */

import { schema } from '@parea/core';
import { and, asc, eq, inArray, isNull, not, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import type { Db } from './db';

/** Longest message the database will take. Kept in step with the CHECK. */
export const MAX_BODY = 2000;

/*
 * The reaction set moved to `reactions.ts`, and this module must not import it
 * back. This file reaches the database and presigns avatars, so it reaches
 * storage and therefore `node:fs`; the thread that draws the picker is a
 * client component, and one value import across that line puts all of this in
 * the browser bundle.
 */

export type MessageAuthor = {
  /** Opaque per-event key, the same one the contributor chips use. */
  key: string;
  name: string;
  mine: boolean;
  /**
   * Their picture, presigned. Null for somebody who has not set one.
   *
   * No new disclosure: anybody who can read this thread can already open the
   * event's People tab, which lists everyone in it by name with the same
   * faces. What stays true is the rule the `key` above exists for — an actor
   * id does not cross this boundary, and neither does an avatar *key*; this is
   * an address that expires, like every other picture the product hands out.
   */
  avatarUrl: string | null;
};

export type Message = {
  id: string;
  body: string;
  /** ISO. */
  createdAt: string;
  edited: boolean;
  /** A tombstone: the body is gone and the row is a gap that says so. */
  deleted: boolean;
  author: MessageAuthor;
  /** Set when this is a comment on one photograph rather than to the thread. */
  photoId: string | null;
  /** Emoji to the people who chose it, and whether the viewer is one of them. */
  reactions: { emoji: string; count: number; mine: boolean }[];
};

/**
 * The thread, oldest first.
 *
 * Oldest first because it is a conversation and that is the order one happens
 * in — the column scrolls to the bottom on arrival, which is a scroll position
 * rather than a sort order, and getting those two confused is how a thread
 * ends up reading backwards.
 *
 * Blocked people are filtered in SQL rather than after the fact: dropping rows
 * in TypeScript works right up until the day this grows a `limit`, at which
 * point the page silently gets shorter instead of skipping them.
 */
export async function messagesFor(
  db: Db,
  eventId: string,
  viewerId: string | null,
  key: (actorId: string) => string,
): Promise<Message[]> {
  const rows = await db
    .select({
      id: schema.eventMessages.id,
      body: schema.eventMessages.body,
      createdAt: schema.eventMessages.createdAt,
      editedAt: schema.eventMessages.editedAt,
      deletedAt: schema.eventMessages.deletedAt,
      photoId: schema.eventMessages.photoId,
      authorId: schema.eventMessages.authorActorId,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.eventMessages)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.eventMessages.authorActorId))
    .where(
      and(
        eq(schema.eventMessages.eventId, eventId),
        // Both directions, matching how blocks work everywhere else: somebody
        // you blocked does not appear to you, and you do not appear to them.
        viewerId
          ? not(
              sql`exists (
                select 1 from "block" b
                where (b.blocker_actor_id = ${viewerId}
                       and b.blocked_actor_id = ${schema.eventMessages.authorActorId})
                   or (b.blocked_actor_id = ${viewerId}
                       and b.blocker_actor_id = ${schema.eventMessages.authorActorId})
              )`,
            )
          : undefined,
      ),
    )
    /*
     * Time, then id.
     *
     * The id is not decoration. `created_at` defaults to `now()`, which is the
     * *transaction* clock, so two messages written close together can carry
     * the identical timestamp — and ordering by a column with ties in it is
     * ordering that Postgres may return either way round. In a thread that
     * means two messages trading places between one poll and the next, which
     * looks like the conversation rearranging itself while you read it.
     *
     * Found by a test that deleted the middle of three messages and got a
     * different middle back.
     */
    .orderBy(asc(schema.eventMessages.createdAt), asc(schema.eventMessages.id));

  if (rows.length === 0) return [];

  const reactions = await db
    .select({
      messageId: schema.messageReactions.messageId,
      emoji: schema.messageReactions.emoji,
      actorId: schema.messageReactions.actorId,
    })
    .from(schema.messageReactions)
    .where(inArray(schema.messageReactions.messageId, rows.map((r) => r.id)));

  /** message id → emoji → {count, mine}. Built once rather than per message. */
  const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const reaction of reactions) {
    const forMessage = byMessage.get(reaction.messageId) ?? new Map();
    const tally = forMessage.get(reaction.emoji) ?? { count: 0, mine: false };
    tally.count += 1;
    if (viewerId != null && reaction.actorId === viewerId) tally.mine = true;
    forMessage.set(reaction.emoji, tally);
    byMessage.set(reaction.messageId, forMessage);
  }

  /*
   * One presign per author, not per message.
   *
   * A busy thread is twenty messages from four people, and signing the same
   * avatar twenty times is twenty HMACs and twenty different URLs for one
   * picture — which also defeats the browser's cache, so the same face is
   * fetched once per message.
   */
  const faces = new Map<string, string | null>();
  for (const row of rows) {
    if (faces.has(row.authorId)) continue;
    faces.set(row.authorId, await avatarUrl(row.avatarKey));
  }

  return rows.map((row) => {
    const deleted = row.deletedAt != null;
    return {
      id: row.id,
      // Never the stored body for a deleted message. It is overwritten on
      // delete as well, so this is the second of two locks on the same door —
      // worth having, because the first one is a write that could be missed.
      body: deleted ? '' : row.body,
      createdAt: row.createdAt.toISOString(),
      edited: row.editedAt != null,
      deleted,
      photoId: row.photoId,
      author: {
        key: key(row.authorId),
        name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
        mine: viewerId != null && row.authorId === viewerId,
        avatarUrl: faces.get(row.authorId) ?? null,
      },
      reactions: [...(byMessage.get(row.id) ?? new Map())]
        .map(([emoji, tally]) => ({ emoji, ...tally }))
        // Most-reacted first, then by emoji so two polls agree. Not by time:
        // a pill moving because somebody else tapped one is a pill that moves
        // under your finger.
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
    };
  });
}

/** Adds a message. The caller has already established `contribute`. */
export async function postMessage(
  db: Db,
  eventId: string,
  authorActorId: string,
  body: string,
  photoId: string | null = null,
): Promise<string> {
  const [row] = await db
    .insert(schema.eventMessages)
    .values({ eventId, authorActorId, body, photoId })
    .returning({ id: schema.eventMessages.id });
  return row!.id;
}

/**
 * Rewrites your own message.
 *
 * Scoped by author in the statement rather than checked first and updated
 * second: two statements is a window, however small, and the window is "may I
 * edit this" answered about a row that something else could have changed.
 * Returns whether anything was written, which is the caller's 404.
 */
export async function editMessage(
  db: Db,
  messageId: string,
  authorActorId: string,
  body: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.eventMessages)
    .set({ body, editedAt: new Date() })
    .where(
      and(
        eq(schema.eventMessages.id, messageId),
        eq(schema.eventMessages.authorActorId, authorActorId),
        // A deleted message cannot be edited back into existence.
        isNull(schema.eventMessages.deletedAt),
      ),
    )
    .returning({ id: schema.eventMessages.id });
  return rows.length > 0;
}

/**
 * Takes your own message back.
 *
 * The row stays and the body goes. Keeping the text behind a flag would mean
 * the thing somebody deleted is still in the database and still in every
 * response that forgets to check the flag; keeping the row means the thread
 * does not rearrange itself around the hole.
 */
export async function deleteMessage(
  db: Db,
  messageId: string,
  authorActorId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.eventMessages)
    .set({ body: '', deletedAt: new Date() })
    .where(
      and(
        eq(schema.eventMessages.id, messageId),
        eq(schema.eventMessages.authorActorId, authorActorId),
        isNull(schema.eventMessages.deletedAt),
      ),
    )
    .returning({ id: schema.eventMessages.id });
  return rows.length > 0;
}

/**
 * Adds or removes one person's reaction. Returns the state it left it in.
 *
 * A toggle rather than separate add and remove routes, because that is what
 * the control is: one pill, pressed or not. Two endpoints would mean the
 * client has to know which one it is in, and it already gets that wrong
 * whenever two tabs are open.
 */
export async function toggleReaction(
  db: Db,
  messageId: string,
  actorId: string,
  emoji: string,
): Promise<'added' | 'removed'> {
  const removed = await db
    .delete(schema.messageReactions)
    .where(
      and(
        eq(schema.messageReactions.messageId, messageId),
        eq(schema.messageReactions.actorId, actorId),
        eq(schema.messageReactions.emoji, emoji),
      ),
    )
    .returning({ emoji: schema.messageReactions.emoji });
  if (removed.length > 0) return 'removed';

  await db.insert(schema.messageReactions).values({ messageId, actorId, emoji });
  return 'added';
}

/**
 * The event a message belongs to, for routes that are handed only a message.
 *
 * `/api/messages/<id>` has no event in its path, and every one of those routes
 * still has to ask `authorize()` about an event — so this is the lookup that
 * turns a message id into something the policy can answer about. Returns null
 * for a message that does not exist, which the caller answers as 404 rather
 * than distinguishing: a route that says "no such message" to one id and
 * "not yours" to another is a way to enumerate the table.
 */
export async function eventOfMessage(
  db: Db,
  messageId: string,
): Promise<{ eventId: string; authorActorId: string } | null> {
  const [row] = await db
    .select({
      eventId: schema.eventMessages.eventId,
      authorActorId: schema.eventMessages.authorActorId,
    })
    .from(schema.eventMessages)
    .where(eq(schema.eventMessages.id, messageId));
  return row ?? null;
}
