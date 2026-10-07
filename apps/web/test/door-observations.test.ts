/**
 * Where joining loses people — `link_opened`, `join_refused` and `joined`,
 * recorded by the web's `/e/<token>` and the app's `/api/join` (design §18).
 *
 * Run through the routes, because the thing to pin is what lands in the
 * table when a real request comes through a real door: an arrival is
 * counted once and a regular is not, a refusal says why, and the web's join
 * — which used to go unrecorded — is now written down.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
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

process.env.SESSION_SECRET ??= 'test-secret';

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const link = await import('../app/e/[token]/route');
const join = await import('../app/api/join/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "account", "actor", "event", "observation", "rate_limit" restart identity cascade`);
  headerBag.clear();
});

async function person(signedIn = false) {
  const [account] = signedIn
    ? await db.insert(schema.accounts).values({ email: `${crypto.randomUUID()}@example.test` }).returning()
    : [null];
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: signedIn ? 'user' : 'guest', accountId: account?.id ?? null })
    .returning();
  return row!.id;
}

async function album(overrides: Partial<typeof schema.events.$inferInsert> = {}) {
  const creator = await person();
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: creator, ...overrides })
    .returning();
  await db.insert(schema.eventParticipants).values({ eventId: row!.id, actorId: creator });
  return { ...row!, creator };
}

/** The web door. A redirect throws inside Next; it is the expected way out. */
async function openOnWeb(token: string) {
  const request = new Request(`https://parea.test/e/${token}`, { headers: { 'user-agent': BROWSER } });
  try {
    return await link.GET(request, { params: Promise.resolve({ token }) });
  } catch (err) {
    if (String((err as { digest?: string }).digest ?? err).includes('NEXT_REDIRECT')) return 'redirect';
    throw err;
  }
}

function openInApp(token: string, actorId: string | null, client: 'ios' | 'android' = 'ios') {
  if (actorId) headerBag.set('authorization', `Bearer ${sign(actorId)}`);
  else headerBag.delete('authorization');
  return join.POST(
    new Request('https://parea.test/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-parea-client': client },
      body: JSON.stringify({ linkToken: token }),
    }),
  );
}

const observed = async () =>
  (await db.select().from(schema.observations)).map((o) => `${o.kind}:${o.client}${o.reason ? `:${o.reason}` : ''}`).sort();

describe('the doors', () => {
  it('record a signed-out web arrival, and that it was sent to sign in', async () => {
    // Every roll needs an account now: the link goes to sign-in and back.
    const a = await album();
    expect(await openOnWeb(a.linkToken)).toBe('redirect');
    expect(await observed()).toEqual(['join_refused:web:sign_in_required', 'link_opened:web']);
  });

  it('say sign in before anything else, even on a closed roll', async () => {
    const a = await album({ joinsOpen: false });
    await openOnWeb(a.linkToken);
    expect(await observed()).toEqual(['join_refused:web:sign_in_required', 'link_opened:web']);
  });

  it('record an arrival in the app, and a refusal with its reason', async () => {
    const open = await album();
    const closed = await album({ joinsOpen: false });
    const me = await person(true);
    await openInApp(open.linkToken, me);
    await openInApp(closed.linkToken, me, 'android');
    expect(await observed()).toEqual([
      'join_refused:android:joins_closed',
      'joined:ios',
      'link_opened:android',
      'link_opened:ios',
    ]);
  });

  it('do not count somebody already in the album as arriving', async () => {
    const a = await album();
    await openInApp(a.linkToken, a.creator);
    expect(await observed()).not.toContain('link_opened:ios');
  });

  it('ignore a link nobody can find', async () => {
    expect(await openOnWeb(newLinkToken())).not.toBe('redirect');
    expect(await observed()).toEqual([]);
  });
});
