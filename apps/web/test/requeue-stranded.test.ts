/**
 * The safety net under the photo queue: a photograph whose upload was
 * confirmed but which the deriver never took is sent again, once an hour.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const published: { id: string; resend?: string }[] = [];
let refuse = false;
vi.mock('@/queue', () => ({
  publishDerive: async (id: string, resend?: string) => {
    if (refuse) throw new Error('quota exceeded');
    published.push({ id, resend });
    return 'published';
  },
}));

const { __setDbForTests } = await import('@/db');
const { GET } = await import('../app/api/cron/requeue-stranded/route');
const { deduplicationKey } = await vi.importActual<typeof import('@/queue')>('@/queue');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;
let eventId: string;
let uploaderId: string;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
  const [actor] = await db.insert(schema.actors).values({ kind: 'user' }).returning();
  uploaderId = actor!.id;
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Cyprus', linkToken: 'cyprus-link-2', createdBy: uploaderId })
    .returning();
  eventId = event!.id;
});

beforeEach(async () => {
  await db.execute(sql`truncate "job_run"`);
  await db.execute(sql`delete from "photo"`);
  published.length = 0;
  refuse = false;
  process.env.CRON_SECRET = 'cron-secret';
});

const call = (auth = 'Bearer cron-secret') =>
  GET(new Request('https://parea.test/api/cron/requeue-stranded', { headers: { authorization: auth } }));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
let n = 0;
const photo = async (bytesAt: Date | null, status: 'pending' | 'ready' = 'pending') => {
  const [row] = await db
    .insert(schema.photos)
    .values({ eventId, uploaderId, storageKey: `s/${++n}`, byteSize: 1, mime: 'image/heic', bytesAt, status })
    .returning();
  return row!.id;
};

describe('the stranded-photo resend', () => {
  it('answers only the scheduler', async () => {
    expect((await call('Bearer wrong')).status).toBe(404);
  });

  it('sends again only what was confirmed and never taken', async () => {
    const stranded = await photo(minutesAgo(90));
    await photo(minutesAgo(5)); // still within a healthy queue's wait
    await photo(minutesAgo(90), 'ready');
    await photo(null); // never confirmed: the sweep's, not this
    await photo(minutesAgo(8 * 24 * 60)); // past a week
    const body = (await (await call()).json()) as { stranded: number; sent: number };
    expect(body).toMatchObject({ stranded: 1, sent: 1 });
    expect(published.map((p) => p.id)).toEqual([stranded]);
    const [row] = await db.select().from(schema.jobRuns);
    expect(row).toMatchObject({ name: 'requeue_stranded' });
    expect(row!.lastSucceededAt).not.toBeNull();
  });

  it("resends past the original message's deduplication, once per hour", async () => {
    await photo(minutesAgo(90));
    await call();
    expect(published[0]!.resend).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    const id = '0f870694-9e30-4f18-9201-8854445556b6';
    expect(deduplicationKey(id, '2026-10-07T22')).toBe(`derive-${id}-resend-2026-10-07T22`);
    expect(deduplicationKey(id)).toBe(`derive-${id}`);
  });

  it('records a refusal rather than hiding it', async () => {
    await photo(minutesAgo(90));
    refuse = true;
    const body = (await (await call()).json()) as { ok: boolean; refused: number };
    expect(body).toMatchObject({ ok: false, refused: 1 });
    const [row] = await db.select().from(schema.jobRuns);
    expect(row!.lastError).toMatch(/quota exceeded/);
  });

  it('is on the hourly schedule', () => {
    const vercel = JSON.parse(
      readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
    ) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: '/api/cron/requeue-stranded', schedule: '50 * * * *' });
  });
});
