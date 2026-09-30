/**
 * A block hides two people from each other, both ways, everywhere they meet —
 * and only the person who blocked can see it, on their list, and undo it.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
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
const { messagesFor, postMessage, toggleReaction } = await import('@/messages');
const { tagPhoto, tagsForPhotos } = await import('@/photoTags');
const { blockedEitherWay } = await import('@/moderation');
const blocks = await import('../app/api/blocks/route');
const { decide } = await import('@/access');
const { eventsFor } = await import('@/events');
const { addMember, groupArchive, groupEvents } = await import('@/groups');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "actor", "event", "photo", "block", "groups", "group_member", "event_participant", "event_message", "message_reaction", "photo_tag"
    restart identity cascade
  `);
  headerBag.clear();
});

async function person(displayName: string) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', displayName }).returning();
  return row!.id;
}

async function block(blocker: string, blocked: string) {
  await db.insert(schema.blocks).values({ blockerActorId: blocker, blockedActorId: blocked });
}

async function roll(host: string) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: host })
    .returning();
  return event!.id;
}

function as(actorId: string) {
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

describe('blockedEitherWay', () => {
  it('answers yes from both sides and no for anybody else', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    await block(ada, sam);
    expect(await blockedEitherWay(db, ada, sam)).toBe(true);
    expect(await blockedEitherWay(db, sam, ada)).toBe(true);
    expect(await blockedEitherWay(db, ada, tom)).toBe(false);
  });
});

describe('reactions on a message in a shared album', () => {
  it('are hidden in both directions', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const event = await roll(tom);
    const said = await postMessage(db, event, tom, 'Great night');
    await toggleReaction(db, said, ada, '❤️');
    await toggleReaction(db, said, sam, '🔥');
    await block(ada, sam);

    const emojis = async (viewer: string) =>
      (await messagesFor(db, event, viewer, (id) => id))
        .find((m) => m.id === said)!
        .reactions.map((r) => r.emoji)
        .sort();

    expect(await emojis(ada)).toEqual(['❤️']);
    expect(await emojis(sam)).toEqual(['🔥']);
    expect(await emojis(tom)).toEqual(['❤️', '🔥'].sort());
  });
});

describe('tags', () => {
  it('hide a person tagged, or tagging, across a block', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const event = await roll(tom);
    const [photo] = await db
      .insert(schema.photos)
      .values({ eventId: event, uploaderId: tom, storageKey: 'k', byteSize: 1, mime: 'image/jpeg', status: 'ready' })
      .returning();
    await tagPhoto(db, photo!.id, sam, tom); // Sam, tagged by Tom
    await tagPhoto(db, photo!.id, tom, sam); // Tom, tagged by Sam
    await block(ada, sam);

    const tagged = async (viewer: string) =>
      ((await tagsForPhotos(db, event, [photo!.id], viewer)).get(photo!.id) ?? []).length;
    expect(await tagged(ada)).toBe(0);
    expect(await tagged(tom)).toBe(2);
  });
});

describe('the blocked list', () => {
  it('lists the people you blocked, and never the people who blocked you', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    await block(ada, sam);
    await block(tom, ada);

    as(ada);
    const { blocked } = await (await blocks.GET()).json();
    expect(blocked.map((b: { name: string }) => b.name)).toEqual(['Sam']);
  });

  it('unblocks by person', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    await block(ada, sam);
    as(ada);
    const res = await blocks.DELETE(
      new Request('https://parea.test/api/blocks', {
        method: 'DELETE',
        body: JSON.stringify({ actorId: sam }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await blockedEitherWay(db, ada, sam)).toBe(false);
  });

  it('cannot undo a block somebody else made', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    await block(sam, ada);
    as(ada);
    await blocks.DELETE(
      new Request('https://parea.test/api/blocks', {
        method: 'DELETE',
        body: JSON.stringify({ actorId: sam }),
      }),
    );
    expect(await blockedEitherWay(db, ada, sam)).toBe(true);
  });
});

describe('blocking from what somebody wrote, or from their profile', () => {
  const post = (body: unknown) =>
    blocks.POST(new Request('https://parea.test/api/blocks', { method: 'POST', body: JSON.stringify(body) }));

  it('blocks the author of a message in a group you are in', async () => {
    const { postGroupMessage } = await import('@/groupMessages');
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: `g-${crypto.randomUUID()}` }).returning();
    await addMember(db, group!.id, ada);
    await addMember(db, group!.id, sam);
    const said = await postGroupMessage(db, group!.id, sam, 'hey');

    as(ada);
    expect((await post({ groupMessageId: said })).status).toBe(200);
    expect(await blockedEitherWay(db, ada, sam)).toBe(true);
  });

  it('will not name the author of a message you cannot see', async () => {
    const { postGroupMessage } = await import('@/groupMessages');
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: `g-${crypto.randomUUID()}` }).returning();
    await addMember(db, group!.id, sam);
    const said = await postGroupMessage(db, group!.id, sam, 'hey');

    as(ada);
    expect((await post({ groupMessageId: said })).status).toBe(404);
    expect(await blockedEitherWay(db, ada, sam)).toBe(false);
  });

  it('blocks from a profile, and not yourself', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    as(ada);
    expect((await post({ actorId: sam })).status).toBe(200);
    expect(await blockedEitherWay(db, ada, sam)).toBe(true);
    expect((await post({ actorId: ada })).status).toBe(400);
  });

  it('blocks the author of an album message', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const event = await roll(ada);
    const said = await postMessage(db, event, sam, 'hi');
    as(ada);
    expect((await post({ messageId: said })).status).toBe(200);
    expect(await blockedEitherWay(db, ada, sam)).toBe(true);
  });
});

describe('albums made by somebody across a block', () => {
  async function scene() {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: `g-${crypto.randomUUID()}` }).returning();
    for (const who of [ada, sam, tom]) await addMember(db, group!.id, who);
    const [samsAlbum] = await db
      .insert(schema.events)
      .values({ name: 'Sam’s', linkToken: newLinkToken(), createdBy: sam, groupId: group!.id })
      .returning();
    const [tomsAlbum] = await db
      .insert(schema.events)
      .values({ name: 'Tom’s', linkToken: newLinkToken(), createdBy: tom, groupId: group!.id })
      .returning();
    return { ada, sam, tom, group: group!.id, samsAlbum: samsAlbum!, tomsAlbum: tomsAlbum! };
  }

  it('cannot be opened, from either side, and look deleted', async () => {
    const { ada, sam, tom, samsAlbum } = await scene();
    await block(ada, sam);
    const view = (who: string) => decide(db, samsAlbum as never, 'view', { actorId: who } as never);
    expect(await view(ada)).toEqual({ allow: false, reason: 'event_deleted' });
    expect((await view(tom)).allow).toBe(true);
    expect((await view(sam)).allow).toBe(true);
  });

  it('are left out of the home list and the shared group, both ways', async () => {
    const { ada, sam, group, samsAlbum, tomsAlbum } = await scene();
    const [adasAlbum] = await db
      .insert(schema.events)
      .values({ name: 'Ada’s', linkToken: newLinkToken(), createdBy: ada, groupId: group })
      .returning();
    await block(ada, sam);

    const home = async (who: string) => (await eventsFor(db, who)).map((e) => e.id).sort();
    expect(await home(ada)).toEqual([adasAlbum!.id, tomsAlbum.id].sort());
    expect(await home(sam)).toEqual([samsAlbum.id, tomsAlbum.id].sort());

    const inGroup = async (who: string) => (await groupEvents(db, group, who)).map((e) => e.id).sort();
    expect(await inGroup(ada)).not.toContain(samsAlbum.id);
    expect(await inGroup(sam)).not.toContain(adasAlbum!.id);

    const strip = async (who: string) =>
      (await groupArchive(db, group, who, new Date(0))).map((e: { id: string }) => e.id);
    expect(await strip(ada)).not.toContain(samsAlbum.id);
    expect(await strip(ada)).toContain(tomsAlbum.id);
  });
});

describe('the places that write their own SQL', () => {
  const read = (p: string) =>
    readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

  it('check both directions', () => {
    // Moment comments and reactions, album cards, Activity, group covers.
    expect(read('src/moments.ts')).toMatch(/blockedBetween\(viewer, schema\.momentComments\.actorId\)/);
    expect(read('src/moments.ts')).toMatch(/blockedBetween\(viewer, schema\.momentReactions\.actorId\)/);
    for (const file of ['src/events.ts', 'src/activity.ts', 'src/groups.ts']) {
      expect(read(file), file).toMatch(/b\.blocked_actor_id = \$\{\w+\} and b\.blocker_actor_id/);
    }
  });

  it('never notify across a block', () => {
    const notify = read('src/notify.ts');
    expect(notify).toMatch(/from \? await notBlockedWith/);
    expect(read('app/api/events/[id]/messages/route.ts')).toMatch(/fromActorId: actorId/);
    expect(read('app/api/photos/[id]/tags/route.ts')).toMatch(/fromActorId: actorId/);
  });
});
