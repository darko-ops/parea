/**
 * A token from before sessions were recorded is traded for one that can be
 * revoked.
 *
 * It names an actor and no session, so signing out, "sign out everywhere" and
 * deleting the account all passed it by. The phone presents it at launch.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { POST } = await import('../app/api/session/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "session" restart identity cascade`);
  headerBag.clear();
});

const present = async (token: string) => {
  headerBag.set('authorization', `Bearer ${token}`);
  const response = await POST(
    new Request('https://parea.test/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  return (await response.json()) as { actorToken: string };
};

describe('an old token presented at launch', () => {
  it('comes back as one with a session behind it', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    // The old format: the actor id, signed, and nothing else.
    const old = sign(actor!.id);

    const { actorToken } = await present(old);
    expect(actorToken).not.toBe(old);
    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.actorId).toBe(actor!.id);

    // And the new one, presented again, is kept rather than traded again.
    expect((await present(actorToken)).actorToken).toBe(actorToken);
    expect(await db.select().from(schema.sessions)).toHaveLength(1);
  });
});
