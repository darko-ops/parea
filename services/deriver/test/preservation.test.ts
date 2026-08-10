/**
 * The purge job must not run over preserved evidence.
 *
 * This is the interaction most likely to break silently. A quarantined photo
 * is soft-deleted like any other removed photo, so without an explicit
 * exemption the ordinary 30-day cleanup destroys material subject to a
 * statutory preservation duty — and the job reports success while doing it.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, PRESERVATION_DAYS, preservationHold, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { purge } from '../src/jobs';
import type { ObjectStore } from '../src/objects';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);
const LONG_AGO = new Date(Date.now() - 60 * 24 * 3600_000);

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_member", "groups", "photo",
      "report", "safety_incident"
    restart identity cascade
  `);
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
  };
}

async function tombstonedPhoto() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  const [photo] = await db
    .insert(schema.photos)
    .values({
      eventId: event.id,
      uploaderId: actor.id,
      storageKey: `ev/${event.id}/abc`,
      byteSize: 1,
      mime: 'image/jpeg',
      status: 'removed',
      deletedAt: LONG_AGO,
    })
    .returning();
  return { actor, event, photo };
}

async function incident(
  photo: any,
  event: any,
  actor: any,
  fields: Partial<typeof schema.safetyIncidents.$inferInsert> = {},
) {
  await db.insert(schema.safetyIncidents).values({
    photoId: photo.id,
    eventId: event.id,
    uploaderActorId: actor.id,
    provider: 'test',
    classification: 'A1',
    storageKey: photo.storageKey,
    ...fields,
  });
}

describe('purge', () => {
  it('deletes an ordinary tombstoned photo', async () => {
    const { photo } = await tombstonedPhoto();
    const objects = store();
    expect(await purge(db, objects)).toBe(1);
    expect(objects.deleted).toContain(photo.storageKey);
    expect(await db.select().from(schema.photos)).toHaveLength(0);
  });

  it('leaves evidence alone while the hold is open-ended', async () => {
    // Nothing filed yet, so the clock has not started. Open-ended is not
    // expired, and treating null as "no hold" is the bug this guards.
    const { photo, event, actor } = await tombstonedPhoto();
    await incident(photo, event, actor, { preservationEndsAt: null });

    const objects = store();
    expect(await purge(db, objects)).toBe(0);
    expect(objects.deleted).toEqual([]);
    expect(await db.select().from(schema.photos)).toHaveLength(1);
  });

  it('leaves evidence alone while a dated hold is still running', async () => {
    const { photo, event, actor } = await tombstonedPhoto();
    await incident(photo, event, actor, {
      reportedAt: new Date(),
      preservationEndsAt: preservationHold(new Date()),
    });

    const objects = store();
    expect(await purge(db, objects)).toBe(0);
  });

  it('purges once the hold has run out', async () => {
    const reportedAt = new Date(Date.now() - (PRESERVATION_DAYS + 5) * 24 * 3600_000);
    const { photo, event, actor } = await tombstonedPhoto();
    await incident(photo, event, actor, {
      reportedAt,
      preservationEndsAt: preservationHold(reportedAt),
    });

    expect(await purge(db, store())).toBe(1);
  });

  it('purges once a human has released the incident', async () => {
    // The false-positive path: a reviewer clears it, the hold lifts.
    const { photo, event, actor } = await tombstonedPhoto();
    await incident(photo, event, actor, {
      preservationEndsAt: null,
      releasedAt: new Date(),
    });

    expect(await purge(db, store())).toBe(1);
  });

  it('keeps the incident record after the photo row is gone', async () => {
    // The record has to outlive ordinary cleanup, or the history of a
    // reportable event disappears with routine housekeeping.
    const reportedAt = new Date(Date.now() - (PRESERVATION_DAYS + 5) * 24 * 3600_000);
    const { photo, event, actor } = await tombstonedPhoto();
    await incident(photo, event, actor, {
      reportedAt,
      preservationEndsAt: preservationHold(reportedAt),
      reportReference: 'NCMEC-12345',
    });

    await purge(db, store());

    const [survived] = await db.select().from(schema.safetyIncidents);
    expect(survived).toBeDefined();
    expect(survived.reportReference).toBe('NCMEC-12345');
    // The pointer goes, the record stays: everything a reviewer needs was
    // copied onto the incident at detection time.
    expect(survived.photoId).toBeNull();
    expect(survived.storageKey).toBe(photo.storageKey);
    expect(survived.eventId).toBe(event.id);
    expect(survived.uploaderActorId).toBe(actor.id);
  });
});

describe('preservation window', () => {
  it('is 90 days from the report, not from detection', () => {
    const reportedAt = new Date('2026-07-18T12:00:00Z');
    const until = preservationHold(reportedAt)!;
    expect(until.getTime() - reportedAt.getTime()).toBe(
      PRESERVATION_DAYS * 24 * 3600_000,
    );
  });

  it('has no end before anything is filed', () => {
    expect(preservationHold(null)).toBeNull();
  });
});
