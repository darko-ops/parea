/**
 * Suspending somebody — enforcement, not the admin route.
 *
 * The admin side is in `admin-api.test.ts`. This pins what a suspension
 * actually does to the person: every credential they hold stops resolving, a
 * phone is told it was signed out, signing in again is refused out loud, a
 * merge cannot shed it, and lifting it brings them straight back.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

process.env.SESSION_SECRET = 'suspension-test-secret-0123456789abcdef';

const headerBag = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { actorToken, currentActorId, presentedSignedOut } = await import('@/session');
const { startSession } = await import('@/sessions');
const { sign } = await import('@/auth/cookies');
const { signIn, storeCode } = await import('@/accounts');
const { mergeActor } = await import('@/merge');
const { liftSuspension, suspend } = await import('@/adminPeople');
const signInRoute = await import('../app/api/account/session/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const SECRET = process.env.SESSION_SECRET!;
const STAFF = 'mod@daed.io';
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "sign_in_code", "session", "rate_limit",
             "suspension", "staff_action"
    restart identity cascade
  `);
  headerBag.clear();
});

async function person() {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', displayName: 'Sam' }).returning();
  return row!.id;
}

async function signedInPhone(actorId: string) {
  const session = await startSession(db, { actorId, kind: 'ios', method: 'code' });
  headerBag.set('authorization', `Bearer ${actorToken(actorId, session.id)}`);
}

describe('a suspended person', () => {
  it('is signed out on a device that was signed in, and the phone is told so', async () => {
    const id = await person();
    await signedInPhone(id);
    expect(await currentActorId()).toBe(id);

    await suspend(db, STAFF, { actorId: id, reason: 'harassment' });
    expect(await currentActorId()).toBeNull();
    // The app clears itself on this, as after "sign out everywhere".
    expect(await presentedSignedOut()).toBe(true);
  });

  it('is refused on a credential from before sessions existed', async () => {
    const id = await person();
    headerBag.set('authorization', `Bearer ${sign(id)}`);
    expect(await currentActorId()).toBe(id);
    await suspend(db, STAFF, { actorId: id, reason: 'spam' });
    expect(await currentActorId()).toBeNull();
  });

  it('comes straight back when it is lifted, on the same device', async () => {
    const id = await person();
    await signedInPhone(id);
    await suspend(db, STAFF, { actorId: id, reason: 'spam' });
    await liftSuspension(db, STAFF, { actorId: id, note: 'appealed, was a mistake' });
    expect(await currentActorId()).toBe(id);

    const [row] = await db.select().from(schema.suspensions);
    expect(row).toMatchObject({ suspendedBy: STAFF, liftedBy: STAFF, liftNote: 'appealed, was a mistake' });
  });

  it('is refused at sign-in, and told why', async () => {
    const guest = await person();
    const { actorId } = await signIn(db, 'sam@example.com', guest, { ageConfirmedAt: new Date() });
    await suspend(db, STAFF, { actorId, reason: 'threats' });

    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const response = await signInRoute.POST(
      new Request('https://parea.test/api/account/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'ios', email: 'sam@example.com', code: '123456' }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('suspended');
    // No device was put on their list.
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.actorId, actorId))).toEqual([]);
  });

  it('cannot shed it by signing into an account from the suspended guest', async () => {
    const guest = await person();
    const account = await person();
    await suspend(db, STAFF, { actorId: guest, reason: 'spam' });
    await mergeActor(db, guest, account);
    await signedInPhone(account);
    expect(await currentActorId()).toBeNull();
  });

  it('cannot be suspended twice, or lifted when not suspended', async () => {
    const id = await person();
    await suspend(db, STAFF, { actorId: id, reason: 'one' });
    await expect(suspend(db, STAFF, { actorId: id, reason: 'two' })).rejects.toMatchObject({
      code: 'already_suspended',
    });
    await liftSuspension(db, STAFF, { actorId: id, note: 'ok' });
    await expect(liftSuspension(db, STAFF, { actorId: id, note: 'again' })).rejects.toMatchObject({
      code: 'not_suspended',
    });
  });

  it('does not touch anybody else', async () => {
    const bad = await person();
    const fine = await person();
    await suspend(db, STAFF, { actorId: bad, reason: 'spam' });
    await signedInPhone(fine);
    expect(await currentActorId()).toBe(fine);
  });
});
