/**
 * The daily off-site copy: when it runs, what it needs, and that a failure is
 * recorded rather than thrown. The dump itself needs `pg_dump` and `age`,
 * which only the image has; see the Dockerfile.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BACKUP, backupConfigFromEnv, backupDue, backupIfDue, backupKey, pgEnv } from '../src/backup';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "job_run"`);
});

const HOUR = 3600_000;
const RECIPIENT = 'age1' + 'q'.repeat(58);
const ENV = {
  DATABASE_URL: 'postgresql://parea:s3cr%40t@ep-wild-forest-b4ubak1w-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
  BACKUP_AGE_RECIPIENT: RECIPIENT,
  R2_ACCOUNT_ID: 'acct',
  BACKUP_R2_ACCESS_KEY_ID: 'id',
  BACKUP_R2_SECRET_ACCESS_KEY: 'secret',
  BACKUP_R2_BUCKET: 'parea-backups',
};
const row = async () => (await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, BACKUP)))[0];

describe('when a copy is due', () => {
  it('is due with none yet, or the last one 23 hours old', () => {
    const now = new Date('2026-10-10T03:00:00Z');
    expect(backupDue(null, now)).toBe(true);
    expect(backupDue(new Date(now.getTime() - 22 * HOUR), now)).toBe(false);
    expect(backupDue(new Date(now.getTime() - 23 * HOUR), now)).toBe(true);
  });

  it('names each copy by when it was taken', () => {
    expect(backupKey(new Date('2026-10-10T03:07:41Z'))).toBe('db/2026-10-10T03-07Z.dump.age');
  });
});

describe('what it needs', () => {
  it('names everything missing', () => {
    expect(backupConfigFromEnv({ DATABASE_URL: 'x' })).toEqual({
      missing: ['BACKUP_AGE_RECIPIENT', 'R2_ACCOUNT_ID', 'BACKUP_R2_ACCESS_KEY_ID', 'BACKUP_R2_SECRET_ACCESS_KEY', 'BACKUP_R2_BUCKET'],
    });
  });

  it('refuses a recipient that is not an age public key — a private key pasted by mistake, say', () => {
    const config = backupConfigFromEnv({ ...ENV, BACKUP_AGE_RECIPIENT: 'AGE-SECRET-KEY-1ABC' });
    expect(config).toEqual({ missing: ['BACKUP_AGE_RECIPIENT (not an age1… public key)'] });
  });

  it('connects directly rather than through the pooler, with the password out of the command line', () => {
    expect(pgEnv(ENV.DATABASE_URL)).toEqual({
      PGHOST: 'ep-wild-forest-b4ubak1w.us-east-2.aws.neon.tech',
      PGPORT: '5432',
      PGUSER: 'parea',
      PGPASSWORD: 's3cr@t',
      PGDATABASE: 'neondb',
      PGSSLMODE: 'require',
    });
  });
});

describe('the hourly step', () => {
  const now = new Date('2026-10-10T03:00:00Z');

  it('takes a copy and records the success', async () => {
    const taken: string[] = [];
    const said = await backupIfDue(db, {
      now,
      env: ENV,
      take: async (config) => {
        taken.push(config.bucket);
        return { key: 'db/k', bytes: 1234 };
      },
    });
    expect(said).toBe('db/k (1234 bytes)');
    expect(taken).toEqual(['parea-backups']);
    expect((await row()).lastSucceededAt).toEqual(now);
  });

  it('does nothing when the last copy is recent, unless asked by hand', async () => {
    await db.insert(schema.jobRuns).values({ name: BACKUP, lastSucceededAt: new Date(now.getTime() - 2 * HOUR) });
    let took = 0;
    const take = async () => {
      took += 1;
      return { key: 'db/k', bytes: 1 };
    };
    expect(await backupIfDue(db, { now, env: ENV, take })).toBe('not due');
    expect(took).toBe(0);
    await backupIfDue(db, { now, env: ENV, take, force: true });
    expect(took).toBe(1);
  });

  it('records a failure rather than throwing, so the other jobs still run', async () => {
    const said = await backupIfDue(db, {
      now,
      env: ENV,
      take: async () => {
        throw new Error('pg_dump exited 1: connection refused\nmore');
      },
    });
    expect(said).toBe('failed: pg_dump exited 1: connection refused');
    expect(await row()).toMatchObject({ lastError: 'pg_dump exited 1: connection refused', lastSucceededAt: null });
  });

  it('records being unconfigured as a failure, so the heartbeat says so', async () => {
    await backupIfDue(db, { now, env: { DATABASE_URL: 'x' } });
    expect((await row()).lastError).toMatch(/^not configured: BACKUP_AGE_RECIPIENT/);
  });
});
