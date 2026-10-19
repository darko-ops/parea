/**
 * Pinning a chat and deleting it: one person's hold on a room's conversation.
 *
 * Deleting is "clear it for me" — what was said goes for the person who
 * deleted, and nobody else; they stay in the room; the chat leaves their list
 * until something new is said, and comes back holding only that.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  groupMessagesFor,
  groupThreadSummaries,
  postGroupMessage,
  unreadChats,
} from '@/groupMessages';
import { chatsInOrder, clearChat, membershipOf, myGroups, pinChat } from '@/groups';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "group_message", "group_thread_read"
    restart identity cascade
  `);
});

async function person(handle: string) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', handle, displayName: handle })
    .returning();
  return actor!.id;
}

async function room(...actors: string[]) {
  const [group] = await db
    .insert(schema.groups)
    .values({ slug: `r-${Math.random().toString(36).slice(2)}` })
    .returning();
  await db
    .insert(schema.groupMembers)
    .values(actors.map((actorId) => ({ groupId: group!.id, actorId })));
  return group!.id;
}

describe('deleting a chat', () => {
  it('clears what was said for the one who deleted it, and nobody else', async () => {
    const me = await person('me');
    const them = await person('them');
    const chat = await room(me, them);
    await postGroupMessage(db, chat, them, 'before');

    expect(await clearChat(db, chat, me)).toBe(true);

    expect((await groupMessagesFor(db, chat, me)).map((m) => m.body)).toEqual([]);
    expect((await groupMessagesFor(db, chat, them)).map((m) => m.body)).toEqual(['before']);
    // Still in the room.
    expect(await membershipOf(db, chat, me)).not.toBeNull();
  });

  it('takes it off the list until something new is said, then shows only that', async () => {
    const me = await person('me');
    const them = await person('them');
    const chat = await room(me, them);
    await postGroupMessage(db, chat, them, 'before');
    await clearChat(db, chat, me);

    const list = async () => {
      const groups = await myGroups(db, me);
      const threads = await groupThreadSummaries(db, groups.map((g) => g.id), me);
      return chatsInOrder(
        groups.map((g) => ({ ...g, lastMessage: threads.get(g.id)?.lastMessage ?? null })),
      );
    };
    expect(await list()).toEqual([]);
    expect(await unreadChats(db, me)).toBe(false);

    await postGroupMessage(db, chat, them, 'after');
    const [back] = await list();
    expect(back?.lastMessage?.body).toBe('after');
    expect((await groupMessagesFor(db, chat, me)).map((m) => m.body)).toEqual(['after']);
    expect((await groupThreadSummaries(db, [chat], me)).get(chat)?.unreadCount).toBe(1);
    expect(await unreadChats(db, me)).toBe(true);
  });

  it('unpins it', async () => {
    const me = await person('me');
    const chat = await room(me, await person('them'));
    await pinChat(db, chat, me, true);
    await clearChat(db, chat, me);
    expect((await myGroups(db, me))[0]?.pinnedAt).toBeNull();
  });

  it('is only for somebody in the room', async () => {
    const chat = await room(await person('a'));
    expect(await clearChat(db, chat, await person('stranger'))).toBe(false);
    expect(await pinChat(db, chat, await person('other'), true)).toBe(false);
  });
});

describe('pinning a chat', () => {
  it('puts it first, newest pin on top, and is the pinner’s alone', async () => {
    const me = await person('me');
    const them = await person('them');
    const quiet = await room(me, them);
    const busy = await room(me, them);
    const other = await room(me, them);
    // A few milliseconds apart: the list is ordered by the millisecond.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    await postGroupMessage(db, quiet, them, 'old');
    await tick();
    await postGroupMessage(db, other, them, 'middle');
    await tick();
    await postGroupMessage(db, busy, them, 'new');

    await pinChat(db, quiet, me, true);
    await tick();
    await pinChat(db, other, me, true);

    const order = async (who: string) => {
      const groups = await myGroups(db, who);
      const threads = await groupThreadSummaries(db, groups.map((g) => g.id), who);
      return chatsInOrder(
        groups.map((g) => ({ ...g, lastMessage: threads.get(g.id)?.lastMessage ?? null })),
      ).map((g) => g.lastMessage?.body);
    };
    expect(await order(me)).toEqual(['middle', 'old', 'new']);
    expect(await order(them)).toEqual(['new', 'middle', 'old']);

    await pinChat(db, other, me, false);
    expect(await order(me)).toEqual(['old', 'new', 'middle']);
  });
});
