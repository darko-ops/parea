/**
 * The one link on a profile, and what the field will accept.
 *
 * This matters more than its size suggests: the value is rendered on other
 * people's screens and handed to a browser when they tap it. A field that
 * takes whatever it is given is a field somebody puts a `javascript:` URL in.
 *
 * The route is called directly rather than asserted against, because a
 * refusal is the behaviour under test and source checks cannot see one.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { accountFor } = await import('@/accounts');
const { PATCH } = await import('../app/api/account/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;
let me: string;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`truncate "account", "actor" restart identity cascade`);
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: 'me@example.test' })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle: 'me' })
    .returning();
  me = actor!.id;
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(me)}`);
});

const save = (link: string) =>
  PATCH(
    new Request('https://parea.test/api/account', {
      method: 'PATCH',
      body: JSON.stringify({ link }),
    }),
  );

const stored = async () => (await accountFor(db, me))?.link ?? null;

describe('what the link field accepts', () => {
  it('adds the scheme somebody left off', async () => {
    // `parea.photos` is what a person types; `https://parea.photos` is what
    // opens. Https rather than http: guessing the insecure one is a guess that
    // can be listened to.
    expect((await save('parea.photos')).status).toBe(200);
    expect(await stored()).toBe('https://parea.photos/');
  });

  it('keeps a scheme somebody wrote', async () => {
    expect((await save('http://example.com/hello')).status).toBe(200);
    expect(await stored()).toBe('http://example.com/hello');
  });

  it('refuses anything that is not a web address', async () => {
    /*
     * `javascript:` is the one that matters — the value is rendered on
     * somebody else's screen and tapped there. `mailto:` is refused too, not
     * because it is dangerous but because a field that silently takes four
     * kinds of thing is a field nobody can predict.
     */
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:me@example.com',
      'tel:+15550100',
      'file:///etc/passwd',
    ]) {
      const answer = await save(bad);
      expect(answer.status, bad).toBe(400);
      expect(await stored(), bad).toBeNull();
    }
  });

  it('refuses a host with no dot in it', async () => {
    // `new URL('https://hello')` parses happily and resolves nowhere.
    expect((await save('hello')).status).toBe(400);
    expect(await stored()).toBeNull();
  });

  it('is cleared by an empty field rather than stored as one', async () => {
    await save('parea.photos');
    expect(await stored()).not.toBeNull();
    expect((await save('   ')).status).toBe(200);
    expect(await stored()).toBeNull();
  });

  it('is bounded, like everything else a person writes here', async () => {
    const long = `https://example.com/${'a'.repeat(400)}`;
    expect((await save(long)).status).toBe(200);
    expect((await stored())!.length).toBeLessThanOrEqual(200);
  });

  it('leaves the rest of the profile alone', async () => {
    // A PATCH names what it changes. Sending only a link must not clear a bio.
    await db
      .update(schema.actors)
      .set({ bio: 'Here for the photographs.' })
      .where((await import('drizzle-orm')).eq(schema.actors.id, me));
    await save('parea.photos');
    expect((await accountFor(db, me))?.bio).toBe('Here for the photographs.');
  });
});
