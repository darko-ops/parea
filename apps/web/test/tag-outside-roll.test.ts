/**
 * Tagging somebody who is not in the roll: they are asked in, where the tagger
 * could have asked them in anyway, and the tag is refused everywhere else.
 * Through the route, against a real database.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
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
const pushed: { kind: string; to: string[] }[] = [];
vi.mock('@/notify', () => ({
  nameOf: async () => 'Demetri',
  notifyEventInvite: async (_db: unknown, input: { actorIds: string[] }) => {
    pushed.push({ kind: 'invite', to: input.actorIds });
  },
  notifyPhotoTagged: async (_db: unknown, input: { toActorId: string }) => {
    pushed.push({ kind: 'tagged', to: [input.toActorId] });
  },
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { POST } = await import('../app/api/photos/[id]/tags/route');

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
    truncate "account", "actor", "event", "event_participant", "event_invite", "photo", "photo_tag",
      "block", "groups", "group_member"
    restart identity cascade
  `);
  headerBag.clear();
  pushed.length = 0;
});

async function person(handle: string) {
  const [account] = await db.insert(schema.accounts).values({ email: `${handle}@example.test` }).returning();
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle, displayName: handle, accountId: account!.id })
    .returning();
  return row!.id;
}

/** A roll `host` made, `uploader` is in, with one of `uploader`'s photographs. */
async function roll(host: string, uploader: string, accessPolicy: 'public' | 'private' = 'private') {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: host, accessPolicy })
    .returning();
  await db
    .insert(schema.eventParticipants)
    // Let in by name, as an invitation or an approved request leaves somebody.
    .values([...new Set([host, uploader])].map((actorId) => ({ eventId: event!.id, actorId, admitted: true })))
    .onConflictDoNothing();
  const [photo] = await db
    .insert(schema.photos)
    .values({ eventId: event!.id, uploaderId: uploader, storageKey: `k${event!.id}`, byteSize: 1, mime: 'image/jpeg', status: 'ready' } as never)
    .returning();
  return { eventId: event!.id, photoId: photo!.id };
}

async function tag(as: string, photoId: string, actorId: string) {
  headerBag.set('authorization', `Bearer ${sign(as)}`);
  const response = await POST(
    new Request(`https://parea.test/api/photos/${photoId}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId }),
    }),
    { params: Promise.resolve({ id: photoId }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const tags = () => db.select().from(schema.photoTags);
const invites = () => db.select().from(schema.eventInvites);

describe('tagging somebody outside the roll', () => {
  it('asks them in when you run it, and tells them about the invitation', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const { photoId } = await roll(me, me);

    const answer = await tag(me, photoId, ana);
    expect(answer).toEqual({ status: 200, body: { tagged: true, invited: true } });
    expect((await tags()).map((t) => t.actorId)).toEqual([ana]);
    expect((await invites()).map((i) => [i.actorId, i.invitedByActorId])).toEqual([[ana, me]]);
    expect(pushed).toEqual([{ kind: 'invite', to: [ana] }]);
  });

  it('asks them in from a public roll you are only in', async () => {
    const host = await person('host');
    const me = await person('me');
    const ana = await person('ana');
    const { photoId } = await roll(host, me, 'public');

    expect((await tag(me, photoId, ana)).body).toEqual({ tagged: true, invited: true });
    expect(await invites()).toHaveLength(1);
  });

  it('refuses from a private roll you do not run, and writes nothing', async () => {
    const host = await person('host');
    const me = await person('me');
    const ana = await person('ana');
    const { photoId } = await roll(host, me, 'private');

    expect(await tag(me, photoId, ana)).toEqual({ status: 403, body: { error: 'cannot_invite' } });
    expect(await tags()).toEqual([]);
    expect(await invites()).toEqual([]);
  });

  it('pushes the invitation once, however many photographs they are tagged in', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const { eventId, photoId } = await roll(me, me);
    const [second] = await db
      .insert(schema.photos)
      .values({ eventId, uploaderId: me, storageKey: 'k2', byteSize: 1, mime: 'image/jpeg', status: 'ready' } as never)
      .returning();

    await tag(me, photoId, ana);
    await tag(me, second!.id, ana);
    expect(await tags()).toHaveLength(2);
    expect(pushed).toEqual([{ kind: 'invite', to: [ana] }]);
  });

  it('refuses somebody across a block the same way as before', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const { photoId } = await roll(me, me);
    await db.insert(schema.blocks).values({ blockerActorId: ana, blockedActorId: me });

    expect(await tag(me, photoId, ana)).toEqual({ status: 403, body: { error: 'not_in_event' } });
    expect(await invites()).toEqual([]);
  });

  it('tags somebody in the roll as it always did, with no invitation', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const { eventId, photoId } = await roll(me, me);
    await db.insert(schema.eventParticipants).values({ eventId, actorId: ana });

    expect((await tag(me, photoId, ana)).body).toEqual({ tagged: true });
    expect(await invites()).toEqual([]);
    expect(pushed).toEqual([{ kind: 'tagged', to: [ana] }]);
  });
});
