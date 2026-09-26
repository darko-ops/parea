/**
 * What the tray is allowed to claim — `/api/invites`, run for real.
 *
 * This route is the whole of what the web rail's badge and the app's tray
 * know, and it used to answer one number: how many things are waiting on an
 * *answer*. Invitations, friend requests, somebody standing at the door of an
 * event you run.
 *
 * Almost nothing this product sends a notification about is one of those.
 * Somebody commented on your photograph; somebody said you are in one;
 * somebody added thirty to an album you were at. All of it lands in Lately and
 * none of it was answerable, so the count stayed at zero and the tray drew
 * nothing — a push arrived, the banner went, and there was no mark anywhere in
 * either client pointing at the thing that had happened. On the phone that was
 * the whole of the complaint: notifications came in and the app showed no sign
 * of it.
 *
 * So there is a second field, and it is a boolean rather than a count. The
 * tests below are about the three ways that boolean can be wrong: silent when
 * something happened, loud when nothing did, and still loud after somebody has
 * looked.
 *
 * Run against the handler and a real database rather than asserted from the
 * source, for the reason `groups-route.test.ts` gives: a field that is missing
 * is invisible to a source check, and a missing field is exactly this bug.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
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
const { markInvitesSeen } = await import('@/invites');
const { GET } = await import('../app/api/invites/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "actor", "event", "event_participant", "event_invite",
      "event_access_request", "event_message", "photo", "photo_tag",
      "friend_request", "hidden_activity"
    restart identity cascade
  `);
  headerBag.clear();
});

async function person(handle: string) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle })
    .returning();
  return row!.id;
}

async function album(createdBy: string, name = 'Party') {
  const [row] = await db
    .insert(schema.events)
    .values({ name, linkToken: newLinkToken(), createdBy })
    .returning();
  return row!;
}

/** The app's way in: a signed actor id as a bearer token. */
async function badge(actorId: string) {
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
  const response = await GET();
  expect(response.status).toBe(200);
  return (await response.json()) as { waiting: number; unread: boolean };
}

/**
 * Somebody's album, with one of my photographs in it.
 *
 * Set up separately from the remark below, and that separation is the point.
 * Being let into an event *is* on the answerable half — `invitesWaiting`
 * counts it, and says in its own comment that it does — so an album joined in
 * the same breath as the remark would make `waiting` 1 and hide the thing
 * these tests are about. Join, look, then have something happen.
 */
async function joinWithMyPhoto(me: string, them: string, joinedAt?: Date) {
  const made = await album(them);
  await db.insert(schema.eventParticipants).values({
    eventId: made.id,
    actorId: me,
    ...(joinedAt ? { firstSeenAt: joinedAt } : {}),
  } as never);
  const [photo] = await db
    .insert(schema.photos)
    .values({
      eventId: made.id,
      uploaderId: me,
      storageKey: `k${made.id}`,
      byteSize: 1024,
      mime: 'image/jpeg',
      status: 'ready',
    } as never)
    .returning();
  return { event: made, photoId: photo!.id };
}

/**
 * A remark under a photograph somebody added — the commonest thing in this
 * product that sends a notification and can never be answered.
 *
 * Timed explicitly where the test is about the boundary. Both a feed row's `at`
 * and the boundary it is compared against are rendered to the millisecond, so
 * "mark seen, then say something" written at full speed lands both inside one
 * millisecond and compares equal — a test that would be asserting the clock's
 * resolution rather than the rule.
 */
async function remarkOn(photoId: string, eventId: string, them: string, at?: Date) {
  await db.insert(schema.eventMessages).values({
    eventId,
    authorActorId: them,
    photoId,
    body: 'this one is the best photo I have ever taken of anybody',
    ...(at ? { createdAt: at } : {}),
  } as never);
}

const ago = (ms: number) => new Date(Date.now() - ms);
const MINUTE = 60_000;

/** The boundary, put somewhere definite. `markInvitesSeen` puts it at `now`. */
async function looked(me: string, when: Date) {
  const { eq } = await import('drizzle-orm');
  await db
    .update(schema.actors)
    .set({ invitesSeenAt: when })
    .where(eq(schema.actors.id, me));
}

/** Joined, looked, and nothing outstanding — the state these tests start from. */
async function settled(me: string, them: string) {
  const joined = await joinWithMyPhoto(me, them);
  await markInvitesSeen(db, me);
  expect(await badge(me)).toEqual({ waiting: 0, unread: false });
  return joined;
}

