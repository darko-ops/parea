/**
 * Reactions, comments and favourites for the hub — `src/adminEngagement.ts` —
 * and the two records behind "did they take their favourites away": which set
 * a download was, decided on the server, and camera-roll saves the app reports.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: () => null }),
}));

const { __setDbForTests } = await import('@/db');
const route = await import('../app/api/admin/engagement/route');
const observations = await import('../app/api/observations/route');
const { downloadScope } = await import('@/observe');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const TOKEN = 'b'.repeat(48);
const STAFF = 'mod@daed.io';

let db: Db;
const saved = { ...process.env };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

afterAll(() => {
  process.env = { ...saved };
});

beforeEach(async () => {
  process.env.ADMIN_API_TOKEN = TOKEN;
  process.env.ADMIN_STAFF = STAFF;
  await db.execute(sql`truncate "actor", "event", "photo", "observation", "moment", "groups" restart identity cascade`);
});

async function get(query = '') {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}`, 'x-parea-staff': STAFF });
  const res = await route.GET(new Request(`https://parea.test/api/admin/engagement${query}`, { headers }));
  return { status: res.status, body: await res.json() };
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

async function person(name: string) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', displayName: name }).returning();
  return row!.id;
}

async function roll(createdBy: string, hoursAgo = 48) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, createdAt: ago(hoursAgo) })
    .returning();
  return row!.id;
}

async function photo(eventId: string, uploaderId: string) {
  const [row] = await db
    .insert(schema.photos)
    .values({ eventId, uploaderId, storageKey: `k-${Math.random()}`, byteSize: 1, mime: 'image/jpeg', status: 'ready', bytesAt: ago(24) })
    .returning();
  return row!.id;
}

async function moment(actorId: string) {
  const [row] = await db.insert(schema.moments).values({ actorId, key: `m-${Math.random()}`, width: 1, height: 1 }).returning();
  return row!.id;
}

describe('the engagement totals', () => {
  it('counts reactions, comments and favourites, and the people behind them', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    const quiet = await roll(ada);
    const [p1, p2] = [await photo(e, ada), await photo(e, ada)];
    const m = await moment(sam);

    await db.insert(schema.photoReactions).values([
      { photoId: p1, actorId: sam, emoji: '🔥' },
      { photoId: p1, actorId: tom, emoji: '🔥' },
      { photoId: p2, actorId: ada, emoji: '😂' }, // the uploader's own
      { photoId: p1, actorId: sam, emoji: '❤️', createdAt: ago(24 * 60) }, // outside 30 days
    ]);
    await db.insert(schema.momentReactions).values([{ momentId: m, actorId: ada, emoji: '🔥' }]);
    await db.insert(schema.eventMessages).values([
      { eventId: e, authorActorId: sam, photoId: p1, body: 'love this' },
      { eventId: e, authorActorId: tom, photoId: p1, body: 'same' },
      { eventId: e, authorActorId: ada, body: 'thanks all' },
      { eventId: e, authorActorId: tom, body: 'gone', deletedAt: new Date() },
    ]);
    await db.insert(schema.momentComments).values([{ momentId: m, actorId: tom, body: 'nice' }]);
    await db.insert(schema.photoFavourites).values([
      { photoId: p1, actorId: sam },
      { photoId: p2, actorId: sam },
      { photoId: p1, actorId: tom },
    ]);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.reactions.photos).toEqual({ reactions: 3, people: 3, reactedTo: 2, added: 2, addedWithReaction: 1 });
    expect(body.reactions.moments).toEqual({ reactions: 1, people: 1, reactedTo: 1, shared: 1, sharedWithReaction: 1 });
    expect(body.reactions.people).toBe(3);
    expect(body.reactions.emoji[0]).toEqual({ emoji: '🔥', n: 3 });

    expect(body.comments.photos).toEqual({ comments: 2, people: 2, commentedOn: 1 });
    expect(body.comments.threads).toEqual({ messages: 1, people: 1 });
    expect(body.comments.moments).toEqual({ comments: 1, people: 1 });
    expect(body.comments.people).toBe(3);

    // Two rolls made in the period: one with three comments, one with none.
    expect(body.perRoll).toMatchObject({ rolls: 2, withAny: 1, withPhotoComments: 1, total: 3, medianWhenAny: 3, medianVoicesWhenAny: 3 });
    expect(body.perRoll.buckets).toEqual({ none: 1, few: 1, some: 0, many: 0 });
    expect(quiet).toBeTruthy();

    expect(body.favourites).toMatchObject({ added: 3, people: 2, photos: 2, medianPerPerson: 1.5, ever: { people: 2, total: 3 } });
    expect(body.weeks).toHaveLength(12);
    expect(body.weeks.at(-1).reactions + body.weeks.at(-2).reactions).toBeGreaterThanOrEqual(4);

    // Totals only: no actor or roll id anywhere in the answer.
    const text = JSON.stringify(body);
    for (const id of [ada, sam, tom, e, p1, m]) expect(text).not.toContain(id);
  });
});

describe('rolls, chats and moments', () => {
  it('counts rolls made, how full they are, and who is in them', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const big = await roll(ada);
    const empty = await roll(sam);
    await roll(ada, 24 * 60); // made before the period
    for (const who of [ada, sam, tom]) await db.insert(schema.eventParticipants).values({ eventId: big, actorId: who });
    await db.insert(schema.eventParticipants).values({ eventId: empty, actorId: sam });
    await photo(big, ada);
    await photo(big, sam);
    await photo(big, sam);
    await db.insert(schema.eventMessages).values([{ eventId: big, authorActorId: tom, body: 'hi' }]);

    const { body } = await get();
    expect(body.rolls).toMatchObject({
      created: 2,
      ever: 3,
      withPhotos: 1,
      photos: 3,
      medianPhotos: 1.5,
      medianPhotosWhenAny: 3,
      people: 4,
      medianPeople: 2,
      medianContributors: 2,
      withThread: 1,
      thread: 1,
    });
    expect(body.rolls.photoBuckets).toEqual({ none: 1, few: 1, some: 0, many: 0 });
    expect(body.rolls.peopleBuckets).toEqual({ one: 1, few: 1, some: 0, many: 0 });
  });

  it('tells one-to-one chats from groups', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const [direct] = await db.insert(schema.groups).values({}).returning();
    const [named] = await db.insert(schema.groups).values({ name: 'Flat', slug: 'flat' }).returning();
    const [three] = await db.insert(schema.groups).values({}).returning();
    for (const [g, who] of [[direct, [ada, sam]], [named, [ada, sam]], [three, [ada, sam, tom]]] as const) {
      for (const a of who) await db.insert(schema.groupMembers).values({ groupId: g!.id, actorId: a });
    }
    const m = await moment(ada);
    await db.insert(schema.groupMessages).values([
      { groupId: direct!.id, authorActorId: ada, body: 'hey' },
      { groupId: direct!.id, authorActorId: sam, body: 'hey', momentId: m },
      { groupId: three!.id, authorActorId: tom, body: 'all' },
    ]);

    const { body } = await get();
    expect(body.chats.direct).toMatchObject({ total: 1, active: 1, messages: 2, people: 2, momentReplies: 1, medianMembers: 2 });
    expect(body.chats.groups).toMatchObject({ total: 2, active: 1, messages: 1, people: 1, momentReplies: 0, medianMembers: 2.5 });
  });

  it('counts moments shared, seen by others, and answered', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const [m1, m2] = [await moment(ada), await moment(sam)];
    await db.insert(schema.momentViews).values([
      { actorId: sam, momentId: m1 },
      { actorId: tom, momentId: m1 },
      { actorId: ada, momentId: m1 }, // its own author
    ]);
    await db.insert(schema.momentComments).values([{ momentId: m1, actorId: tom, body: 'ha' }]);

    const { body } = await get();
    expect(body.moments).toEqual({ shared: 2, people: 2, views: 2, viewers: 2, medianViews: 1, seen: 1, withComment: 1 });
    expect(m2).toBeTruthy();
  });
});

describe('which set a download was', () => {
  it('is the whole roll, the person’s favourites, one photo, or a selection', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const e = await roll(ada);
    const [p1, p2, p3] = [await photo(e, ada), await photo(e, ada), await photo(e, ada)];
    await db.insert(schema.photoFavourites).values([
      { photoId: p1, actorId: sam },
      { photoId: p2, actorId: sam },
    ]);
    expect(await downloadScope(db, e, sam, null)).toBe('all');
    expect(await downloadScope(db, e, sam, [p2, p1])).toBe('favourites');
    expect(await downloadScope(db, e, sam, [p1, p3])).toBe('selection');
    expect(await downloadScope(db, e, sam, [p3])).toBe('one');
    expect(await downloadScope(db, e, null, [p1, p2])).toBe('selection');
  });

  it('counts favourites taken away, by download or by saving to the phone', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    const p1 = await photo(e, ada);
    await db.insert(schema.photoFavourites).values([
      { photoId: p1, actorId: sam },
      { photoId: p1, actorId: tom },
    ]);
    await db.insert(schema.observations).values([
      { kind: 'download', eventId: e, actorId: sam, client: 'web', count: 1, scope: 'favourites' },
      { kind: 'download', eventId: e, actorId: ada, client: 'web', count: 1, scope: 'all' },
      { kind: 'download', eventId: e, actorId: ada, client: 'web', count: 1 },
    ]);

    // The app reports its own save; anything but a known scope is dropped.
    const post = (body: unknown) =>
      observations.POST(
        new Request('https://parea.test/api/observations', {
          method: 'POST',
          headers: { 'x-parea-client': 'ios' },
          body: JSON.stringify(body),
        }),
      );
    expect((await post({ kind: 'device_save', eventId: e, count: 1, scope: 'favourites' })).status).toBe(204);
    expect((await post({ kind: 'device_save', eventId: e, count: 4, scope: 'everything' })).status).toBe(204);

    const { body } = await get();
    expect(body.delivery.downloads.favourites).toEqual({ times: 1, people: 1, photos: 1 });
    expect(body.delivery.downloads.all.times).toBe(1);
    expect(body.delivery.downloads.unknown.times).toBe(1);
    expect(body.delivery.deviceSaves.favourites.times).toBe(1);
    expect(body.delivery.deviceSaves.unknown).toEqual({ times: 1, people: 0, photos: 4 });
    expect(body.favourites).toMatchObject({ people: 2, favouritersWhoTook: 1, peopleWhoTook: 1 });
    expect(body.delivery.scopeSince).not.toBeNull();
  });

  it('is refused without the admin token', async () => {
    const res = await route.GET(new Request('https://parea.test/api/admin/engagement'));
    expect(res.status).not.toBe(200);
  });
});
