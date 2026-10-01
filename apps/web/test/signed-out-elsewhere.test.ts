/**
 * Telling a phone it was signed out from somewhere else.
 *
 * The app holds its albums in memory and the server's refusals are silent — a
 * revoked token reads as nobody, the same as a guest — so without a signal the
 * phone kept drawing somebody's albums after the Devices screen on another
 * device had ended its session. `signedOut` is that signal, and it must only
 * ever say yes about a session that really was ended.
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

process.env.SESSION_SECRET ??= 'test-secret';

const { __setDbForTests } = await import('@/db');
const { signIn } = await import('@/accounts');
const { actorToken } = await import('@/session');
const { revokeSession, startSession } = await import('@/sessions');
const { GET } = await import('../app/api/account/session/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "session" restart identity cascade`);
  headerBag.clear();
});

const ask = async () => (await GET()).json() as Promise<{ account: unknown; signedOut?: boolean }>;

async function signedInPhone() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const { actorId } = await signIn(db, 'sam@example.com', actor!.id);
  const session = await startSession(db, { actorId, kind: 'ios', method: 'code' });
  headerBag.set('authorization', `Bearer ${actorToken(actorId, session.id)}`);
  return { actorId, session };
}

describe('a phone asking who it is', () => {
  it('is signed in while its session stands', async () => {
    await signedInPhone();
    const answer = await ask();
    expect(answer.account).not.toBeNull();
    expect(answer.signedOut).toBeUndefined();
  });

  it('is told it was signed out once its session is ended elsewhere', async () => {
    const { actorId, session } = await signedInPhone();
    await revokeSession(db, actorId, session.id);
    expect(await ask()).toEqual({ account: null, signedOut: true });
  });

  it('is not told so when it simply has no credential', async () => {
    expect(await ask()).toEqual({ account: null, signedOut: false });
  });

  it('is not told so when it is a guest whose session stands', async () => {
    const [guest] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const session = await startSession(db, { actorId: guest!.id, kind: 'ios', method: 'guest' });
    headerBag.set('authorization', `Bearer ${actorToken(guest!.id, session.id)}`);
    const answer = await ask();
    expect(answer.account).toBeNull();
    expect(answer.signedOut).not.toBe(true);
  });
});
