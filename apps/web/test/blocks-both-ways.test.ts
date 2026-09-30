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

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "actor", "event", "photo", "block", "event_message", "message_reaction", "photo_tag"
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
