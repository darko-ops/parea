/**
 * The hourly clean-up stamps its heartbeat, which a watcher on Vercel reads.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { HOURLY, recordRun } from '../src/jobs';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

describe('the heartbeat', () => {
  it('records a success, and a failure beside it without losing the success', async () => {
    const first = new Date('2026-09-30T01:00:00Z');
    await recordRun(db, { ok: true }, first);
    await recordRun(db, { ok: false, error: new Error('Your account or project has exceeded the quota.\nstack') }, new Date('2026-09-30T02:00:00Z'));

    const [row] = await db.select().from(schema.jobRuns);
    expect(row.name).toBe(HOURLY);
    expect(row.lastSucceededAt.toISOString()).toBe(first.toISOString());
    expect(row.lastFailedAt.toISOString()).toBe('2026-09-30T02:00:00.000Z');
    // The first line only: an alert, not a stack trace.
    expect(row.lastError).toBe('Your account or project has exceeded the quota.');
  });
});
