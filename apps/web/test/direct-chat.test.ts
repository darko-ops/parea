/**
 * The room "Chat" opens, and the one it does not make twice.
 *
 * A profile now has a button that starts a conversation with the person whose
 * page it is. There is nothing to fill in and nothing to confirm, which is
 * what makes it different from every other way a room gets made: it is
 * pressable as often as somebody likes, and each press means the same thing —
 * take me to our conversation.
 *
 * So the interesting behaviour is not the first press. It is the second one,
 * a week later, from either side, with nothing said in between. Answering that
 * with a second empty room leaves a chat list holding two rows with the same
 * title and the reply in only one of them, and no way to tell from the outside
 * which.
 *
 * The route is called rather than asserted against. "Made one room, not two"
 * is a fact about rows, and a source check cannot see a row.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
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

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { addMember, directChatWith } = await import('@/groups');
const { POST } = await import('../app/api/groups/route');

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
    truncate "account", "actor", "groups", "group_member", "block"
    restart identity cascade
  `);
  headerBag.clear();
});

/** An account with an actor, because a guest device cannot own a room. */
let seq = 0;
async function person(displayName: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `p${++seq}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({
      kind: 'user',
      accountId: account!.id,
      handle: `p${seq}`,
      displayName,
    })
    .returning();
  return actor!.id;
}

function as(actorId: string) {
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

/** What the Chat button sends: one person, no name. */
async function chat(me: string, them: string) {
  as(me);
  const response = await POST(
    new Request('https://parea.test/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberIds: [them] }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function rooms() {
  return db.select().from(schema.groups);
}

describe('chatting to somebody from their profile', () => {
  it('makes a room with the two of you in it', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');

    const made = await chat(me, them);
    expect(made.status).toBe(201);

    const members = await db.select().from(schema.groupMembers);
    expect(members.map((m) => m.actorId).sort()).toEqual([me, them].sort());
    // Nameless, which is what makes it a chat rather than a group: the title
    // comes from who is in it, so it reads as the other person.
    expect(made.body.name).toBeNull();
    expect(made.body.title).toBe('Ana');
  });

  it('is the same room the second time it is pressed', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');

    const first = await chat(me, them);
    const second = await chat(me, them);

    expect(second.body.id).toBe(first.body.id);
    // 201 said something was created; the second press created nothing.
    expect(second.status).toBe(200);
    expect(await rooms()).toHaveLength(1);
  });

  it('is the same room when they press it from your profile', async () => {
    /*
     * The conversation is between two people and belongs to neither, so the
     * room somebody finds by pressing Chat is the one that already exists
     * whichever end it was started from. Two rooms here is the same list of
     * duplicates as above, arrived at by two people being polite at once.
     */
    const me = await person('Demetri');
    const them = await person('Ana');

    const mine = await chat(me, them);
    const theirs = await chat(them, me);

    expect(theirs.body.id).toBe(mine.body.id);
    expect(await rooms()).toHaveLength(1);
  });

  it('leaves a named room alone, even with the same two people in it', async () => {
    /*
     * Naming a room is how somebody says it is a standing thing. Handing a
     * direct message to "Sunday tennis" because it happens to hold the same
     * two people would rename their conversation for both of them.
     */
    const me = await person('Demetri');
    const them = await person('Ana');
    const [named] = await db
      .insert(schema.groups)
      .values({ name: 'Sunday tennis', slug: 'sunday-tennis' })
      .returning();
    await addMember(db, named!.id, me, 'admin');
    await addMember(db, named!.id, them);

    const made = await chat(me, them);
    expect(made.status).toBe(201);
    expect(made.body.id).not.toBe(named!.id);
  });

  it('leaves a room with somebody else in it alone', async () => {
    // The two of you are both in it, which is not the same as it being yours.
    const me = await person('Demetri');
    const them = await person('Ana');
    const third = await person('Jack');
    const [three] = await db.insert(schema.groups).values({ name: null }).returning();
    for (const id of [me, them, third]) await addMember(db, three!.id, id);

    const made = await chat(me, them);
    expect(made.status).toBe(201);
    expect(made.body.id).not.toBe(three!.id);
    expect(await rooms()).toHaveLength(2);
  });

  it('refuses rather than making a room of one', async () => {
    /*
     * `invitable` filters rather than refuses, which is right for a cluster of
     * eleven with one stale id in it. One name in and nothing left is a
     * different thing — a block, or a merged actor — and making the room
     * anyway would put an empty conversation with nobody in it on somebody's
     * list forever.
     */
    const me = await person('Demetri');
    const them = await person('Ana');
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: them, blockedActorId: me });

    const tried = await chat(me, them);
    expect(tried.status).toBe(403);
    expect(await rooms()).toHaveLength(0);
  });

  it('does not treat a deleted room as the one you already have', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const first = await chat(me, them);
    await db
      .update(schema.groups)
      .set({ deletedAt: new Date() })
      .where(eq(schema.groups.id, String(first.body.id)));

    expect(await directChatWith(db, me, them)).toBeNull();
    const again = await chat(me, them);
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(first.body.id);
  });
});
