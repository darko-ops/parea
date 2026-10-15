/**
 * Uploads that did not go through, for the hub — `src/adminUploadFailures.ts`.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';

const { __setDbForTests } = await import('@/db');
const route = await import('../app/api/admin/upload-failures/route');

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
  await db.execute(sql`truncate "actor", "event", "upload_failure" restart identity cascade`);
});

function get(query = '', staff: string | null = STAFF) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (staff) headers.set('x-parea-staff', staff);
  return route.GET(new Request(`https://parea.test/api/admin/upload-failures${query}`, { headers }));
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

async function person(handle: string) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: handle, handle })
    .returning();
  return row!.id;
}

async function roll(createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Beach day', linkToken: newLinkToken(), createdBy })
    .returning();
  return row!.id;
}

async function failure(actorId: string, eventId: string, over: Partial<typeof schema.uploadFailures.$inferInsert> = {}) {
  await db.insert(schema.uploadFailures).values({
    actorId,
    eventId,
    source: 'client',
    stage: 'put',
    error: 'waiting for a connection',
    cause: 'Load failed',
    client: 'web',
    ...over,
  });
}

describe('GET /api/admin/upload-failures', () => {
  it('is staff only', async () => {
    expect((await get('', null)).status).toBe(403);
  });

  it('lists failures newest first, with who and which roll', async () => {
    const maria = await person('lilac.happy.quail');
    const beach = await roll(maria);
    await failure(maria, beach, { createdAt: ago(3) });
    await failure(maria, beach, { source: 'server', stage: 'abandoned', error: 'never_confirmed', createdAt: ago(1) });

    const body = await (await get()).json();
    expect(body.totals).toMatchObject({ failures: 2, people: 1 });
    expect(body.failures.map((f: { stage: string }) => f.stage)).toEqual(['abandoned', 'put']);
    expect(body.failures[0]).toMatchObject({ handle: 'lilac.happy.quail', roll: 'Beach day' });
  });

  it('finds one person by handle, with or without the @', async () => {
    const maria = await person('lilac.happy.quail');
    const other = await person('someone.else');
    const beach = await roll(maria);
    await failure(maria, beach);
    await failure(other, beach);

    for (const q of ['lilac.happy.quail', '@Lilac.Happy.Quail', maria]) {
      const body = await (await get(`?person=${encodeURIComponent(q)}`)).json();
      expect(body.totals.failures, q).toBe(1);
      expect(body.failures[0].actorId).toBe(maria);
    }
  });

  it('groups by what went wrong and keeps to the period', async () => {
    const a = await person('a.a.a');
    const b = await person('b.b.b');
    const r = await roll(a);
    await failure(a, r, { createdAt: ago(2) });
    await failure(b, r, { createdAt: ago(30) });
    await failure(a, r, { error: 'upload failed: 403', createdAt: ago(5) });
    await failure(a, r, { createdAt: ago(24 * 10) });

    const week = await (await get('?days=7')).json();
    expect(week.groups[0]).toMatchObject({ error: 'waiting for a connection', count: 2, lastDay: 1, people: 2 });
    expect(week.totals.failures).toBe(3);

    const day = await (await get('?days=1')).json();
    expect(day.totals.failures).toBe(2);
  });
});
