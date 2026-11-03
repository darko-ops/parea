/**
 * Becoming friends puts the two of you's chat on both Chats lists.
 *
 * Through the friends route, both ways a request is answered: accepting it,
 * and asking somebody who had already asked you. And the room is the one
 * "Chat" on a profile would open — kept when the two of you have one,
 * accepted when one of you had already asked the other in, never a second.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));
vi.mock('@/notify', () => ({ notifyFriendRequest: async () => {} }));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { addMember, chatsInOrder, ensureDirectChat, inviteToGroup } = await import('@/groups');
const { POST, PATCH } = await import('../app/api/friends/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "group_invite", "friend_request", "friendship"
    restart identity cascade
  `);
  headerBag.clear();
});

let seq = 0;
async function person(displayName: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `f${++seq}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle: `f${seq}`, displayName })
    .returning();
  return actor!.id;
}

function call(
  handler: (request: Request) => Promise<Response>,
  actorId: string,
  method: string,
  body: unknown,
) {
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
  return handler(
    new Request('https://parea.test/api/friends', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function membersOfEachRoom() {
  const rows = await db.select().from(schema.groupMembers);
  const rooms = new Map<string, string[]>();
  for (const row of rows) rooms.set(row.groupId, [...(rooms.get(row.groupId) ?? []), row.actorId]);
  return [...rooms.values()].map((ids) => ids.sort());
}

describe('a new friend’s chat', () => {
  it('is made when a request is accepted', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    await call(POST, me, 'POST', { actorId: them });
    expect(await membersOfEachRoom()).toEqual([]);

    const [request] = await db.select().from(schema.friendRequests);
    const answered = await call(PATCH, them, 'PATCH', { requestId: request!.id, action: 'accept' });
    expect(answered.status).toBe(200);
    expect(await membersOfEachRoom()).toEqual([[me, them].sort()]);
    const [room] = await db.select().from(schema.groups);
    expect(room).toMatchObject({ name: null, findable: false });
  });

  it('is made when asking somebody who had already asked you', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    await call(POST, them, 'POST', { actorId: me });
    const answered = await call(POST, me, 'POST', { actorId: them });
    expect(await answered.json()).toEqual({ status: 'accepted' });
    expect(await membersOfEachRoom()).toEqual([[me, them].sort()]);
  });

  it('is not made for a request declined', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    await call(POST, me, 'POST', { actorId: them });
    const [request] = await db.select().from(schema.friendRequests);
    await call(PATCH, them, 'PATCH', { requestId: request!.id, action: 'decline' });
    expect(await membersOfEachRoom()).toEqual([]);
  });

  it('is the chat the two of you already have, not a second one', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const [room] = await db.insert(schema.groups).values({ name: null, slug: null, findable: false }).returning();
    await addMember(db, room!.id, me, 'admin');
    await addMember(db, room!.id, them);

    await ensureDirectChat(db, them, me);
    expect(await db.select().from(schema.groups)).toHaveLength(1);
  });

  it('accepts the chat one of you had already asked the other into', async () => {
    // Before they were friends, "Chat" on Ana's profile asked her in.
    const me = await person('Demetri');
    const them = await person('Ana');
    const [room] = await db.insert(schema.groups).values({ name: null, slug: null, findable: false }).returning();
    await addMember(db, room!.id, me, 'admin');
    await inviteToGroup(db, room!.id, me, [them]);

    await ensureDirectChat(db, me, them);
    expect(await db.select().from(schema.groups)).toHaveLength(1);
    expect(await membersOfEachRoom()).toEqual([[me, them].sort()]);
    const [invite] = await db.select().from(schema.groupInvites);
    expect(invite!.status).toBe('accepted');
  });

  it('leaves a named room alone and makes the direct one', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const [named] = await db
      .insert(schema.groups)
      .values({ name: 'Sunday tennis', slug: 'sunday-tennis', findable: false })
      .returning();
    await addMember(db, named!.id, me, 'admin');
    await addMember(db, named!.id, them);

    await ensureDirectChat(db, me, them);
    expect(await db.select().from(schema.groups)).toHaveLength(2);
  });
});

describe('where it sorts on Chats', () => {
  it('goes by when you joined a room nobody has spoken in, not last', () => {
    const at = (iso: string | null) => (iso ? { at: iso } : null);
    const rows = [
      { id: 'old', pinnedAt: null, clearedAt: null, joinedAt: '2026-01-01T00:00:00Z', lastMessage: at('2026-10-01T00:00:00Z') },
      { id: 'new-friend', pinnedAt: null, clearedAt: null, joinedAt: '2026-11-03T00:00:00Z', lastMessage: null },
      { id: 'quiet', pinnedAt: null, clearedAt: null, joinedAt: '2026-02-01T00:00:00Z', lastMessage: null },
    ];
    expect(chatsInOrder(rows).map((r) => r.id)).toEqual(['new-friend', 'old', 'quiet']);
  });
});
