/**
 * The group thread, and how far anybody has read in either kind of thread.
 *
 * `event_message`'s own comment said a group thread was not coming, on the
 * grounds that "who can see this" would need a second answer. It has one now
 * and it is the narrowest available: `group_member`, in both directions. The
 * first block below is that claim, tested — a group's conversation is visible
 * to its members and to nobody else, including somebody who can see the
 * photographs in an event that belongs to it.
 *
 * The second half is about read marks, which are new for events as well. They
 * are what lets a list say a conversation is waiting for you without opening
 * it, and every edge they have — your own messages, a deleted one, two screens
 * open at once — is a row in a list somewhere reading wrong.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  deleteGroupMessage,
  editGroupMessage,
  eventThreadSummaries,
  groupMessagesFor,
  groupOfMessage,
  groupThreadSummaries,
  markEventThreadRead,
  markGroupThreadRead,
  memberKey,
  postGroupMessage,
} from '@/groupMessages';
import { postMessage } from '@/messages';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "actor", "event", "groups", "group_member", "group_message",
             "event_message", "event_thread_read", "group_thread_read", "block"
    restart identity cascade
  `);
});

async function person(displayName: string | null, handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, handle })
    .returning();
  return actor!.id;
}

let slug = 0;
async function group(name = 'Sunday roast') {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: `g${++slug}` })
    .returning();
  return row!.id;
}

async function event(createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'An evening', linkToken: `t${++slug}`, createdBy })
    .returning();
  return row!.id;
}

/*
 * Post, at a time of our choosing.
 *
 * `created_at` is the transaction clock and a test writes its messages inside
 * one millisecond, so every row would tie. Real messages are seconds apart.
 */
let tick = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick));

async function say(groupId: string, actorId: string, body: string) {
  const { eq } = await import('drizzle-orm');
  const id = await postGroupMessage(db, groupId, actorId, body);
  await db
    .update(schema.groupMessages)
    .set({ createdAt: at() })
    .where(eq(schema.groupMessages.id, id));
  return id;
}

async function sayInEvent(eventId: string, actorId: string, body: string) {
  const { eq } = await import('drizzle-orm');
  const id = await postMessage(db, eventId, actorId, body, null);
  await db
    .update(schema.eventMessages)
    .set({ createdAt: at() })
    .where(eq(schema.eventMessages.id, id));
  return id;
}

