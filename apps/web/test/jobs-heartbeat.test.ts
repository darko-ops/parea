/**
 * The watcher for the hourly clean-up: alerts on silence, once per outage.
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

const captured: string[] = [];
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string) => captured.push(message),
  flush: async () => true,
}));

const { __setDbForTests } = await import('@/db');
const { GET } = await import('../app/api/cron/jobs-heartbeat/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "job_run"`);
  captured.length = 0;
  process.env.CRON_SECRET = 'cron-secret';
  delete process.env.OPS_ALERT_EMAIL;
});

const call = (auth = 'Bearer cron-secret') =>
  GET(new Request('https://parea.test/api/cron/jobs-heartbeat', { headers: { authorization: auth } }));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const succeeded = (at: Date) => db.insert(schema.jobRuns).values({ name: 'hourly', lastSucceededAt: at });

describe('the jobs heartbeat', () => {
  it('answers only the scheduler', async () => {
    expect((await call('Bearer wrong')).status).toBe(404);
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(503);
    expect(captured).toHaveLength(0);
  });

  it('stays quiet while the job is running', async () => {
    await succeeded(hoursAgo(1));
    const res = await call();
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it('raises one alert when the job has gone quiet, not one an hour', async () => {
    await succeeded(hoursAgo(5));
    await call();
    await call();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatch(/has not succeeded for 5 hours/);
  });

  it('raises one for a job that has never reported', async () => {
    await call();
    expect(captured[0]).toMatch(/never recorded a successful run/);
  });

  it('forgets the alert once the job recovers, so the next outage is told', async () => {
    await succeeded(hoursAgo(5));
    await call();
    await db.update(schema.jobRuns).set({ lastSucceededAt: hoursAgo(0) });
    await call();
    const [row] = await db.select().from(schema.jobRuns);
    expect(row!.lastAlertedAt).toBeNull();
  });

  it('is scheduled on Vercel, away from the job it watches', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
    expect(config.crons).toContainEqual({ path: '/api/cron/jobs-heartbeat', schedule: '20 * * * *' });
  });

  describe('the off-site backup', () => {
    const backup = (set: Record<string, unknown>) => db.insert(schema.jobRuns).values({ name: 'backup', ...set });

    it('is not watched before the job has ever written its row', async () => {
      await succeeded(hoursAgo(1));
      const body = (await (await call()).json()) as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(captured).toHaveLength(0);
    });

    it('stays quiet with a copy from last night', async () => {
      await succeeded(hoursAgo(1));
      await backup({ lastSucceededAt: hoursAgo(20) });
      expect(((await (await call()).json()) as { ok: boolean }).ok).toBe(true);
      expect(captured).toHaveLength(0);
    });

    it('alerts once when no copy has succeeded for 26 hours', async () => {
      await succeeded(hoursAgo(1));
      await backup({ lastSucceededAt: hoursAgo(27), lastError: 'pg_dump exited 1' });
      await call();
      await call();
      expect(captured).toEqual(['The off-site database backup has not succeeded for 27 hours']);
    });

    it('alerts when it is running but not configured', async () => {
      await succeeded(hoursAgo(1));
      await backup({ lastFailedAt: hoursAgo(0), lastError: 'not configured: BACKUP_AGE_RECIPIENT' });
      await call();
      expect(captured).toEqual(['The off-site database backup has never recorded a successful run']);
    });
  });
});
