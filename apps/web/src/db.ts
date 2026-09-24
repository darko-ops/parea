import { schema } from '@parea/core';
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | null = null;

/**
 * The production database endpoint, named so that reaching it by accident is
 * loud.
 *
 * A `tsx --watch` against production ran on a laptop for eight days. Neon
 * suspends a compute once nothing is connected, so an open connection means
 * being billed for continuous uptime rather than the seconds of query time
 * actually used — it drained the month's 100 CU-hours and took sign-in down
 * for everyone. Nothing said a word: the connection string was simply the one
 * sitting in `.env.local`.
 *
 * Compute is capped per Neon *project*, so a development branch shares it and
 * would not have helped. Development has its own project now, and this is the
 * check that says so out loud when something points the wrong way.
 *
 * A host rather than a full URL: the password rotates, the endpoint does not,
 * and a secret does not belong in source. Nothing is enforced in production
 * itself, where reaching this host is the entire point — see `warnIfProduction`.
 */
const PRODUCTION_DB_HOST = 'ep-flat-heart-ax915wla';

/**
 * Warns when a local process is about to talk to the production database.
 *
 * A warning and not a refusal. Running a migration or a one-off script against
 * production is a real thing to need, and a hard failure here would be
 * something to work around rather than notice — the failure mode this exists
 * for is *not knowing*, which one loud line fixes.
 *
 * Silent on Vercel, where `VERCEL` is set and production is the correct
 * answer. Silent in tests, which use PGlite and never reach this.
 */
function warnIfProduction(url: string): void {
  if (process.env.VERCEL || process.env.NODE_ENV === 'test') return;
  if (!url.includes(PRODUCTION_DB_HOST)) return;
  console.warn(
    `\n  *** This process is connected to the PRODUCTION database (${PRODUCTION_DB_HOST}).\n` +
      '  *** Every open connection keeps Neon awake and spends the project\'s compute quota.\n' +
      '  *** Local work belongs on the development project — see apps/web/.env.example.\n',
  );
}

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  warnIfProduction(url);
  cached = drizzlePg(postgres(url, { prepare: false }), { schema });
  return cached;
}

/** Tests supply a PGlite-backed database; nothing else should call this. */
export function __setDbForTests(db: Db | null): void {
  cached = db as Db | null;
}

export { schema };