describe('reading a group thread', () => {
  it('is oldest first, because that is the order a conversation happens in', async () => {
    const me = await person('Me');
    const id = await group();
    await say(id, me, 'first');
    await say(id, me, 'second');

    const messages = await groupMessagesFor(db, id, me);
    expect(messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('is only this group, never another', async () => {
    /*
     * The obvious bug and the one worth a test: a thread scoped to the wrong
     * thing would show one set of people another set's conversation. This is
     * the same test `messages.test.ts` runs about events, because it is the
     * same mistake in a new room.
     */
    const me = await person('Me');
    const mine = await group('Mine');
    const other = await group('Theirs');
    await say(mine, me, 'ours');
    await say(other, me, 'theirs');

    const messages = await groupMessagesFor(db, mine, me);
    expect(messages.map((m) => m.body)).toEqual(['ours']);
  });

  it('never carries an actor id across the boundary', async () => {
    // The same rule the contributor chips follow. The key is a digest, and the
    // same person in two groups is two keys.
    const me = await person('Me');
    const one = await group('One');
    const two = await group('Two');
    await say(one, me, 'hello');
    await say(two, me, 'hello');

    const [first] = await groupMessagesFor(db, one, me);
    const [second] = await groupMessagesFor(db, two, me);
    expect(first!.author.key).not.toBe(me);
    expect(first!.author.key).not.toBe(second!.author.key);
    expect(first!.author.key).toBe(memberKey(one, me));
  });

  it('has no photo anchor and no reactions', async () => {
    // A group owns no photographs — they belong to the events under it.
    const me = await person('Me');
    const id = await group();
    await say(id, me, 'hello');

    const [message] = await groupMessagesFor(db, id, me);
    expect(message!.photoId).toBeNull();
    expect(message!.reactions).toEqual([]);
  });

  it('hides somebody you have blocked, both ways round', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await group();
    await say(id, me, 'mine');
    await say(id, them, 'theirs');

    await db.insert(schema.blocks).values({ blockerActorId: me, blockedActorId: them });

    expect((await groupMessagesFor(db, id, me)).map((m) => m.body)).toEqual(['mine']);
    // And the person who was blocked does not see the blocker either.
    expect((await groupMessagesFor(db, id, them)).map((m) => m.body)).toEqual(['theirs']);
  });
});

describe('changing what you said', () => {
  it('refuses somebody else’s message', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await group();
    const said = await say(id, them, 'theirs');

    expect(await editGroupMessage(db, said, me, 'mine now')).toBe(false);
    expect(await deleteGroupMessage(db, said, me)).toBe(false);
    expect((await groupMessagesFor(db, id, me))[0]!.body).toBe('theirs');
  });

  it('leaves a gap rather than a hole', async () => {
    // The row stays so the thread keeps its shape, and the body is overwritten
    // rather than flagged, so there is nothing left to leak.
    const me = await person('Me');
    const id = await group();
    await say(id, me, 'first');
    const second = await say(id, me, 'regrettable');
    await say(id, me, 'third');

    expect(await deleteGroupMessage(db, second, me)).toBe(true);

    const messages = await groupMessagesFor(db, id, me);
    expect(messages).toHaveLength(3);
    expect(messages[1]!.deleted).toBe(true);
    expect(messages[1]!.body).toBe('');
  });

  it('will not resurrect a deleted message by editing it', async () => {
    const me = await person('Me');
    const id = await group();
    const said = await say(id, me, 'gone');
    await deleteGroupMessage(db, said, me);

    expect(await editGroupMessage(db, said, me, 'back')).toBe(false);
  });

  it('finds the group a message belongs to', async () => {
    const me = await person('Me');
    const id = await group();
    const said = await say(id, me, 'hello');
    expect(await groupOfMessage(db, said)).toBe(id);
  });
});

describe('what a list of conversations shows', () => {
  it('says nothing for a thread nobody has spoken in', async () => {
    // A door, not an error.
    const id = await group();
    const summaries = await groupThreadSummaries(db, [id], await person('Me'));
    expect(summaries.get(id)).toBeUndefined();
  });

  it('is the newest message, with who said it', async () => {
    const me = await person('Me');
    const priya = await person('Priya');
    const id = await group();
    await say(id, me, 'first');
    await say(id, priya, 'Whose is the one of the whole table?');

    const summary = (await groupThreadSummaries(db, [id], me)).get(id);
    expect(summary!.lastMessage!.author).toBe('Priya');
    expect(summary!.lastMessage!.body).toBe('Whose is the one of the whole table?');
    expect(summary!.lastMessage!.mine).toBe(false);
  });

  it('answers for many conversations in one go', async () => {
    /*
     * The reason this is one query rather than one per row: the Groups tab
     * renders every conversation this person can reach, and a per-row query
     * makes opening a tab an N+1 against the busiest table in the product.
     */
    const me = await person('Me');
    const ids = [await group('A'), await group('B'), await group('C')];
    for (const [i, id] of ids.entries()) await say(id, me, `in ${i}`);

    const summaries = await groupThreadSummaries(db, ids, me);
    expect(summaries.size).toBe(3);
    expect(summaries.get(ids[2]!)!.lastMessage!.body).toBe('in 2');
  });

  it('shows a deleted last message as a gap rather than as silence', async () => {
    // A thread that silently shortens is the thing the tombstone prevents.
    const me = await person('Me');
    const id = await group();
    const said = await say(id, me, 'regrettable');
    await deleteGroupMessage(db, said, me);

    const summary = (await groupThreadSummaries(db, [id], me)).get(id);
    expect(summary!.lastMessage!.body).toBe('Message deleted');
  });

  it('names somebody with no display name by their handle', async () => {
    const me = await person(null, 'ana');
    const id = await group();
    await say(id, me, 'hello');

    const summary = (await groupThreadSummaries(db, [id], await person('Other'))).get(id);
    expect(summary!.lastMessage!.author).toBe('@ana');
  });
});

describe('how many are waiting for you', () => {
  it('counts everything before you have read at all', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await group();
    await say(id, them, 'one');
    await say(id, them, 'two');

    const summary = (await groupThreadSummaries(db, [id], me)).get(id);
    expect(summary!.unreadCount).toBe(2);
  });

  it('never counts your own', async () => {
    // You were there when you wrote it.
    const me = await person('Me');
    const id = await group();
    await say(id, me, 'mine');
    await say(id, me, 'also mine');

    expect((await groupThreadSummaries(db, [id], me)).get(id)!.unreadCount).toBe(0);
  });

  it('stops counting what you have read', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await group();
    await say(id, them, 'before');
    await markGroupThreadRead(db, id, me);
    await say(id, them, 'after');

    // `markGroupThreadRead` stamps `now()`, and the fixture dates its messages
    // in 2026 — so both are "before" the mark. Written the other way round the
    // test would pass without the read mark doing anything.
    const { eq, and } = await import('drizzle-orm');
    await db
      .update(schema.groupThreadReads)
      .set({ readAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick - 1)) })
      .where(
        and(
          eq(schema.groupThreadReads.groupId, id),
          eq(schema.groupThreadReads.actorId, me),
        ),
      );

    expect((await groupThreadSummaries(db, [id], me)).get(id)!.unreadCount).toBe(1);
  });

  it('is zero for somebody not signed in', async () => {
    // There is nobody for it to be a count about.
    const them = await person('Them');
    const id = await group();
    await say(id, them, 'hello');

    expect((await groupThreadSummaries(db, [id], null)).get(id)!.unreadCount).toBe(0);
  });

  it('does not move a read mark backwards', async () => {
    /*
     * Two screens can be open on one conversation. The one opened first should
     * not un-read what the second has already seen.
     */
    const me = await person('Me');
    const id = await group();
    await markGroupThreadRead(db, id, me);

    const [first] = await db.select().from(schema.groupThreadReads);
    await markGroupThreadRead(db, id, me);
    const [second] = await db.select().from(schema.groupThreadReads);

    expect(second!.readAt.getTime()).toBeGreaterThanOrEqual(first!.readAt.getTime());
    // And there is still exactly one row, not two.
    expect((await db.select().from(schema.groupThreadReads)).length).toBe(1);
  });
});

