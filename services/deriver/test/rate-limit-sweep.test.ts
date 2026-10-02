/**
 * The hourly sweep of rate-limit counters — `expireRateLimits`.
 *
 * Each counter has to outlive its window, or the limit it backs resets early.
 * The day-long phone limits were swept after two hours, so "five texts per
 * account per day" was five every two or three hours. These pin both kinds.
 */

import { PGlite } from '@electric-sql/pglite';
import { RATE_LIMIT_LONG_WINDOWS, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expireRateLimits } from '../src/jobs';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const HOUR = 3600_000;

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "rate_limit"`);
});

const now = new Date('2026-10-02T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR);

async function counter(bucket: string, windowStart: Date) {
  await db.insert(schema.rateLimits).values({ bucket, windowStart, count: 3 });
}

const left = async () =>
  (await db.select({ bucket: schema.rateLimits.bucket }).from(schema.rateLimits))
    .map((r: { bucket: string }) => r.bucket)
    .sort();

describe('sweeping rate-limit counters', () => {
  it('sweeps an hour-long counter two hours after its window began, and not before', async () => {
    await counter('sign-in:a', hoursAgo(1.5));
    await counter('sign-in:b', hoursAgo(2.5));
    expect(await expireRateLimits(db, now)).toBe(1);
    expect(await left()).toEqual(['sign-in:a']);
  });

  it('keeps a day-long counter for its whole day', async () => {
    await counter('phone-account:me', hoursAgo(3));
    await counter('phone-daily:all', hoursAgo(20));
    expect(await expireRateLimits(db, now)).toBe(0);
    expect(await left()).toEqual(['phone-account:me', 'phone-daily:all']);
  });

  it('sweeps a day-long counter once its day and an hour are over', async () => {
    await counter('phone-account:me', hoursAgo(25.5));
    await counter('phone-daily:all', hoursAgo(24.5));
    expect(await expireRateLimits(db, now)).toBe(1);
    expect(await left()).toEqual(['phone-daily:all']);
  });

  it('does not mistake a limit whose name only starts like a long one', async () => {
    // `phone-accountish` is not `phone-account`: the bucket is name, colon, key.
    await counter('phone-accountish:x', hoursAgo(3));
    expect(await expireRateLimits(db, now)).toBe(1);
  });

  it('knows the day-long limits', () => {
    expect(RATE_LIMIT_LONG_WINDOWS).toEqual({ 'phone-account': 86_400, 'phone-daily': 86_400 });
  });
});
