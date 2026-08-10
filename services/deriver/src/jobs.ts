#!/usr/bin/env tsx
/**
 * Scheduled jobs — docs/design.md §15.
 *
 * Lives in the deriver's container because it needs exactly the same things —
 * a database connection and object storage — and a second service to run four
 * cron queries would be ceremony. Split it out when it earns that.
 *
 *   auto-hide   hide photos whose removal request has gone 48 hours unanswered
 *   purge       hard-delete objects for rows tombstoned past the grace window
 *   codes       return codes for dormant events to the pool
 *
 * `expire-events` from the design is deliberately absent: the retention lever
 * is populated but switched off in v1, and a job that silently deletes
 * people's photos should not exist until someone decides it should run.
 */

import { schema } from '@parea/core';
import { and, eq, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { objectStoreFromEnv, type ObjectStore } from './objects';

/** How long a tombstoned photo's bytes survive before they are really gone. */
const PURGE_GRACE_DAYS = 30;
/** Dormancy before a spoken code returns to the pool. */
const CODE_DORMANCY_DAYS = 90;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { prepare: false }), { schema });
}

/**
 * Hide photos whose removal request nobody answered.
 *
 * Hidden, not deleted — the host can still decline and bring the photo back.
 * The report stays `open`, because the host has not actually decided anything;
 * the deadline passing is not a decision.
 */
export async function autoHide(database: ReturnType<typeof db>): Promise<number> {
  const due = await database
    .select({ id: schema.reports.id, photoId: schema.reports.photoId })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.kind, 'removal_request'),
        eq(schema.reports.status, 'open'),
        isNotNull(schema.reports.autoHideAt),
        lte(schema.reports.autoHideAt, new Date()),
      ),
    );

  let hidden = 0;
  for (const report of due) {
    const updated = await database
      .update(schema.photos)
      .set({ hiddenAt: new Date() })
      .where(and(eq(schema.photos.id, report.photoId), isNull(schema.photos.hiddenAt)))
      .returning({ id: schema.photos.id });
    hidden += updated.length;
  }
  return hidden;
}

/**
 * Hard-delete objects for photos tombstoned longer than the grace window.
 *
 * Objects first, then the row. The other order would orphan bytes in storage
 * with nothing left pointing at them — invisible, unbilled to any event, and
 * impossible to find again.
 */
export async function purge(
  database: ReturnType<typeof db>,
  objects: ObjectStore,
): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 3600_000);
  const rows = await database
    .select({ id: schema.photos.id, storageKey: schema.photos.storageKey })
    .from(schema.photos)
    .where(and(isNotNull(schema.photos.deletedAt), lt(schema.photos.deletedAt, cutoff)))
    .limit(500);

  let purged = 0;
  for (const row of rows) {
    for (const key of [
      row.storageKey,
      `${row.storageKey}.thumb.jpg`,
      `${row.storageKey}.grid.jpg`,
      `${row.storageKey}.full.jpg`,
    ]) {
      await objects.delete(key).catch(() => {});
    }
    await database.delete(schema.photos).where(eq(schema.photos.id, row.id));
    purged++;
  }
  return purged;
}

/** Codes only stay short if they recycle, and late arrivals only work if they recycle slowly. */
export async function recycleCodes(
  database: ReturnType<typeof db>,
): Promise<number> {
  const cutoff = new Date(Date.now() - CODE_DORMANCY_DAYS * 24 * 3600_000);
  const released = await database.execute<{ id: string }>(sql`
    update "code" set event_id = null, released_at = now()
    where event_id in (
      select id from "event"
      where last_active_at < ${cutoff} or deleted_at is not null
    )
    returning id
  `);
  return released.length;
}

async function main(): Promise<void> {
  const database = db();
  const objects = objectStoreFromEnv();
  const only = process.argv[2];

  const run = async (name: string, fn: () => Promise<number>) => {
    if (only && only !== name) return;
    const count = await fn();
    console.log(`${name}: ${count}`);
  };

  await run('auto-hide', () => autoHide(database));
  await run('purge', () => purge(database, objects));
  await run('recycle-codes', () => recycleCodes(database));
  process.exit(0);
}

if (process.argv[1]?.endsWith('jobs.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
