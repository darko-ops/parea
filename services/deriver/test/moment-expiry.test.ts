/**
 * Moments last a day, and the clean-up is what makes that true of storage.
 *
 * The web stops showing a moment at `MOMENT_HOURS`; this pins that the job
 * then deletes it — both objects and the row — after the hour's grace, takes
 * back what its author removed, and leaves anything still live alone.
 */

import { PGlite } from '@electric-sql/pglite';
import { MOMENT_GRACE_HOURS, MOMENT_HOURS, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expireMoments } from '../src/jobs';
import type { ObjectStore } from '../src/objects';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);
const HOUR = 3600_000;

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "moment" restart identity cascade`);
});

function store(): ObjectStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async get() {
      return null;
    },
    async put() {},
    async delete(key: string) {
      deleted.push(key);
    },
    async reachable() {
      return { ok: true, detail: 'fake' };
    },
  };
}

async function moment(hoursAgo: number, deleted = false) {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [row] = await db
    .insert(schema.moments)
    .values({
      actorId: actor.id,
      key: `moments/${actor.id}/m.jpg`,
      thumbKey: `moments/${actor.id}/m-t.jpg`,
      width: 10,
      height: 10,
      createdAt: new Date(Date.now() - hoursAgo * HOUR),
      deletedAt: deleted ? new Date() : null,
    })
    .returning();
  return row;
}

const remaining = async () => (await db.select().from(schema.moments)).length;

describe('expiring moments', () => {
  it('deletes a moment past its day and the grace, objects and row', async () => {
    const old = await moment(MOMENT_HOURS + MOMENT_GRACE_HOURS + 1);
    const objects = store();

    expect(await expireMoments(db, objects)).toBe(1);
    expect(objects.deleted).toEqual([old.key, old.thumbKey]);
    expect(await remaining()).toBe(0);
  });

  it('waits out the grace, and leaves a live one alone', async () => {
    await moment(MOMENT_HOURS + MOMENT_GRACE_HOURS / 2);
    await moment(1);
    const objects = store();

    expect(await expireMoments(db, objects)).toBe(0);
    expect(objects.deleted).toEqual([]);
    expect(await remaining()).toBe(2);
  });

  it('clears out a moment its author took back', async () => {
    await moment(1, true);
    expect(await expireMoments(db, store())).toBe(1);
    expect(await remaining()).toBe(0);
  });
});
