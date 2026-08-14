/**
 * The event thread.
 *
 * This is the first thing in the product where one person writes something and
 * another person reads it, so the bounds are what matter: who is in the list,
 * whose message you can change, and what is left behind when somebody takes
 * one back.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  deleteMessage,
  editMessage,
  eventOfMessage,
  isReaction,
  messagesFor,
  postMessage,
  REACTIONS,
  toggleReaction,
} from '@/messages';

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
    truncate "actor", "event", "event_message", "message_reaction", "block"
    restart identity cascade
  `);
});

/** The identity function stands in for the per-event digest. */
const key = (id: string) => id;

async function person(displayName: string | null, handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, handle })
    .returning();
  return actor!.id;
}

async function event(createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'An evening', linkToken: `t${Math.abs(hash(createdBy))}`, createdBy })
    .returning();
  return row!.id;
}

/**
 * Post, at a time of our choosing.
 *
 * `created_at` defaults to the transaction clock, and a test writes its
 * messages inside the same millisecond — so every row would tie, and the order
 * would come down to the id tiebreak, which is a random uuid. Real messages
 * are seconds apart. Spacing them here tests the ordering that exists rather
 * than the one PGlite's clock resolution produces.
 */
let tick = 0;
async function say(eventId: string, actorId: string, body: string, photoId?: string) {
  const id = await postMessage(db, eventId, actorId, body, photoId ?? null);
  const { eq } = await import('drizzle-orm');
  await db
    .update(schema.eventMessages)
    .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)) })
    .where(eq(schema.eventMessages.id, id));
  return id;
}

/** Deterministic, because `Math.random` in a fixture is a flaky test waiting. */
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

describe('reading a thread', () => {
  it('is oldest first, because that is the order a conversation happens in', async () => {
    const me = await person('Me');
    const id = await event(me);
    await say(id, me, 'first');
    await say(id, me, 'second');

    const messages = await messagesFor(db, id, me, key);
    expect(messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('is only this event, never another', async () => {
    // The obvious bug, and the one worth a test: a thread scoped to the wrong
    // thing would show one group of people another group's conversation.
    const me = await person('Me');
    const mine = await event(me);
    const other = await event(await person('Them'));
    await postMessage(db, mine, me, 'ours');
    await postMessage(db, other, me, 'theirs');

    expect((await messagesFor(db, mine, me, key)).map((m) => m.body)).toEqual(['ours']);
  });

  it('names somebody by handle, then by nothing at all', async () => {
    const handled = await person(null, 'SilverBreezyCondor');
    const nobody = await person(null, null);
    const id = await event(handled);
    await say(id, handled, 'a');
    await say(id, nobody, 'b');

    const names = (await messagesFor(db, id, null, key)).map((m) => m.author.name);
    expect(names).toEqual(['@SilverBreezyCondor', 'Someone']);
  });

  it('hides each of two people from the other after a block', async () => {
    /*
     * Both directions, matching photos exactly. A block that hid somebody's
     * photographs and left their conversation up would be a block in name
     * only — and one that worked in a single direction would tell the blocked
     * person it had happened, which blocking is careful not to do.
     */
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    await say(id, me, 'mine');
    await say(id, them, 'theirs');
    await db.insert(schema.blocks).values({ blockerActorId: me, blockedActorId: them });

    expect((await messagesFor(db, id, me, key)).map((m) => m.body)).toEqual(['mine']);
    expect((await messagesFor(db, id, them, key)).map((m) => m.body)).toEqual(['theirs']);
  });

  it('marks your own messages and nobody else’s', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    await say(id, me, 'mine');
    await say(id, them, 'theirs');

    const mine = (await messagesFor(db, id, me, key)).filter((m) => m.author.mine);
    expect(mine.map((m) => m.body)).toEqual(['mine']);
    // A signed-out reader owns nothing, and must not own the first message by
    // accident through a null comparison.
    expect((await messagesFor(db, id, null, key)).some((m) => m.author.mine)).toBe(false);
  });
});

describe('changing what you said', () => {
  it('rewrites your own and marks it edited', async () => {
    const me = await person('Me');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'before');

    expect(await editMessage(db, messageId, me, 'after')).toBe(true);
    const [only] = await messagesFor(db, id, me, key);
    expect(only!.body).toBe('after');
    expect(only!.edited).toBe(true);
  });

  it('refuses somebody else’s, without saying which reason', async () => {
    // The author is part of the UPDATE rather than a check before it, so this
    // is one statement and there is no window between deciding and writing.
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    const messageId = await postMessage(db, id, them, 'theirs');

    expect(await editMessage(db, messageId, me, 'hacked')).toBe(false);
    expect((await messagesFor(db, id, me, key))[0]!.body).toBe('theirs');
  });

  it('leaves a gap rather than a hole', async () => {
    // The row stays so the conversation keeps its shape: the messages either
    // side of a removed one would otherwise appear to be answering each other.
    const me = await person('Me');
    const id = await event(me);
    const a = await say(id, me, 'one');
    const gone = await say(id, me, 'two');
    await say(id, me, 'three');

    expect(await deleteMessage(db, gone, me)).toBe(true);
    const messages = await messagesFor(db, id, me, key);
    expect(messages).toHaveLength(3);
    expect(messages[1]!.deleted).toBe(true);
    expect(messages[0]!.id).toBe(a);
  });

  it('takes the words away, not just the flag', async () => {
    /*
     * The load-bearing one. A deleted message that keeps its text is a message
     * still in the database and still in every response that forgets to check
     * the flag — so the body is overwritten on delete, and the reader blanks
     * it as well. Two locks, because the first is a write that could be missed.
     */
    const me = await person('Me');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'something regretted');
    await deleteMessage(db, messageId, me);

    const [row] = await db
      .select({ body: schema.eventMessages.body })
      .from(schema.eventMessages);
    expect(row!.body).toBe('');
    expect((await messagesFor(db, id, me, key))[0]!.body).toBe('');
  });

  it('cannot be deleted by somebody else, or edited back to life', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'mine');

    expect(await deleteMessage(db, messageId, them)).toBe(false);
    expect(await deleteMessage(db, messageId, me)).toBe(true);
    // Deleting twice is not an error to the caller, but nothing is written.
    expect(await deleteMessage(db, messageId, me)).toBe(false);
    expect(await editMessage(db, messageId, me, 'back')).toBe(false);
  });
});