describe('a browser that has never been anywhere', () => {
  it('is told nothing rather than refused', async () => {
    // The rail renders for everyone, and "you have nothing waiting" is the
    // true answer for somebody with no actor at all.
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ waiting: 0, unread: false });
  });

  it('draws nothing for an actor with an empty life', async () => {
    const me = await person('me');
    expect(await badge(me)).toEqual({ waiting: 0, unread: false });
  });
});

describe('news that cannot be answered', () => {
  it('raises the dot, which is what the tray was missing', async () => {
    /*
     * The bug, stated as a test. Before `unread` existed this answered
     * `{ waiting: 0 }` and both clients drew a bare tray — so the one thing
     * that had actually happened to this person was reachable only by opening
     * Lately on the off-chance.
     */
    const me = await person('me');
    const them = await person('them');
    const joined = await settled(me, them);

    await remarkOn(joined.photoId, joined.event.id, them);
    expect(await badge(me)).toEqual({ waiting: 0, unread: true });
  });

  it('says nothing about volume', async () => {
    // Three remarks and one remark are the same instruction: go and look. A
    // number here would be a measure of how much there is rather than of
    // whether there is any, and a number that only goes down when you look is
    // a number that stops meaning anything.
    const me = await person('me');
    const them = await person('them');
    const joined = await settled(me, them);

    await remarkOn(joined.photoId, joined.event.id, them);
    await remarkOn(joined.photoId, joined.event.id, them);
    expect(await badge(me)).toEqual({ waiting: 0, unread: true });
  });

  it('goes out once somebody has looked', async () => {
    /*
     * Looking is what clears it, and the boundary is the same single
     * timestamp the page and `/api/activity` move — `invites_seen_at`. A dot
     * that survived a look would be the badge training people to ignore it,
     * which is the failure every rule in this area exists to avoid.
     */
    const me = await person('me');
    const them = await person('them');
    const joined = await settled(me, them);
    await remarkOn(joined.photoId, joined.event.id, them);
    expect((await badge(me)).unread).toBe(true);

    await markInvitesSeen(db, me);
    expect(await badge(me)).toEqual({ waiting: 0, unread: false });
  });

  it('comes back for something that happened after the look', async () => {
    /*
     * The boundary, from both sides, with the times far enough apart to be
     * about the rule rather than about how fast a test can write two rows.
     */
    const me = await person('me');
    const them = await person('them');
    // Joined an hour ago, so being let in is on the far side of the boundary
    // too — that is itself a line in the feed, and one this test is not about.
    const joined = await joinWithMyPhoto(me, them, ago(60 * MINUTE));

    await remarkOn(joined.photoId, joined.event.id, them, ago(20 * MINUTE));
    await looked(me, ago(10 * MINUTE));
    expect((await badge(me)).unread).toBe(false);

    await remarkOn(joined.photoId, joined.event.id, them, ago(MINUTE));
    expect((await badge(me)).unread).toBe(true);
  });

  it('is not raised by Parea saying hello', async () => {
    /*
     * The welcome is the one row in that feed nobody did — it is there so an
     * empty page has something to be. A dot is a claim that something
     * happened, so a brand-new account with nothing in it draws a bare tray
     * rather than one that promises news and opens onto a greeting.
     */
    const me = await person('me');
    const { items } = await import('@/activity').then(async (m) => ({
      items: await m.activityFor(db, me),
    }));
    expect(items.map((i) => i.kind)).toEqual(['welcome']);
    expect((await badge(me)).unread).toBe(false);
  });
});

describe('things waiting on an answer', () => {
  it('are still counted, because each one is a job', async () => {
    // Four invitations is a different afternoon from one, which is why this
    // half stays a number.
    const me = await person('me');
    const host = await person('host');
    for (const name of ['One', 'Two']) {
      const made = await album(host, name);
      await db.insert(schema.eventInvites).values({
        eventId: made.id,
        actorId: me,
        invitedByActorId: host,
        status: 'open',
      } as never);
    }

    expect((await badge(me)).waiting).toBe(2);
  });

  it('do not clear merely by being looked at', async () => {
    /*
     * The asymmetry between the two halves, and it is deliberate. News stops
     * being news once read; an unanswered question does not — it is still
     * unanswered afterwards, and a count that cleared would be the product
     * forgetting something it asked you.
     */
    const me = await person('me');
    const host = await person('host');
    const made = await album(host);
    await db.insert(schema.eventInvites).values({
      eventId: made.id,
      actorId: me,
      invitedByActorId: host,
      status: 'open',
    } as never);

    await markInvitesSeen(db, me);
    expect((await badge(me)).waiting).toBe(1);
  });
});
