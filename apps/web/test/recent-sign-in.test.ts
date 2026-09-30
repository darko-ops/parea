/**
 * Actions a stolen session would take to keep an account, or to end it, need
 * a sign-in within the hour — L2. Signing out the device you hold does not.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { actorToken } = await import('@/session');
const { startSession } = await import('@/sessions');
const devices = await import('../app/api/account/devices/route');
const device = await import('../app/api/account/devices/[id]/route');
const account = await import('../app/api/account/route');

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

/** A signed-in person holding a session that signed in `minutesAgo`. */
async function signedIn(minutesAgo: number) {
  const [acc] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: acc!.id })
    .returning();
  const session = await startSession(db, { actorId: actor!.id, kind: 'ios', method: 'code' });
  await db
    .update(schema.sessions)
    .set({ signedInAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(schema.sessions.id, session.id));
  const other = await startSession(db, { actorId: actor!.id, kind: 'browser', method: 'code' });
  headerBag.set('authorization', `Bearer ${actorToken(actor!.id, session.id)}`);
  return { actorId: actor!.id, session: session.id, other: other.id };
}

const endOne = (id: string) =>
  device.DELETE(new Request(`https://parea.test/api/account/devices/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
const deleteAccount = () =>
  account.DELETE(new Request('https://parea.test/api/account', { method: 'DELETE' }));

describe('with a sign-in older than an hour', () => {
  it('refuses to sign everybody else out', async () => {
    await signedIn(120);
    const res = await devices.DELETE();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'recent_sign_in_required' });
  });

  it('refuses to sign another device out', async () => {
    const me = await signedIn(120);
    expect((await endOne(me.other)).status).toBe(403);
  });

  it('still lets you sign out the device you are holding', async () => {
    const me = await signedIn(120);
    expect((await endOne(me.session)).status).toBe(204);
  });

  it('refuses to delete the account, and deletes nothing', async () => {
    const me = await signedIn(120);
    expect((await deleteAccount()).status).toBe(403);
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, me.actorId));
    expect(row!.accountId).not.toBeNull();
  });
});

describe('with a sign-in in the last hour', () => {
  it('signs the others out', async () => {
    await signedIn(5);
    const res = await devices.DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: 1 });
  });

  it('deletes the account', async () => {
    await signedIn(5);
    const res = await deleteAccount();
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });
});
