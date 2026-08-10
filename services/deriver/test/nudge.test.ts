/**
 * The one reminder — docs/design.md §12.
 *
 * The concept is emphatic that this is *one* well-timed reminder and not
 * notification spam, so most of what is worth testing is restraint: that it
 * happens once, that it never happens twice, and that it does not go to people
 * who have already done the thing it would be reminding them about.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { nudge } from '../src/jobs';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);
const LONG_ENOUGH_AGO = new Date(Date.now() - 30 * 3600_000);

let db: any;
let sent: { to: string; body: string }[] = [];

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  sent = [];
  // Stand in for Expo. Every message the job decides to send lands here.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { to: string; body: string }[];
      sent.push(...batch);
      return new Response(JSON.stringify({ data: batch.map(() => ({ status: 'ok' })) }), {
        status: 200,
      });
    }),
  );
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "photo", "report", "safety_incident"
    restart identity cascade
  `);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function actorWithDevice(token: string) {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  await db
    .insert(schema.devices)
    .values({ actorId: actor.id, platform: 'ios', pushToken: token });
  return actor.id;
}

async function event(createdBy: string, createdAt = LONG_ENOUGH_AGO) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, createdAt })
    .returning();
  return row;
}

async function joins(eventId: string, actorId: string) {
  await db.insert(schema.eventParticipants).values({ eventId, actorId });
}

async function uploads(eventId: string, actorId: string) {
  await db.insert(schema.photos).values({
    eventId,
    uploaderId: actorId,
    storageKey: `k-${actorId}`,
    byteSize: 1,
    mime: 'image/jpeg',
    status: 'ready',
  });
}

describe('who gets it', () => {
  it('reminds someone who joined and added nothing', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const guest = await actorWithDevice('ExponentPushToken[guest]');
    const e = await event(host);
    await joins(e.id, guest);
    await uploads(e.id, host);

    await nudge(db);
    expect(sent.map((m) => m.to)).toEqual(['ExponentPushToken[guest]']);
    expect(sent[0]!.body).toMatch(/1 photos? are waiting|1 photos/);
  });

  it('does not remind someone who already contributed', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);
    await uploads(e.id, host);

    await nudge(db);
    expect(sent).toHaveLength(0);
  });

  it('does remind the creator who never added theirs', async () => {
    // The commonest way an event ends up empty is the person who made it
    // forgetting to add their own photos.
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);

    await nudge(db);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatch(/Nobody has added/);
  });

  it('ignores a removed photo when deciding who contributed', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);
    await uploads(e.id, host);
    await db
      .update(schema.photos)
      .set({ status: 'removed', deletedAt: new Date() })
      .where(eq(schema.photos.uploaderId, host));

    await nudge(db);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing to someone with no device', async () => {
    const [host] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const e = await event(host.id);
    await joins(e.id, host.id);

    await expect(nudge(db)).resolves.toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('once, ever', () => {
  it('does not send twice', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);

    await nudge(db);
    await nudge(db);
    expect(sent).toHaveLength(1);
  });

  it('stamps the event even when nobody was eligible', async () => {
    // Otherwise the event is reconsidered forever, and whoever becomes
    // eligible weeks later gets reminded about a party from three weeks ago.
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);
    await uploads(e.id, host);

    await nudge(db);
    const [row] = await db.select().from(schema.events).where(eq(schema.events.id, e.id));
    expect(row.nudgedAt).not.toBeNull();
  });
});

describe('timing', () => {
  it('waits — a reminder during the party is not a reminder', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host, new Date(Date.now() - 2 * 3600_000));
    await joins(e.id, host);

    await nudge(db);
    expect(sent).toHaveLength(0);
  });

  it('gives up on an event that is long over', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host, new Date(Date.now() - 30 * 24 * 3600_000));
    await joins(e.id, host);

    await nudge(db);
    expect(sent).toHaveLength(0);
  });

  it('leaves a deleted event alone', async () => {
    const host = await actorWithDevice('ExponentPushToken[host]');
    const e = await event(host);
    await joins(e.id, host);
    await db
      .update(schema.events)
      .set({ deletedAt: new Date() })
      .where(eq(schema.events.id, e.id));

    await nudge(db);
    expect(sent).toHaveLength(0);
  });
});

describe('device hygiene', () => {
  it('forgets a token the push service says is dead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const batch = JSON.parse(String(init?.body)) as { to: string }[];
        return new Response(
          JSON.stringify({
            data: batch.map(() => ({
              status: 'error',
              details: { error: 'DeviceNotRegistered' },
            })),
          }),
          { status: 200 },
        );
      }),
    );

    const host = await actorWithDevice('ExponentPushToken[gone]');
    const e = await event(host);
    await joins(e.id, host);

    await nudge(db);
    expect(await db.select().from(schema.devices)).toHaveLength(0);
  });
});
