/**
 * An actor cookie that outlived the row it names.
 *
 * The production database was replaced and every browser kept its cookie, so
 * each one presented an actor id that no longer existed. `ensureActor` handed
 * it straight back without looking, and everything downstream believed it.
 *
 * `accounts.test.ts` covers the second half — that binding an account to an
 * actor which is not there now fails loudly instead of silently. This covers
 * the first: that it does not get that far, because a presented id is only
 * worth what the table says.
 *
 * Minting a fresh actor rather than throwing is deliberate. A browser holding
 * a dead id has done nothing wrong and should leave with a live one; refusing
 * would strand it with no route back except clearing cookies by hand, which is
 * precisely the state this bug produced.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the request is carrying. Swapped per test. */
let actorCookie: string | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ACTOR_COOKIE && actorCookie ? { name, value: actorCookie } : undefined,
    set: () => {},
    getAll: () => [],
    delete: () => {},
  }),
  headers: async () => ({ get: () => null }),
}));

const { __setDbForTests } = await import('@/db');
const { ensureActor } = await import('@/session');
const { ACTOR_COOKIE, sign } = await import('@/auth/cookies');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor" restart identity cascade`);
  actorCookie = undefined;
});

/** Signed the way `issueActorCookie` signs it, so `unsign` accepts it. */
function cookieFor(actorId: string): string {
  return sign(actorId);
}

describe('ensureActor', () => {
  it('keeps an actor that exists', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    actorCookie = cookieFor(actor!.id);

    expect(await ensureActor(db)).toBe(actor!.id);
    const rows = await db.select().from(schema.actors);
    expect(rows).toHaveLength(1);
  });

  it('mints a new one when the cookie names an actor that is gone', async () => {
    /*
     * The exact state a replaced database leaves behind: a well-formed,
     * correctly signed cookie for a row that no longer exists. Returning it
     * unchecked is what made sign-in answer 200 and sign nobody in.
     */
    const ghost = crypto.randomUUID();
    actorCookie = cookieFor(ghost);

    const got = await ensureActor(db);
    expect(got).not.toBe(ghost);

    const rows = await db.select().from(schema.actors);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(got);
  });

  it('mints one when there is no cookie at all', async () => {
    const got = await ensureActor(db);
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, got));
    expect(row).toBeTruthy();
  });
});
