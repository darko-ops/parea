import { schema } from '@parea/core';
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  cached = drizzlePg(postgres(url, { prepare: false }), { schema });
  return cached;
}

/** Tests supply a PGlite-backed database; nothing else should call this. */
export function __setDbForTests(db: Db | null): void {
  cached = db as Db | null;
}

export { schema };
