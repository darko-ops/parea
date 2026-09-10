/**
 * Friends, and the search that makes them findable.
 *
 * The search is the part worth testing hardest. It is the only read in this
 * product that walks the account table, so every bound on it — what it matches,
 * what it returns, who it leaves out — is the difference between "find somebody
 * you were told about" and "enumerate the users".
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { areFriends, befriend, findPeople, friendsOf, requestsFor, unfriend } from '@/friends';

import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "block", "friend_request", "friendship"
    restart identity cascade
  `);
});

/** Somebody with an account, which is what "a person" means to the search. */
async function person(handle: string, displayName: string | null = null) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle, displayName })
    .returning();
  return actor!.id;
}

/** A device that has never signed in. Exists for anyone who opened a link. */
async function guest(handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', handle })
    .returning();
  return actor!.id;
}

describe('finding somebody by handle', () => {
  it('matches the start of a handle, not the middle', async () => {
    // Prefix only. Substring search would let somebody sweep the table with a
    // couple of common letters, which is enumeration wearing a search box.
    const me = await person('me');
    await person('AmberQuietLantern');

    expect((await findPeople(db, me, 'amber')).map((p) => p.handle)).toEqual([
      'AmberQuietLantern',
    ]);
    expect(await findPeople(db, me, 'quiet')).toEqual([]);
  });

  it('ignores case, because nobody remembers capitalising a handle', async () => {
    const me = await person('me');
    await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'AMBERQ')).toHaveLength(1);
  });

  it('refuses a query too short to be aimed at anybody', async () => {
    const me = await person('me');
    await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'a')).toEqual([]);
    expect(await findPeople(db, me, '')).toEqual([]);
  });

  it('never returns the searcher', async () => {
    const me = await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('leaves out devices that have never signed in', async () => {
    // A guest actor exists for anybody who has ever opened a link. They are
    // not a person with an account and must not appear in a list of people.
    const me = await person('me');
    await guest('AmberQuietLantern');
    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('leaves out an actor folded into another', async () => {
    // Merged actors keep their handle and their row. Returning one offers a
    // person who cannot be asked, because nothing points at them any more.
    const me = await person('me');
    const old = await person('AmberQuietLantern');
    const survivor = await person('survivor');
    await db
      .update(schema.actors)
      .set({ mergedIntoId: survivor })
      .where((await import('drizzle-orm')).eq(schema.actors.id, old));

    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('hides each of two people from the other after a block', async () => {
    // Both directions. A block that still let them find you and ask to be
    // friends would be a block in name only — and one that let you find them
    // would tell you the block exists, which blocking is careful not to do.
    const me = await person('me');
    const them = await person('AmberQuietLantern');
    await db.insert(schema.blocks).values({ blockerActorId: me, blockedActorId: them });

    expect(await findPeople(db, me, 'amber')).toEqual([]);
    expect(await findPeople(db, them, 'me')).toEqual([]);
  });

  it('returns a handle, a name and a picture, and nothing else', async () => {
    /*
     * The shape is the promise: no email, no events, no counts. A field added
     * here is a field published to anybody who can type a handle, so this test
     * exists to make that addition a decision rather than an accident.
     *
     * `avatarKey` is the picture, and it is a *key* — the storage address,
     * which does not expire. It never leaves the server in that form; the two
     * routes below presign it and drop the key, which is what the next
     * describe is about.
     */
    const me = await person('me');
    await person('AmberQuietLantern', 'Sam');
    const [found] = await findPeople(db, me, 'amber');
    expect(Object.keys(found!).sort()).toEqual([
      'actorId',
      'avatarKey',
      'displayName',
      'handle',
    ]);
  });
});

/**
 * The picture, on its way out.
 *
 * Faces were added to these two endpoints so a picker could be recognised
 * rather than read. What must not follow them out is the storage key: a
 * presigned URL is a permission that expires in an hour, and a key is an
 * internal address that expires never — the difference between handing
 * somebody a photograph and handing them the filing cabinet.
 *
 * Source checks, because the property is about the shape of a reply rather
 * than about anything a unit can be handed.
 */
describe('what the endpoints publish', () => {
  const read = (path: string) =>
    stripComments(
      readFileSync(fileURLToPath(new URL(`../app/api/${path}`, import.meta.url)), 'utf8'),
    );

  for (const route of ['friends/route.ts', 'people/route.ts']) {
    it(`presigns the picture and drops the key in ${route}`, () => {
      const source = read(route);
      // Signed through the same hour-long helper every other face uses.
      expect(source).toMatch(/avatar: await avatarUrl\(/);
      // And the key overwritten rather than merely not mentioned: both build
      // the reply by spreading the row, so a field left in place rides out.
      expect(source).toMatch(/avatarKey: undefined/);
    });
  }

  it('does not hand a key to a client component from the find page', () => {
    /*
     * The other door out, and the one a type will not catch: `friends` and
     * `suggested` are `Person` rows passed straight into a client component,
     * which serialises every property they carry whether the receiving type
     * declares it or not.
     */
    const page = stripComments(
      readFileSync(fileURLToPath(new URL('../app/find/page.tsx', import.meta.url)), 'utf8'),
    );
    expect(page).toMatch(/avatarKey: undefined/);
    expect(page).toMatch(/friends=\{friendFaces\}/);
    expect(page).toMatch(/suggested=\{suggestedFaces\}/);
  });
});

describe('being friends', () => {
  it('is symmetric, and both halves are written together', async () => {
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);

    expect(await areFriends(db, a, b)).toBe(true);
    expect(await areFriends(db, b, a)).toBe(true);
    expect((await friendsOf(db, a)).map((p) => p.handle)).toEqual(['b']);
    expect((await friendsOf(db, b)).map((p) => p.handle)).toEqual(['a']);
  });

  it('cannot be with yourself', async () => {
    const a = await person('a');
    await befriend(db, a, a);
    expect(await friendsOf(db, a)).toEqual([]);
  });

  it('is removed from both sides at once', async () => {
    // Half an unfriending leaves one person with a row the other cannot see,
    // and nothing in the product knows how to read that.
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);
    await unfriend(db, b, a);

    expect(await friendsOf(db, a)).toEqual([]);
    expect(await friendsOf(db, b)).toEqual([]);
  });

  it('doing it twice is not an error', async () => {
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);
    await expect(befriend(db, a, b)).resolves.toBeUndefined();
  });
});

describe('the requests waiting on you', () => {
  it('is the open ones pointed at you', async () => {
    const me = await person('me');
    const them = await person('them');
    const other = await person('other');
    await db.insert(schema.friendRequests).values([
      { fromActorId: them, toActorId: me },
      // Answered, and somebody else's — neither belongs in this list.
      { fromActorId: other, toActorId: me, status: 'declined' } as never,
      { fromActorId: me, toActorId: other },
    ]);

    const waiting = await requestsFor(db, me);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.handle).toBe('them');
  });

  it('is empty for somebody with no actor', async () => {
    expect(await requestsFor(db, null)).toEqual([]);
    expect(await friendsOf(db, null)).toEqual([]);
    expect(await findPeople(db, null, 'amber')).toEqual([]);
  });
});
