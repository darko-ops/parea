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
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { askedToJoin, invitedEvents } from '@/invites';

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