describe('reactions', () => {
  it('toggles, so the pill can be un-pressed', async () => {
    const me = await person('Me');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'a');

    expect(await toggleReaction(db, messageId, me, '❤️')).toBe('added');
    expect((await messagesFor(db, id, me, key))[0]!.reactions).toEqual([
      { emoji: '❤️', count: 1, mine: true },
    ]);
    expect(await toggleReaction(db, messageId, me, '❤️')).toBe('removed');
    expect((await messagesFor(db, id, me, key))[0]!.reactions).toEqual([]);
  });

  it('counts people, and knows which one is you', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'a');

    await toggleReaction(db, messageId, me, '❤️');
    await toggleReaction(db, messageId, them, '❤️');
    await toggleReaction(db, messageId, them, '🔥');

    const [only] = await messagesFor(db, id, me, key);
    expect(only!.reactions).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '🔥', count: 1, mine: false },
    ]);
    // The same rows, read by the other person.
    const [theirs] = await messagesFor(db, id, them, key);
    expect(theirs!.reactions.map((r) => r.mine)).toEqual([true, true]);
  });

  it('only offers what the interface offers', () => {
    // The column takes any short string, which is what keeps the set a design
    // decision rather than a migration. That is only safe while the one door
    // into the table is this narrow.
    for (const emoji of REACTIONS) expect(isReaction(emoji)).toBe(true);
    expect(isReaction('not an emoji at all, but a sentence')).toBe(false);
    expect(isReaction('')).toBe(false);
    expect(isReaction(null)).toBe(false);
    expect(isReaction(42)).toBe(false);
  });
});

describe('finding the event a message belongs to', () => {
  it('answers with the event and the author, for the routes that only have an id', async () => {
    // `/api/messages/<id>` has no event in its path and still has to ask
    // `authorize()` about one.
    const me = await person('Me');
    const id = await event(me);
    const messageId = await postMessage(db, id, me, 'a');

    expect(await eventOfMessage(db, messageId)).toEqual({
      eventId: id,
      authorActorId: me,
    });
  });

  it('answers null for one that does not exist', async () => {
    expect(await eventOfMessage(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
