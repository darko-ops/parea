/**
 * Sending a roll's photograph or a moment into a chat: who may send what, to
 * whom, and what the chat draws once it is there.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
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
const { addMember } = await import('@/groups');
const { groupMessagesFor, groupThreadSummaries } = await import('@/groupMessages');
const route = await import('../app/api/groups/[id]/messages/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "event", "photo", "groups", "moment", "friendship" restart identity cascade`);
  headerBag.clear();
});

async function person(name: string) {
  const [account] = await db.insert(schema.accounts).values({ email: `${crypto.randomUUID()}@example.test` }).returning();
  const [actor] = await db.insert(schema.actors).values({ kind: 'user', displayName: name, accountId: account!.id }).returning();
  return actor!.id;
}

function as(actorId: string) {
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

async function chat(...members: string[]) {
  const [g] = await db.insert(schema.groups).values({}).returning();
  for (const m of members) await addMember(db, g!.id, m);
  return g!.id;
}

async function roll(createdBy: string, accessPolicy: 'public' | 'private', ...people: string[]) {
  const [e] = await db.insert(schema.events).values({ name: 'Party', linkToken: newLinkToken(), createdBy, accessPolicy }).returning();
  for (const p of [createdBy, ...people]) await db.insert(schema.eventParticipants).values({ eventId: e!.id, actorId: p });
  // In a private roll, being in it means having been let in: an accepted invitation.
  for (const p of people) {
    await db.insert(schema.eventInvites).values({ eventId: e!.id, actorId: p, invitedByActorId: createdBy, status: 'accepted' });
  }
  return e!.id;
}

async function photo(eventId: string, uploaderId: string, status: 'ready' | 'pending' = 'ready') {
  const [p] = await db
    .insert(schema.photos)
    .values({ eventId, uploaderId, storageKey: `k-${Math.random()}`, byteSize: 1, mime: 'image/jpeg', status })
    .returning();
  return p!.id;
}

async function moment(actorId: string) {
  const [m] = await db.insert(schema.moments).values({ actorId, key: `m-${Math.random()}`, width: 1, height: 1 }).returning();
  return m!.id;
}

async function friends(a: string, b: string) {
  await db.insert(schema.friendships).values([
    { actorId: a, friendActorId: b },
    { actorId: b, friendActorId: a },
  ]);
}

const send = (groupId: string, body: Record<string, unknown>) =>
  route.POST(new Request(`https://parea.test/api/groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: groupId }),
  });

describe('a roll photo sent into a chat', () => {
  it('goes from a public roll, with or without words, and the chat draws it', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const e = await roll(ada, 'public', sam);
    const p = await photo(e, ada);
    const c = await chat(sam, ada);

    as(sam);
    expect((await send(c, { photoId: p })).status).toBe(201);
    expect((await send(c, { photoId: p, body: 'look at this' })).status).toBe(201);

    const messages = await groupMessagesFor(db, c, ada);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ body: '', photo: { id: p } });
    expect(messages[0]!.photo?.thumb).toBeTruthy();

    const summary = (await groupThreadSummaries(db, [c], ada)).get(c);
    expect(summary?.lastMessage?.body).toBe('look at this');
  });

  it('says so in the chat list when it was sent on its own', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const p = await photo(await roll(ada, 'public'), ada);
    const c = await chat(ada, sam);
    as(ada);
    await send(c, { photoId: p });
    expect((await groupThreadSummaries(db, [c], sam)).get(c)?.lastMessage?.body).toBe('Sent a photo');
  });

  it('from a private roll, only by the person who took it', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada, 'private', sam);
    const adas = await photo(e, ada);
    const c = await chat(ada, sam, tom);

    as(sam);
    const refused = await send(c, { photoId: adas });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'private_roll' });

    as(ada);
    expect((await send(c, { photoId: adas })).status).toBe(201);
  });

  it('is refused for a photo the sender cannot see, or one not there to see', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const hidden = await roll(ada, 'private');
    const p = await photo(hidden, ada);
    const pending = await photo(await roll(ada, 'public'), ada, 'pending');
    const c = await chat(sam, tom);

    as(sam);
    expect((await send(c, { photoId: p })).status).toBe(404);
    expect((await send(c, { photoId: pending })).status).toBe(404);
    expect((await send(c, { photoId: 'not-an-id' })).status).toBe(400);
    expect((await send(c, {})).status).toBe(400);
  });

  it('turns into a blank once the photo is deleted, and the words stay', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const p = await photo(await roll(ada, 'public'), ada);
    const c = await chat(ada, sam);
    as(ada);
    await send(c, { photoId: p, body: 'this one' });
    await db.update(schema.photos).set({ deletedAt: new Date() }).where(eq(schema.photos.id, p));

    const [m] = await groupMessagesFor(db, c, sam);
    expect(m).toMatchObject({ body: 'this one', photo: { id: p, thumb: null, full: null } });
  });
});

describe('a moment sent into a chat', () => {
  it('goes anywhere when it is your own', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const m = await moment(ada);
    const c = await chat(ada, sam);
    as(ada);
    expect((await send(c, { momentId: m })).status).toBe(201);
    const [msg] = await groupMessagesFor(db, c, sam);
    expect(msg).toMatchObject({ moment: { id: m } });
  });

  it('someone else’s goes only where everyone could already see it', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    await friends(ada, sam);
    const m = await moment(ada);

    as(sam);
    // Tom is not Ada's friend, so a chat with him would show it to someone Ada did not.
    expect((await send(await chat(sam, tom), { momentId: m })).status).toBe(403);
    // Ada herself is in this one, and nobody else.
    expect((await send(await chat(sam, ada), { momentId: m })).status).toBe(201);

    as(tom);
    expect((await send(await chat(tom, sam), { momentId: m })).status).toBe(404);
  });
});
