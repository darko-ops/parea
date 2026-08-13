/**
 * The contributor filter, and what it discloses.
 *
 * This is the first thing in the product that puts names next to photographs
 * for anybody holding an event's link, so the bounds on it matter more than
 * the feature does: who appears, who does not, and what identifier leaves the
 * server.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contributorKey, contributorsOf } from '@/contributors';
import type { Db } from '@/db';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`truncate "actor", "account" restart identity cascade`);
});

async function person(displayName: string | null, handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, handle })
    .returning();
  return actor!.id;
}

const EVENT = '00000000-0000-4000-8000-000000000001';
const OTHER_EVENT = '00000000-0000-4000-8000-000000000002';

describe('the key a contributor is known by', () => {
  it('is not the actor id', async () => {
    // The whole point. An actor id in a feed anybody with the link can fetch
    // is a durable handle on a person, and this list exists to filter a grid.
    const id = await person('Maya');
    expect(contributorKey(EVENT, id)).not.toContain(id);
  });

  it('is the same every time, so a chosen filter survives a poll', async () => {
    const id = await person('Maya');
    expect(contributorKey(EVENT, id)).toBe(contributorKey(EVENT, id));
  });

  it('is different for the same person in a different event', async () => {
    // Two leaked links must not be joinable into "these are the same person".
    const id = await person('Maya');
    expect(contributorKey(EVENT, id)).not.toBe(contributorKey(OTHER_EVENT, id));
  });
});

describe('the list', () => {
  it('counts photos per person, most first', async () => {
    const maya = await person('Maya');
    const sam = await person('Sam');
    const people = await contributorsOf(
      db,
      EVENT,
      [
        { uploaderId: sam },
        { uploaderId: maya },
        { uploaderId: maya },
      ],
      null,
    );

    expect(people.map((p) => [p.name, p.photoCount])).toEqual([
      ['Maya', 2],
      ['Sam', 1],
    ]);
  });

  it('breaks ties by name rather than by insertion order', async () => {
    // Two polls must not reshuffle the chips under somebody's finger.
    const zoe = await person('Zoe');
    const abe = await person('Abe');
    const people = await contributorsOf(
      db,
      EVENT,
      [{ uploaderId: zoe }, { uploaderId: abe }],
      null,
    );
    expect(people.map((p) => p.name)).toEqual(['Abe', 'Zoe']);
  });

  it('names somebody by handle, then by nothing at all', async () => {
    // A guest who came through a link has neither a name nor a handle and is
    // still a person whose photographs are in the grid.
    const handled = await person(null, 'SilverBreezyCondor');
    const nobody = await person(null, null);
    const people = await contributorsOf(
      db,
      EVENT,
      [{ uploaderId: handled }, { uploaderId: nobody }],
      null,
    );
    expect(people.map((p) => p.name).sort()).toEqual(['@SilverBreezyCondor', 'Someone']);
  });

  it('only ever contains people whose rows it was given', async () => {
    /*
     * The load-bearing property. This takes rows rather than querying for
     * itself precisely so that it inherits `visiblePhotos` — a blocked
     * person's photos are already absent from the feed, and if this went and
     * fetched the event's uploaders it would put their name back on the
     * screen while their pictures stayed hidden.
     */
    const shown = await person('Shown');
    await person('Blocked');
    const people = await contributorsOf(db, EVENT, [{ uploaderId: shown }], null);
    expect(people.map((p) => p.name)).toEqual(['Shown']);
  });

  it('marks the viewer, and nobody else', async () => {
    const me = await person('Me');
    const them = await person('Them');
    const people = await contributorsOf(
      db,
      EVENT,
      [{ uploaderId: me }, { uploaderId: them }],
      me,
    );
    expect(people.filter((p) => p.mine).map((p) => p.name)).toEqual(['Me']);
  });

  it('is empty when nothing has an uploader', async () => {
    expect(await contributorsOf(db, EVENT, [], null)).toEqual([]);
    expect(await contributorsOf(db, EVENT, [{ uploaderId: null }], null)).toEqual([]);
  });

  it('returns a key, a name and two counts, and nothing else', async () => {
    // The shape is the promise. A field added here is a field published to
    // everybody holding the link.
    const id = await person('Maya', 'maya');
    const [only] = await contributorsOf(db, EVENT, [{ uploaderId: id }], null);
    expect(Object.keys(only!).sort()).toEqual(['key', 'mine', 'name', 'photoCount']);
  });
});
