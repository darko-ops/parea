#!/usr/bin/env tsx
/**
 * Apply migrations to a real database.
 *
 * `drizzle-kit generate` writes SQL; something has to run it. This is that
 * something, and it is deliberately a separate command rather than anything
 * that happens on application start: an app process that migrates on boot will
 * eventually run two of them concurrently against the same database, and the
 * failure mode is a half-applied schema.
 *
 *   DATABASE_URL=... npm run db:migrate --workspace @parea/core
 *
 * Drizzle records what it has applied, so this is idempotent and safe to run
 * on every deploy.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }

  // `max: 1` because migrations must not interleave, and no prepared
  // statements because some poolers reject them.
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    console.log('migrations applied');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
