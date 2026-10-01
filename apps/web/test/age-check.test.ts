/**
 * The age check at sign-up: asked once, when an address first makes an
 * account; neutral; and the date is never kept.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

process.env.SESSION_SECRET = 'age-check-test-secret-0123456789abcdef';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
  headers: async () => ({ get: () => null }),
}));

const { __setDbForTests } = await import('@/db');
const { MINIMUM_AGE, ageOn, ageProof, checkAgeProof } = await import('@/age');
const { signIn, storeCode } = await import('@/accounts');
const { POST } = await import('../app/api/account/session/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const SECRET = process.env.SESSION_SECRET!;
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "sign_in_code", "session", "rate_limit" restart identity cascade`);
});

const signInWith = async (body: Record<string, unknown>) => {
  const response = await POST(
    new Request('https://parea.test/api/account/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'ios', ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** A birth date `years` years and a day before today, in UTC. */
const yearsAgo = (years: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('working out an age', () => {
  const on = new Date(Date.UTC(2026, 8, 29));
  it('counts whole years, turning over on the birthday', () => {
    expect(ageOn('2013-09-29', on)).toBe(13);
    expect(ageOn('2013-09-30', on)).toBe(12);
    expect(ageOn('2000-01-01', on)).toBe(26);
  });
  it('refuses what is not a date somebody was born on', () => {
    expect(ageOn('2013-02-31', on)).toBeNull();
    expect(ageOn('2030-01-01', on)).toBeNull();
    expect(ageOn('13/09/2013', on)).toBeNull();
    expect(ageOn('1800-01-01', on)).toBeNull();
    expect(ageOn(undefined, on)).toBeNull();
  });
});

describe('the proof that carries the date', () => {
  it('is bound to the address and to ten minutes', () => {
    const now = new Date();
    const proof = ageProof(SECRET, 'sam@example.com', now);
    expect(checkAgeProof(SECRET, 'sam@example.com', proof, now)).toBe(true);
    expect(checkAgeProof(SECRET, 'other@example.com', proof, now)).toBe(false);
    expect(checkAgeProof(SECRET, 'sam@example.com', proof, new Date(now.getTime() + 11 * 60_000))).toBe(false);
    expect(checkAgeProof(SECRET, 'sam@example.com', 'nonsense', now)).toBe(false);
  });
});

describe('making an account', () => {
  it('asks a new address for a date of birth once the code is right', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const first = await signInWith({ email: 'sam@example.com', code: '123456' });
    expect(first.status).toBe(428);
    expect(first.body.error).toBe('birth_date_required');
    expect(typeof first.body.proof).toBe('string');
    // Nothing made yet.
    expect(await db.select().from(schema.accounts)).toHaveLength(0);
  });

  it(`refuses somebody under ${MINIMUM_AGE}, and makes nothing`, async () => {
    await storeCode(db, SECRET, 'kid@example.com', '123456');
    const { body } = await signInWith({ email: 'kid@example.com', code: '123456' });
    const refused = await signInWith({
      email: 'kid@example.com',
      proof: body.proof,
      birthDate: yearsAgo(MINIMUM_AGE - 1),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('too_young');
    expect(await db.select().from(schema.accounts)).toHaveLength(0);
  });

  it('makes the account, keeping only when the check passed', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const { body } = await signInWith({ email: 'sam@example.com', code: '123456' });
    const made = await signInWith({
      email: 'sam@example.com',
      proof: body.proof,
      birthDate: yearsAgo(30),
    });
    expect(made.status).toBe(200);
    expect(made.body.created).toBe(true);
    const [account] = await db.select().from(schema.accounts);
    expect(account!.ageConfirmedAt).not.toBeNull();
    expect(account!.termsAcceptedAt).not.toBeNull();
    // The date itself is nowhere: there is no column for it.
    expect(Object.keys(account!)).not.toContain('birthDate');

    // And the proof is spent: it makes an account, it does not sign anybody in.
    const replayed = await signInWith({
      email: 'sam@example.com',
      proof: body.proof,
      birthDate: yearsAgo(30),
    });
    expect(replayed.status).toBe(401);
  });

  it('makes the account in one step from the Create account form, with its name', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const made = await signInWith({
      email: 'sam@example.com',
      code: '123456',
      birthDate: yearsAgo(30),
      displayName: '  Sam Rivera  ',
    });
    expect(made.status).toBe(200);
    expect(made.body.created).toBe(true);
    const [actor] = await db
      .select({ displayName: schema.actors.displayName })
      .from(schema.actors)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId));
    expect(actor!.displayName).toBe('Sam Rivera');
  });

  it('does not rename an account that already existed', async () => {
    const [actor] = await db
      .insert(schema.actors)
      .values({ kind: 'guest', displayName: 'Sam' })
      .returning();
    await signIn(db, 'sam@example.com', actor!.id);
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const again = await signInWith({
      email: 'sam@example.com',
      code: '123456',
      birthDate: yearsAgo(30),
      displayName: 'Somebody Else',
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    const [row] = await db
      .select({ displayName: schema.actors.displayName })
      .from(schema.actors)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId));
    expect(row!.displayName).toBe('Sam');
  });

  it('tells Create account the address already has one, and signs nobody in', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    await signIn(db, 'sam@example.com', actor!.id);
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const sessionsBefore = (await db.select().from(schema.sessions)).length;
    const refused = await signInWith({
      email: 'sam@example.com',
      code: '123456',
      birthDate: yearsAgo(30),
      displayName: 'Sam',
      intent: 'create',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('account_exists');
    expect(refused.body.actorToken).toBeUndefined();
    expect(await db.select().from(schema.sessions)).toHaveLength(sessionsBefore);
  });

  it('still makes the account when Create account is used with a new address', async () => {
    await storeCode(db, SECRET, 'new@example.com', '123456');
    const made = await signInWith({
      email: 'new@example.com',
      code: '123456',
      birthDate: yearsAgo(30),
      displayName: 'New',
      intent: 'create',
    });
    expect(made.status).toBe(200);
    expect(made.body.created).toBe(true);
  });

  it('never asks somebody who already has an account', async () => {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    await signIn(db, 'sam@example.com', actor!.id);
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const again = await signInWith({ email: 'sam@example.com', code: '123456' });
    expect(again.status).toBe(200);
  });

  it('does not let a proof stand in for a code on an existing address past its ten minutes', async () => {
    const stale = ageProof(SECRET, 'sam@example.com', new Date(Date.now() - 11 * 60_000));
    const tried = await signInWith({ email: 'sam@example.com', proof: stale, birthDate: yearsAgo(30) });
    expect(tried.status).toBe(401);
  });
});
