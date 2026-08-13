/**
 * What lands in each of the two tabs.
 *
 * Both lists are defined by what they leave out, which is the kind of rule
 * that looks right in a screenshot and is wrong in a way nobody notices: an
 * "invited" list that quietly includes your own events is just Events with a
 * different heading, and a "waiting" list that keeps showing approved requests
 * tells someone to keep waiting for something they already have.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { askedToJoin, invitedEvents, invitesWaiting, markInvitesSeen } from '@/invites';

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
    truncate "account", "actor", "event", "event_participant",
      "event_access_request", "groups", "group_member", "photo"
    restart identity cascade
  `);
});

async function actor() {
  const [row] = await db.insert(schema.actors).values({ kind: 'user' }).returning();
  return row!.id;
}

async function event(createdBy: string, overrides = {}) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, ...overrides })
    .returning();
  return row!;
}

async function join(eventId: string, actorId: string) {
  await db.insert(schema.eventParticipants).values({ eventId, actorId });
}

describe('events you were invited to', () => {
  it('is other people’s events, not yours', async () => {
    const me = await actor();
    const host = await actor();

    const mine = await event(me);
    const theirs = await event(host, { name: 'Their party' });
    await join(mine.id, me);
    await join(theirs.id, me);

    const invited = await invitedEvents(db, me);
    expect(invited.map((e) => e.name)).toEqual(['Their party']);
  });

  it('leaves out events you cannot reach at all', async () => {
    const me = await actor();
    const host = await actor();
    const stranger = await event(host, { name: 'Not mine to see' });
    await join(stranger.id, host);

    expect(await invitedEvents(db, me)).toEqual([]);
  });

  it('says nothing to someone with no actor', async () => {
    // The rail links here for everyone, including a browser that has never
    // been anywhere. An empty list is the answer, not a crash.
    expect(await invitedEvents(db, null)).toEqual([]);
  });
});

describe('events you asked to join', () => {
  const ask = async (eventId: string, actorId: string, status = 'open') =>
    db.insert(schema.eventAccessRequests).values({ eventId, actorId, status } as never);

  it('lists the ones still waiting', async () => {
    const me = await actor();
    const host = await actor();
    const wanted = await event(host, { name: 'Wanted', accessPolicy: 'request_access' });
    await ask(wanted.id, me);

    const asked = await askedToJoin(db, me);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ name: 'Wanted', status: 'open' });
  });

  it('keeps a no rather than dropping it', async () => {
    // A request that vanished would read as one that was never sent, and the
    // honest answer to "did they see it?" is yes.
    const me = await actor();
    const host = await actor();
    const refused = await event(host, { accessPolicy: 'request_access' });
    await ask(refused.id, me, 'declined');

    expect((await askedToJoin(db, me))[0]).toMatchObject({ status: 'declined' });
  });

  it('drops one once it is approved', async () => {
    // Approval makes you a participant, so the event is in the other tab and
    // in Events. Keeping it here as well is a second copy of one fact.
    const me = await actor();
    const host = await actor();
    const opened = await event(host, { accessPolicy: 'request_access' });
    await ask(opened.id, me, 'approved');

    expect(await askedToJoin(db, me)).toEqual([]);
  });

  it('drops one whose event was deleted', async () => {
    const me = await actor();
    const host = await actor();
    const gone = await event(host, {
      accessPolicy: 'request_access',
      deletedAt: new Date(),
    });
    await ask(gone.id, me);

    expect(await askedToJoin(db, me)).toEqual([]);
  });

  it('is somebody else’s business, not yours', async () => {
    const me = await actor();
    const other = await actor();
    const host = await actor();
    const wanted = await event(host, { accessPolicy: 'request_access' });
    await ask(wanted.id, other);

    expect(await askedToJoin(db, me)).toEqual([]);
  });
});

describe('the number beside Invites', () => {
  const seen = (actorId: string, at: Date | null) =>
    db.update(schema.actors).set({ invitesSeenAt: at }).where(eq(schema.actors.id, actorId));

  it('counts an event you were let into since you last looked', async () => {
    const me = await actor();
    const host = await actor();
    await seen(me, new Date(Date.now() - 60_000));

    const theirs = await event(host);
    await join(theirs.id, me);

    expect(await invitesWaiting(db, me)).toBe(1);
  });

  it('does not count your own events', async () => {
    // Otherwise making an event badges the page that exists to show you other
    // people's, which is the opposite of what the number claims.
    const me = await actor();
    await seen(me, new Date(Date.now() - 60_000));
    const mine = await event(me);
    await join(mine.id, me);

    expect(await invitesWaiting(db, me)).toBe(0);
  });

  it('counts a request that was turned down', async () => {
    const me = await actor();
    const host = await actor();
    await seen(me, new Date(Date.now() - 60_000));
    const refused = await event(host, { accessPolicy: 'request_access' });
    await db.insert(schema.eventAccessRequests).values({
      eventId: refused.id,
      actorId: me,
      status: 'declined',
      resolvedAt: new Date(),
    } as never);

    expect(await invitesWaiting(db, me)).toBe(1);
  });

  it('counts an approval once, not twice', async () => {
    /*
     * Approving writes the participant row, so an approved request is already
     * the first kind. Counting the resolved request as well would show 2 for
     * one thing happening — which is the bug this arrangement exists to avoid,
     * and the reason only *declined* requests are counted separately.
     */
    const me = await actor();
    const host = await actor();
    await seen(me, new Date(Date.now() - 60_000));
    const opened = await event(host, { accessPolicy: 'request_access' });
    await join(opened.id, me);
    await db.insert(schema.eventAccessRequests).values({
      eventId: opened.id,
      actorId: me,
      status: 'approved',
      resolvedAt: new Date(),
    } as never);

    expect(await invitesWaiting(db, me)).toBe(1);
  });

  it('counts everything for somebody who has never looked', async () => {
    // `> null` is null in SQL, so a naive comparison counts nothing — which
    // would hide an invitation that arrived before this column existed.
    const me = await actor();
    const host = await actor();
    await seen(me, null);
    const theirs = await event(host);
    await join(theirs.id, me);

    expect(await invitesWaiting(db, me)).toBe(1);
  });

  it('goes to nothing once they look', async () => {
    const me = await actor();
    const host = await actor();
    const theirs = await event(host);
    await join(theirs.id, me);
    expect(await invitesWaiting(db, me)).toBe(1);

    await markInvitesSeen(db, me);
    expect(await invitesWaiting(db, me)).toBe(0);
  });

  it('is zero for a browser that has never been anywhere', async () => {
    expect(await invitesWaiting(db, null)).toBe(0);
  });
});
