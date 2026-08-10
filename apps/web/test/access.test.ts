/**
 * The access layer against a real database.
 *
 * @parea/core's policy tests cover the decision logic exhaustively with facts
 * handed in. This covers the other half — that the facts resolved from
 * Postgres are the right ones — which is where an authorization bug would
 * actually live: correct rules, wrong inputs.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AccessError,
  decide,
  findEventByLinkToken,
  guard,
  recordParticipant,
  toResponse,
} from '@/access';
import { sign, unsign, encodeCapability, decodeCapability } from '@/auth/cookies';
import type { Db } from '@/db';

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
    truncate "account", "actor", "code", "derivative", "device", "event",
      "event_participant", "group_member", "groups", "photo", "report"
    restart identity cascade
  `);
});

async function makeActor() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return actor!.id;
}

async function makeEvent(overrides: Partial<typeof schema.events.$inferInsert> = {}) {
  const createdBy = overrides.createdBy ?? (await makeActor());
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, ...overrides })
    .returning();
  return event!;
}

describe('resolving credentials from the database', () => {
  it('admits a stranger holding the link', async () => {
    const event = await makeEvent();
    const decision = await decide(db, event, 'view', {
      actorId: null,
      linkToken: event.linkToken,
    });
    expect(decision).toEqual({ allow: true });
  });

  it('refuses the same stranger without it', async () => {
    const event = await makeEvent();
    const decision = await decide(db, event, 'view', { actorId: null });
    expect(decision).toEqual({ allow: false, reason: 'no_credential' });
  });

  it('finds an event by link token and not by a near miss', async () => {
    const event = await makeEvent();
    expect(await findEventByLinkToken(db, event.linkToken)).toBeTruthy();
    expect(await findEventByLinkToken(db, newLinkToken())).toBeNull();
  });

  it('reads participation from event_participant, so joins_open is enforceable', async () => {
    const event = await makeEvent({ joinsOpen: false });
    const actorId = await makeActor();

    // Not yet in: the link no longer admits them.
    expect(await decide(db, event, 'view', { actorId, linkToken: event.linkToken }))
      .toEqual({ allow: false, reason: 'joins_closed' });

    await recordParticipant(db, event.id, actorId);

    // Already in: unaffected by the switch.
    expect(await decide(db, event, 'view', { actorId, capEpoch: event.capEpoch }))
      .toEqual({ allow: true });
  });

  it('recording a participant twice is not an error', async () => {
    const event = await makeEvent();
    const actorId = await makeActor();
    await recordParticipant(db, event.id, actorId);
    await expect(recordParticipant(db, event.id, actorId)).resolves.toBeUndefined();
  });

  it('reads group membership and distinguishes admins', async () => {
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'House', slug: 'house' })
      .returning();
    const event = await makeEvent({ groupId: group!.id });
    const member = await makeActor();
    const admin = await makeActor();
    await db.insert(schema.groupMembers).values([
      { groupId: group!.id, actorId: member!, role: 'member' },
      { groupId: group!.id, actorId: admin!, role: 'admin' },
    ]);

    expect(await decide(db, event, 'view', { actorId: member })).toEqual({ allow: true });
    expect(await decide(db, event, 'administer', { actorId: member })).toEqual({
      allow: false,
      reason: 'not_administrator',
    });
    expect(await decide(db, event, 'administer', { actorId: admin })).toEqual({
      allow: true,
    });
  });

  it('matches a spoken code against the one the event actually holds', async () => {
    const event = await makeEvent();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: event.id, claimedAt: new Date() });

    expect(await decide(db, event, 'contribute', { actorId: null, code: 'amber-fox' }))
      .toEqual({ allow: true });
    expect(await decide(db, event, 'contribute', { actorId: null, code: 'silver-otter' }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('a code claimed by another event does not open this one', async () => {
    const mine = await makeEvent();
    const theirs = await makeEvent();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: theirs.id, claimedAt: new Date() });

    expect(await decide(db, mine, 'view', { actorId: null, code: 'amber-fox' }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('rotating the link locks out stored capabilities but not the new link', async () => {
    const event = await makeEvent();
    const actorId = await makeActor();
    await recordParticipant(db, event.id, actorId);

    const rotated = newLinkToken();
    const [after] = await db
      .update(schema.events)
      .set({ linkToken: rotated, capEpoch: event.capEpoch + 1 })
      .where(eq(schema.events.id, event.id))
      .returning();

    expect(await decide(db, after!, 'view', { actorId, capEpoch: event.capEpoch }))
      .toEqual({ allow: false, reason: 'stale_capability' });
    expect(await decide(db, after!, 'view', { actorId, linkToken: rotated }))
      .toEqual({ allow: true });
    expect(await decide(db, after!, 'view', { actorId, linkToken: event.linkToken }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('a soft-deleted event is gone even for its creator', async () => {
    const creator = await makeActor();
    const event = await makeEvent({ createdBy: creator, deletedAt: new Date() });
    expect(await decide(db, event, 'view', { actorId: creator })).toEqual({
      allow: false,
      reason: 'event_deleted',
    });
  });
});

describe('guard', () => {
  it('throws rather than returning a value a handler could forget to check', async () => {
    const event = await makeEvent();
    await expect(guard(db, event, 'view', { actorId: null })).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(
      guard(db, event, 'view', { actorId: null, linkToken: event.linkToken }),
    ).resolves.toBeUndefined();
  });

  it('does not leak why, to someone who never had access', async () => {
    const event = await makeEvent();
    try {
      await guard(db, event, 'view', { actorId: null });
      expect.unreachable();
    } catch (err) {
      const res = toResponse(err);
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: 'not_found' });
    }
  });

  it('does explain itself to someone who proved access', async () => {
    const event = await makeEvent({ uploadsOpen: false });
    try {
      await guard(db, event, 'contribute', {
        actorId: null,
        linkToken: event.linkToken,
      });
      expect.unreachable();
    } catch (err) {
      const res = toResponse(err);
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: 'uploads_closed' });
    }
  });

  it('rethrows anything that is not an access failure', () => {
    expect(() => toResponse(new TypeError('boom'))).toThrow(TypeError);
  });
});

describe('signed cookies', () => {
  it('round-trips a value', () => {
    expect(unsign(sign('actor-123'))).toBe('actor-123');
  });

  it('rejects a tampered payload', () => {
    const signed = sign('actor-123');
    expect(unsign(signed.replace('actor-123', 'actor-456'))).toBeNull();
  });

  it('rejects a tampered signature and a bare value', () => {
    expect(unsign(`${sign('a')}x`)).toBeNull();
    expect(unsign('actor-123')).toBeNull();
    expect(unsign(undefined)).toBeNull();
  });

  it('carries the epoch a capability was granted at', () => {
    const encoded = encodeCapability({ eventId: 'evt', capEpoch: 3 });
    expect(decodeCapability(encoded)).toEqual({ eventId: 'evt', capEpoch: 3 });
  });

  it('will not accept a capability with a forged epoch', () => {
    const encoded = encodeCapability({ eventId: 'evt', capEpoch: 1 });
    expect(decodeCapability(encoded.replace('evt:1', 'evt:2'))).toBeNull();
  });
});