describe('the same questions about an event thread', () => {
  it('summarises and counts the same way', async () => {
    /*
     * The Groups tab asks about both kinds in one render, so the two have to
     * be computed alike or the same conversation reads differently depending
     * on which section it lands in.
     */
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    await sayInEvent(id, them, 'first');
    await sayInEvent(id, them, 'second');

    const summary = (await eventThreadSummaries(db, [id], me)).get(id);
    expect(summary!.lastMessage!.body).toBe('second');
    expect(summary!.unreadCount).toBe(2);

    await markEventThreadRead(db, id, me);
    expect((await eventThreadSummaries(db, [id], me)).get(id)!.unreadCount).toBe(0);
  });

  it('keeps the two kinds of read mark apart', async () => {
    // An event and a group that share an id would be a coincidence; a read
    // mark that confuses them would be a bug in every list at once.
    const me = await person('Me');
    const groupId = await group();
    const eventId = await event(me);
    const them = await person('Them');
    await say(groupId, them, 'in the group');
    await sayInEvent(eventId, them, 'in the event');

    await markEventThreadRead(db, eventId, me);

    expect((await groupThreadSummaries(db, [groupId], me)).get(groupId)!.unreadCount).toBe(1);
    expect((await eventThreadSummaries(db, [eventId], me)).get(eventId)!.unreadCount).toBe(0);
  });

  it('returns an empty map rather than querying for nothing', async () => {
    expect((await eventThreadSummaries(db, [], null)).size).toBe(0);
    expect((await groupThreadSummaries(db, [], null)).size).toBe(0);
  });
});
