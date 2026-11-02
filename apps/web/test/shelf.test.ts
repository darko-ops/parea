/**
 * Organize Rolls, saved: the order somebody left their profile's shelf in.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { shelfOrder } from '@parea/cards';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { eventsFor, saveShelf } from '@/events';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "event", "shelf_position" restart identity cascade`);
});

async function person(handle: string) {
  const [actor] = await db.insert(schema.actors).values({ kind: 'user', handle }).returning();
  return actor!.id;
}

async function roll(createdBy: string, name: string) {
  const [event] = await db
    .insert(schema.events)
    .values({ name, linkToken: newLinkToken(), createdBy })
    .returning();
  await db.insert(schema.eventParticipants).values({ eventId: event!.id, actorId: createdBy });
  return event!.id;
}

const shelf = async (actorId: string) =>
  shelfOrder(await eventsFor(db, actorId)).map((e) => e.name);

describe('saving a shelf', () => {
  it('keeps the order given, and a roll made after goes in front', async () => {
    const me = await person('me');
    const a = await roll(me, 'a');
    const b = await roll(me, 'b');
    const c = await roll(me, 'c');
    await saveShelf(db, me, [c, a, b]);
    expect(await shelf(me)).toEqual(['c', 'a', 'b']);

    await roll(me, 'new');
    expect(await shelf(me)).toEqual(['new', 'c', 'a', 'b']);
  });

  it('is written whole, over the last one', async () => {
    const me = await person('me');
    const a = await roll(me, 'a');
    const b = await roll(me, 'b');
    await saveShelf(db, me, [a, b]);
    await saveShelf(db, me, [b, a]);
    expect(await shelf(me)).toEqual(['b', 'a']);
  });

  it('keeps only ids that name a roll, and nobody else\'s shelf moves', async () => {
    const me = await person('me');
    const them = await person('them');
    const a = await roll(me, 'a');
    await saveShelf(db, me, ['00000000-0000-4000-8000-0000000000ff', a, a]);
    expect((await eventsFor(db, me))[0]!.shelfPosition).toBe(0);
    await db.insert(schema.eventParticipants).values({ eventId: a, actorId: them });
    expect((await eventsFor(db, them))[0]!.shelfPosition).toBeNull();
  });
});
