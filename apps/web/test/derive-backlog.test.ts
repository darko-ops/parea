/**
 * The alarm on the photo queue: says so when photographs have waited more than
 * five minutes, once an hour while it lasts, and not about one that is stuck.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const captured: string[] = [];
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string) => captured.push(message),
  flush: async () => true,
}));

const { __setDbForTests } = await import('@/db');
const { GET } = await import('../app/api/cron/derive-backlog/route');

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
    .values({ name: 'Cyprus', linkToken: 'cyprus-link', createdBy: uploaderId })
    .returning();
  eventId = event!.id;
});

beforeEach(async () => {
  await db.execute(sql`truncate "job_run"`);
  await db.execute(sql`delete from "photo"`);
  captured.length = 0;
  process.env.CRON_SECRET = 'cron-secret';
  delete process.env.OPS_ALERT_EMAIL;
});

const call = (auth = 'Bearer cron-secret') =>
  GET(new Request('https://parea.test/api/cron/derive-backlog', { headers: { authorization: auth } }));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const jobRun = async (name: string) =>
  (await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, name)))[0];
const failedPhoto = (failedAt: Date | null, failureReason: string | null) =>
  db.insert(schema.photos).values({
    eventId,
    uploaderId,
    storageKey: `k/${++n}`,
    byteSize: 1000,
    mime: 'image/heic',
    bytesAt: failedAt,
    status: 'failed',
    failedAt,
    failureReason,
  });
let n = 0;
const waiting = (bytesAt: Date | null, status: 'pending' | 'ready' = 'pending') =>
  db.insert(schema.photos).values({
    eventId,
    uploaderId,
    storageKey: `k/${++n}`,
    byteSize: 1000,
    mime: 'image/heic',
    bytesAt,
    status,
  });

describe('the photo queue alarm', () => {
  it('answers only the scheduler', async () => {
    expect((await call('Bearer wrong')).status).toBe(404);
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(503);
  });

  it('stays quiet while photographs are moving', async () => {
    await waiting(minutesAgo(2));
    await waiting(minutesAgo(10), 'ready');
    // Reserved but never uploaded is not waiting on the deriver.
    await waiting(null);
    const body = (await (await call()).json()) as { ok: boolean; waiting: number };
    expect(body).toMatchObject({ ok: true, waiting: 1 });
    expect(captured).toHaveLength(0);
    const row = await jobRun('derive_backlog');
    expect(row).toMatchObject({ name: 'derive_backlog', lastAlertedAt: null });
    expect(row!.lastSucceededAt).not.toBeNull();
  });

  it('says so once when the oldest has waited more than five minutes, not on every check', async () => {
    await waiting(minutesAgo(12));
    await waiting(minutesAgo(1));
    await call();
    await call();
    expect(captured).toEqual(['2 photos waiting to process, the oldest for 12 minutes']);
    const row = await jobRun('derive_backlog');
    expect(row!.lastError).toMatch(/2 photos waiting/);
  });

  it('leaves out one stuck for hours, which the hourly job deals with', async () => {
    await waiting(minutesAgo(8 * 60));
    expect(((await (await call()).json()) as { ok: boolean }).ok).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it('is on the fifteen-minute schedule', () => {
    const vercel = JSON.parse(
      readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
    ) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: '/api/cron/derive-backlog', schedule: '*/15 * * * *' });
  });
});

describe('the photographs that failed', () => {
  it('stays quiet when none has', async () => {
    // Failed before the deriver recorded when, or by the upload check rather
    // than the deriver: neither is counted.
    await failedPhoto(null, null);
    const body = (await (await call()).json()) as { failures: { failed: number } };
    expect(body.failures).toEqual({ failed: 0, alerted: false });
    expect(captured).toHaveLength(0);
    expect((await jobRun('derive_failures'))!.lastSucceededAt).not.toBeNull();
  });

  it('says how many failed and why, grouped by kind, while the queue itself is healthy', async () => {
    await failedPhoto(minutesAgo(3), 'decode_failed:heif: unsupported codec');
    await failedPhoto(minutesAgo(2), 'decode_failed:heif: unsupported codec');
    await failedPhoto(minutesAgo(1), 'strip_failed:exiftool exited 1');
    const body = (await (await call()).json()) as { ok: boolean; failures: { failed: number; alerted: boolean } };
    expect(body.ok).toBe(true);
    expect(body.failures).toEqual({ failed: 3, alerted: true });
    expect(captured).toEqual(['3 photos failed to process']);
    expect((await jobRun('derive_failures'))!.lastError).toBe('3 photos failed to process: decode_failed ×2, strip_failed ×1');
  });

  it('says it once an hour at most, and the next alert carries what failed in between', async () => {
    await failedPhoto(minutesAgo(1), 'decode_failed:x');
    await call();
    await failedPhoto(new Date(), 'decode_failed:y');
    await call();
    expect(captured).toEqual(['1 photo failed to process']);

    // An hour on, the next run counts from the last alert, so it carries the
    // one that failed inside the quiet hour.
    await db.update(schema.jobRuns).set({ lastAlertedAt: minutesAgo(61) }).where(eq(schema.jobRuns.name, 'derive_failures'));
    await call();
    expect(captured).toEqual(['1 photo failed to process', '2 photos failed to process']);
  });

  it('does not say the same failures twice', async () => {
    await failedPhoto(minutesAgo(1), 'decode_failed:x');
    await call();
    // Alerted just now, so nothing has failed since.
    await db.update(schema.jobRuns).set({ lastAlertedAt: new Date() }).where(eq(schema.jobRuns.name, 'derive_failures'));
    await call();
    expect(captured).toEqual(['1 photo failed to process']);
    expect((await jobRun('derive_failures'))!.lastSucceededAt).not.toBeNull();
  });
});
