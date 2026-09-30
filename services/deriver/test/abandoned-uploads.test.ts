/**
 * Uploads that never became photos are given up on, and their files removed.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sweepAbandoned } from '../src/jobs';
import type { ObjectStore } from '../src/objects';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "event", "photo", "safety_incident" restart identity cascade`);
});

function store(): ObjectStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async get() {
      return null;
    },
    async put() {},
    async delete(key: string) {
      deleted.push(key);
    },
    async reachable() {
      return { ok: true, detail: 'fake' };
    },
  };
}

const HOUR = 3600_000;
let eventId: string;
let uploaderId: string;

beforeEach(async () => {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  eventId = event.id;
  uploaderId = actor.id;
});

async function upload(key: string, status: string, hoursAgo: number, confirmed = false) {
  const [row] = await db
    .insert(schema.photos)
    .values({
      eventId,
      uploaderId,
      storageKey: key,
      byteSize: 10,
      mime: 'image/jpeg',
      status,
      uploadedAt: new Date(Date.now() - hoursAgo * HOUR),
      bytesAt: confirmed ? new Date(Date.now() - hoursAgo * HOUR) : null,
    })
    .returning();
  return row.id as string;
}

const row = async (id: string) =>
  (await db.select().from(schema.photos).where(sql`id = ${id}`))[0];

describe('sweeping abandoned uploads', () => {
  it('gives up on an upload that never arrived, and removes its file', async () => {
    const id = await upload('up/never-sent', 'pending', 25);
    const objects = store();
    expect(await sweepAbandoned(db, objects)).toBe(1);
    expect(objects.deleted).toEqual(['up/never-sent']);
    // Tombstoned, so it stops counting against the album's cap.
    expect((await row(id)).deletedAt).not.toBeNull();
  });

  it('leaves an upload still inside its day alone', async () => {
    await upload('up/just-now', 'pending', 2);
    expect(await sweepAbandoned(db, store())).toBe(0);
  });

  it('never touches an upload that arrived and is waiting to be processed', async () => {
    // A scanner outage or the deriver being down: a real photo in a queue.
    const id = await upload('up/arrived', 'pending', 72, true);
    const objects = store();
    expect(await sweepAbandoned(db, objects)).toBe(0);
    expect(objects.deleted).toEqual([]);
    expect((await row(id)).deletedAt).toBeNull();
  });

  it('removes a failure after a week, and not before', async () => {
    await upload('up/failed-recently', 'failed', 24);
    const old = await upload('up/failed-long-ago', 'failed', 8 * 24);
    const objects = store();
    expect(await sweepAbandoned(db, objects)).toBe(1);
    expect(objects.deleted).toEqual(['up/failed-long-ago']);
    expect((await row(old)).deletedAt).not.toBeNull();
  });

  it('leaves anything under a child-safety hold exactly where it is', async () => {
    const held = await upload('up/held', 'failed', 30 * 24);
    await db.insert(schema.safetyIncidents).values({
      photoId: held,
      eventId,
      uploaderActorId: uploaderId,
      provider: 'test',
      classification: 'A1',
      storageKey: 'preserved/photo/x',
    });
    const objects = store();
    expect(await sweepAbandoned(db, objects)).toBe(0);
    expect(objects.deleted).toEqual([]);
  });

  it('does not touch a photo that was published', async () => {
    await upload('ev/ready', 'ready', 30 * 24, true);
    expect(await sweepAbandoned(db, store())).toBe(0);
  });
});
