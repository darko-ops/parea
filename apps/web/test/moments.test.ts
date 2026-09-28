/**
 * Moments: who sees one, in what order, and who can take one back.
 *
 * The audience is the part worth pinning. A moment has no link and no page a
 * stranger can reach, so the one query that decides who sees it is the whole
 * of its privacy — friends, people you are in a roll with, and nobody else.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { befriend } from '@/friends';
import { MOMENT_DAYS, momentsFor, removeMoment } from '@/moments';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "friendship", "event", "moment"
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

async function moment(actorId: string, at = new Date()) {
  const [row] = await db
    .insert(schema.moments)
    .values({ actorId, key: `moments/${actorId}/x.jpg`, width: 10, height: 10, createdAt: at })
    .returning();
  return row!.id;
}

async function rollWith(...actors: string[]) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actors[0]! })
    .returning();
  await db
    .insert(schema.eventParticipants)
    .values(actors.map((actorId) => ({ eventId: event!.id, actorId })));
  return event!.id;
}

const who = async (viewer: string) => (await momentsFor(db, viewer)).map((p) => p.handle);

describe('who sees a moment', () => {
  it('shows friends and people you are in a roll with, and not strangers', async () => {
    const me = await person('me');
    const friend = await person('friend');
    const rollmate = await person('rollmate');
    const stranger = await person('stranger');
    await befriend(db, me, friend);
    await rollWith(me, rollmate);
    await moment(friend);
    await moment(rollmate);
    await moment(stranger);

    expect((await who(me)).sort()).toEqual(['friend', 'rollmate']);
  });

  it('stops showing a roll-mate once the roll is deleted', async () => {
    const me = await person('me');
    const them = await person('them');
    const roll = await rollWith(me, them);
    await moment(them);
    await db.execute(sql`update "event" set deleted_at = now() where id = ${roll}`);

    expect(await who(me)).toEqual([]);
  });

  it('hides it in both directions once either has blocked the other', async () => {
    const me = await person('me');
    const them = await person('them');
    await befriend(db, me, them);
    await moment(me);
    await moment(them);
    await db.insert(schema.blocks).values({ blockerActorId: them, blockedActorId: me });

    expect(await who(me)).toEqual(['me']);
    expect(await who(them)).toEqual(['them']);
  });

  it('shows nothing to somebody with no actor', async () => {
    expect(await momentsFor(db, null)).toEqual([]);
  });
});

describe('the row', () => {
  it('puts your own first, then whoever posted most recently', async () => {
    const me = await person('me');
    const a = await person('a');
    const b = await person('b');
    await befriend(db, me, a);
    await befriend(db, me, b);
    const minute = 60_000;
    await moment(me, new Date(Date.now() - 10 * minute));
    await moment(a, new Date(Date.now() - 5 * minute));
    await moment(b, new Date(Date.now() - 1 * minute));

    expect(await who(me)).toEqual(['me', 'b', 'a']);
  });

  it('groups each person’s moments newest first', async () => {
    const me = await person('me');
    const older = await moment(me, new Date(Date.now() - 60_000));
    const newer = await moment(me);

    const [mine] = await momentsFor(db, me);
    expect(mine!.moments.map((m) => m.id)).toEqual([newer, older]);
  });

  it(`drops a moment older than ${MOMENT_DAYS} days`, async () => {
    const me = await person('me');
    await moment(me, new Date(Date.now() - (MOMENT_DAYS + 1) * 86_400_000));

    expect(await who(me)).toEqual([]);
  });
});

describe('taking one back', () => {
  it('is its author’s alone', async () => {
    const me = await person('me');
    const them = await person('them');
    const id = await moment(me);

    expect(await removeMoment(db, them, id)).toBeNull();
    expect(await removeMoment(db, me, id)).not.toBeNull();
    expect(await who(me)).toEqual([]);
  });
});

describe('adding one', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

  it('goes to its own page from the sheet, and only Share there sends', () => {
    // The sheet used to fire a file dialog and upload whatever came back, with
    // nothing on the screen between choosing and sharing.
    expect(read('components/CreateMenu.tsx')).toMatch(/href="\/moments\/new"/);
    expect(read('components/CreateMenu.tsx')).not.toMatch(/api\/moments/);
    const add = read('components/AddMoment.tsx');
    expect(add).toMatch(/disabled=\{!file \|\| busy\}/);
    // Straight to storage, then the key: the origin cannot take a phone
    // photograph as a request body.
    expect(add).toMatch(/fetch\('\/api\/moments\/uploads'/);
    expect(add).toMatch(/JSON\.stringify\(\{ key \}\)/);
  });
});
