/**
 * Parea is everybody's friend, in name only.
 *
 * Every account starts friends with @parea, and the accounts from before that
 * are befriended by `0075_parea_friends.sql`. A friendship grants things —
 * moments, adding somebody to a chat without asking, counting as a mutual —
 * and none of them were chosen here, so each of those leaves Parea out.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { signIn } from '@/accounts';
import type { Db } from '@/db';
import { eventsFor, leaveEvent } from '@/events';
import { areFriends, befriend, recommendationsFor, suggestionsFor } from '@/friends';
import { momentStream } from '@/moments';
import { PAREA_ACCOUNT_ID, PAREA_ACTOR_ID, PAREA_EMAIL, PAREA_HANDLE } from '@/parea';

import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);
const BACKFILL = readFileSync(`${MIGRATIONS}/0075_parea_friends.sql`, 'utf8');

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "friendship", "moment", "event"
    restart identity cascade
  `);
  await db.insert(schema.accounts).values({ id: PAREA_ACCOUNT_ID, email: PAREA_EMAIL });
  await db.insert(schema.actors).values({
    id: PAREA_ACTOR_ID,
    kind: 'user',
    handle: PAREA_HANDLE,
    accountId: PAREA_ACCOUNT_ID,
  });
});

async function person(handle: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle, displayName: handle })
    .returning();
  return actor!.id;
}

async function guest() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return actor!.id;
}

async function moment(actorId: string) {
  await db
    .insert(schema.moments)
    .values({ actorId, key: `moments/${actorId}/x.jpg`, width: 10, height: 10 });
}

const bothWays = async (a: string, b: string) =>
  (await areFriends(db, a, b)) && (await areFriends(db, b, a));

describe('becoming friends with Parea', () => {
  it('happens when an account is made', async () => {
    const me = await guest();
    await signIn(db, 'new@example.test', me);
    expect(await bothWays(me, PAREA_ACTOR_ID)).toBe(true);
  });

  it('does not happen again at the next sign-in, for somebody who unfriended it', async () => {
    const me = await guest();
    await signIn(db, 'new@example.test', me);
    await db
      .delete(schema.friendships)
      .where(
        and(
          eq(schema.friendships.actorId, me),
          eq(schema.friendships.friendActorId, PAREA_ACTOR_ID),
        ),
      );
    await db
      .delete(schema.friendships)
      .where(
        and(
          eq(schema.friendships.actorId, PAREA_ACTOR_ID),
          eq(schema.friendships.friendActorId, me),
        ),
      );

    await signIn(db, 'new@example.test', await guest());
    expect(await areFriends(db, me, PAREA_ACTOR_ID)).toBe(false);
  });

  it('is a no-op, not a failed sign-in, where there is no Parea actor', async () => {
    await db.execute(sql`delete from "actor" where id = ${PAREA_ACTOR_ID}`);
    const me = await guest();
    await expect(signIn(db, 'new@example.test', me)).resolves.toMatchObject({ created: true });
  });

  it('is backfilled for accounts that already exist, and not for guests or blocks', async () => {
    const ana = await person('ana');
    const bo = await person('bo');
    const passing = await guest();
    await db.insert(schema.blocks).values({ blockerActorId: bo, blockedActorId: PAREA_ACTOR_ID });

    await db.execute(sql.raw(BACKFILL));
    // And again, which changes nothing.
    await db.execute(sql.raw(BACKFILL));

    expect(await bothWays(ana, PAREA_ACTOR_ID)).toBe(true);
    expect(await areFriends(db, bo, PAREA_ACTOR_ID)).toBe(false);
    expect(await areFriends(db, passing, PAREA_ACTOR_ID)).toBe(false);
    expect(await areFriends(db, PAREA_ACTOR_ID, PAREA_ACTOR_ID)).toBe(false);
  });
});

describe('what the friendship does not do', () => {
  it('shows no moments either way', async () => {
    const me = await person('me');
    await befriend(db, me, PAREA_ACTOR_ID);
    await moment(me);
    await moment(PAREA_ACTOR_ID);

    const who = async (viewer: string) =>
      (await momentStream(db, viewer)).map((m) => m.author.handle);
    expect(await who(PAREA_ACTOR_ID)).toEqual([PAREA_HANDLE]);
    expect(await who(me)).toEqual(['me']);
  });

  it('is nobody’s mutual friend', async () => {
    const me = await person('me');
    const them = await person('them');
    await befriend(db, me, PAREA_ACTOR_ID);
    await befriend(db, them, PAREA_ACTOR_ID);

    expect(await suggestionsFor(db, me)).toEqual([]);
    const recommended = await recommendationsFor(db, me);
    expect(recommended.find((p) => p.actorId === them)).toBeUndefined();
  });

  it('does not add anybody to a chat without asking', () => {
    const route = stripComments(
      readFileSync(new URL('../app/api/groups/route.ts', import.meta.url), 'utf8'),
    );
    expect(route).toMatch(
      /const parea = actorId === PAREA_ACTOR_ID \|\| id === PAREA_ACTOR_ID;\s*if \(!parea && \(await areFriends\(db, actorId, id\)\)\) added\.push\(id\);/,
    );
  });
});

describe("Parea's rolls on everybody's home screen", () => {
  async function roll(accessPolicy: 'public' | 'private' = 'public') {
    const [row] = await db
      .insert(schema.events)
      .values({ name: 'Welcome', linkToken: newLinkToken(), createdBy: PAREA_ACTOR_ID, accessPolicy })
      .returning();
    return row!.id;
  }
  const listed = async (viewer: string) => (await eventsFor(db, viewer)).map((e) => e.id);

  it('lists the public ones to its friends, without making them members', async () => {
    const welcome = await roll();
    await roll('private');
    const me = await guest();
    await signIn(db, 'new@example.test', me);

    expect(await listed(me)).toEqual([welcome]);
    const [card] = await eventsFor(db, me);
    expect(card!.memberCount).toBe(0);
  });

  it('lists nothing to somebody who is not its friend', async () => {
    await roll();
    expect(await listed(await person('stranger'))).toEqual([]);
  });

  it('takes one off the list for good when somebody leaves it, until they open it again', async () => {
    const welcome = await roll();
    const me = await person('me');
    await befriend(db, me, PAREA_ACTOR_ID);

    expect(await leaveEvent(db, welcome, me)).toMatchObject({ left: true });
    expect(await listed(me)).toEqual([]);

    // Opening the link again is what being in a public roll is.
    await db.insert(schema.eventParticipants).values({ eventId: welcome, actorId: me });
    expect(await listed(me)).toEqual([welcome]);
  });
});
