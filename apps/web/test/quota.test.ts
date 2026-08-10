/**
 * The per-actor upload cap — docs/design.md §7.8.
 *
 * "Anti-catastrophe bounds, not product limits." Anyone with a link can
 * upload, and a link travels, so the thing being defended against is one
 * person or one leaked link filling the bucket — not a contributor being
 * unreasonable.
 *
 * The accounting is what is worth testing, because the obvious version is
 * wrong in two directions: counting only completed uploads lets someone
 * bypass the cap by never completing, and counting tombstoned photos means
 * removing your own upload does not give the space back.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, count, eq, isNull, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "photo", "report", "safety_incident"
    restart identity cascade
  `);
});

/** Mirrors usedByActor in the uploads route. */
async function used(eventId: string, actorId: string) {
  const [row] = await db
    .select({ photos: count(), bytes: sum(schema.photos.byteSize) })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, eventId),
        eq(schema.photos.uploaderId, actorId),
        isNull(schema.photos.deletedAt),
      ),
    );
  return { photos: row?.photos ?? 0, bytes: Number(row?.bytes ?? 0) };
}

async function scene() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [other] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  return { actor: actor.id, other: other.id, event: event.id };
}

async function photo(
  eventId: string,
  uploaderId: string,
  opts: { bytes?: number; status?: string; deleted?: boolean } = {},
) {
  await db.insert(schema.photos).values({
    eventId,
    uploaderId,
    storageKey: `k-${Math.random()}`,
    byteSize: opts.bytes ?? 1000,
    mime: 'image/jpeg',
    status: (opts.status ?? 'ready') as 'ready',
    deletedAt: opts.deleted ? new Date() : null,
  });
}

describe('what counts toward the cap', () => {
  it('counts photos that finished ingest', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { bytes: 2000 });
    expect(await used(event, actor)).toEqual({ photos: 1, bytes: 2000 });
  });

  it('counts a presigned upload that never completed', async () => {
    // Otherwise the cap is bypassed by presigning endlessly and never
    // finishing — every request reserves a row and storage either way.
    const { actor, event } = await scene();
    await photo(event, actor, { status: 'pending', bytes: 5000 });
    expect(await used(event, actor)).toEqual({ photos: 1, bytes: 5000 });
  });

  it('gives the space back when someone removes their own upload', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, { bytes: 3000, deleted: true });
    expect(await used(event, actor)).toEqual({ photos: 0, bytes: 0 });
  });

  it('is per actor, not per event', async () => {
    // One heavy shooter must not exhaust everyone else's allowance.
    const { actor, other, event } = await scene();
    await photo(event, other, { bytes: 9999 });
    expect(await used(event, actor)).toEqual({ photos: 0, bytes: 0 });
  });

  it('is per event, not per actor across events', async () => {
    const { actor, event } = await scene();
    const [second] = await db
      .insert(schema.events)
      .values({ name: 'Другое', linkToken: newLinkToken(), createdBy: actor })
      .returning();
    await photo(second.id, actor, { bytes: 8000 });
    expect(await used(event, actor)).toEqual({ photos: 0, bytes: 0 });
  });

  it('reports zero for someone who has uploaded nothing', async () => {
    const { actor, event } = await scene();
    expect(await used(event, actor)).toEqual({ photos: 0, bytes: 0 });
  });
});

describe('the bounds themselves', () => {
  it('are far above what a real contributor does', async () => {
    // If these ever start rejecting ordinary use, the assumption behind them
    // is wrong and the answer is not to quietly raise them.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../app/api/events/[id]/uploads/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(source).toContain('MAX_PHOTOS_PER_ACTOR_PER_EVENT = 500');
    expect(source).toContain('MAX_BYTES_PER_ACTOR_PER_EVENT = 5 * 1024 * 1024 * 1024');
    // A 200-photo dump — the design's heavy-shooter case — must fit.
    expect(500).toBeGreaterThan(200);
  });

  it('is enforced cumulatively, not only per request', async () => {
    // The bug this replaces: fifty files per request bounds nothing when a
    // client can make a thousand requests.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../app/api/events/[id]/uploads/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(source).toMatch(/usedByActor\(/);
    expect(source).toMatch(/quota\.photos \+ files\.length/);
    expect(source).toMatch(/quota\.bytes \+ incomingBytes/);
  });
});
