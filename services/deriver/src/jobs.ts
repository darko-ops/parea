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

import { codeWordPairs, schema } from '@parea/core';
import { sendAll, toMessage } from '@parea/push';
import { allDerivativeKeysFor } from '@parea/urls';
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
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
 *
 * Skips anything under a preservation hold. This is the interaction most
 * likely to go wrong quietly: a photo quarantined by child-safety scanning is
 * also soft-deleted, so without this clause the ordinary 30-day cleanup would
 * destroy evidence the law requires be kept for 90 days after a report — and
 * it would look exactly like the job working correctly.
 *
 * A hold with no end date is open-ended, not expired: nothing has been filed,
 * so the clock has not started.
 */
export async function purge(
  database: ReturnType<typeof db>,
  objects: ObjectStore,
): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 3600_000);
  const rows = await database
    .select({ id: schema.photos.id, storageKey: schema.photos.storageKey })
    .from(schema.photos)
    .where(
      and(
        isNotNull(schema.photos.deletedAt),
        lt(schema.photos.deletedAt, cutoff),
        notExists(
          database
            .select({ one: sql`1` })
            .from(schema.safetyIncidents)
            .where(
              and(
                eq(schema.safetyIncidents.photoId, schema.photos.id),
                isNull(schema.safetyIncidents.releasedAt),
                or(
                  isNull(schema.safetyIncidents.preservationEndsAt),
                  sql`${schema.safetyIncidents.preservationEndsAt} > now()`,
                ),
              ),
            ),
        ),
      ),
    )
    .limit(500);

  let purged = 0;
  for (const row of rows) {
    // Derived from the same table the deriver writes from, not a list kept in
    // step by hand: this was three hardcoded `.jpg` keys, and the day AVIF
    // arrived it started leaving two objects per purged photo in the bucket
    // forever. A purge that misses is a storage bill nobody can explain.
    for (const key of [row.storageKey, ...allDerivativeKeysFor(row.storageKey)]) {
      await objects.delete(key).catch(() => {});
    }
    await database.delete(schema.photos).where(eq(schema.photos.id, row.id));
    purged++;
  }
  return purged;
}

/**
 * Drops rate-limit counters whose window has closed.
 *
 * Nothing depends on this for correctness — a stale row is reset in place the
 * next time that source appears. It exists so the table does not accumulate a
 * row per address seen since launch, which for a link that travels is a lot of
 * rows holding nothing anyone wants.
 *
 * The window is hardcoded rather than read from the limits: this job runs in
 * the deriver, the limits live in the web app, and a cutoff an hour past the
 * longest of them is right whatever they are tuned to. Being wrong here costs
 * some rows staying a while longer.
 */
export async function expireRateLimits(
  database: ReturnType<typeof db>,
): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 3600_000);
  const removed = await database
    .delete(schema.rateLimits)
    .where(lt(schema.rateLimits.windowStart, cutoff))
    .returning({ bucket: schema.rateLimits.bucket });
  return removed.length;
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

/**
 * Fill the spoken-code pool.
 *
 * Idempotent, so it is safe to run on every deploy — which is how the pool
 * grows when the wordlist does. Without this the pool is empty, event creation
 * silently gets no code, and one of the three documented ways into an event
 * never works at all.
 */
export async function seedCodes(
  database: ReturnType<typeof db>,
): Promise<number> {
  const pairs = [...codeWordPairs()].map((words) => ({ words }));
  let inserted = 0;
  // Chunked: a single insert of ~18k rows is a needlessly large statement.
  for (let at = 0; at < pairs.length; at += 1000) {
    const rows = await database
      .insert(schema.codes)
      .values(pairs.slice(at, at + 1000))
      .onConflictDoNothing()
      .returning({ id: schema.codes.id });
    inserted += rows.length;
  }
  return inserted;
}

/**
 * How long after an event is created before its one reminder goes out.
 *
 * A guess, and design §17 lists it as an open question. Twenty hours means an
 * evening event is nudged the following afternoon, which is late enough that
 * people have got home and early enough that they still remember. The right
 * answer comes from real events, not from reasoning.
 */
const NUDGE_AFTER_HOURS = 20;
/** Past this an event is over and a reminder is just noise. */
const NUDGE_GIVE_UP_DAYS = 7;

/**
 * The one reminder — docs/design.md §12.
 *
 * Sent to people who joined an event and have not added anything. Once per
 * event, ever: `nudged_at` is stamped whether or not anybody was eligible,
 * because otherwise an event with no eligible recipients is reconsidered on
 * every run forever, and the day someone finally becomes eligible they get a
 * reminder about a party from three weeks ago.
 *
 * The cap lives in the schema rather than in this function so it cannot be
 * lost to a change here.
 */
export async function nudge(database: ReturnType<typeof db>): Promise<number> {
  const now = Date.now();
  const due = await database
    .select({
      id: schema.events.id,
      name: schema.events.name,
      createdBy: schema.events.createdBy,
    })
    .from(schema.events)
    .where(
      and(
        isNull(schema.events.nudgedAt),
        isNull(schema.events.deletedAt),
        lte(schema.events.createdAt, new Date(now - NUDGE_AFTER_HOURS * 3600_000)),
        gt(schema.events.createdAt, new Date(now - NUDGE_GIVE_UP_DAYS * 24 * 3600_000)),
      ),
    )
    .limit(200);

  let notified = 0;

  for (const event of due) {
    // Participants who have contributed nothing. The creator is included:
    // they may well have made the event and then forgotten to add theirs,
    // which is the single most common way an event ends up empty.
    const contributors = await database
      .selectDistinct({ actorId: schema.photos.uploaderId })
      .from(schema.photos)
      .where(
        and(
          eq(schema.photos.eventId, event.id),
          eq(schema.photos.status, 'ready'),
          isNull(schema.photos.deletedAt),
        ),
      );
    const contributed = new Set(contributors.map((c) => c.actorId));

    const participants = await database
      .select({ actorId: schema.eventParticipants.actorId })
      .from(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, event.id));

    const targets = participants
      .map((p) => p.actorId)
      .filter((id) => !contributed.has(id));

    if (targets.length > 0) {
      const devices = await database
        .select({ token: schema.devices.pushToken })
        .from(schema.devices)
        .where(
          and(
            inArray(schema.devices.actorId, targets),
            isNotNull(schema.devices.pushToken),
          ),
        );

      const tokens = [...new Set(devices.map((d) => d.token!).filter(Boolean))];
      if (tokens.length > 0) {
        const [photos] = await database
          .select({ n: count() })
          .from(schema.photos)
          .where(
            and(
              eq(schema.photos.eventId, event.id),
              eq(schema.photos.status, 'ready'),
              isNull(schema.photos.deletedAt),
            ),
          );

        const result = await sendAll(
          tokens.map((token) =>
            toMessage(token, {
              kind: 'nudge',
              eventId: event.id,
              eventName: event.name,
              photoCount: photos?.n ?? 0,
            }),
          ),
        );
        notified += result.sent;

        if (result.unregistered.length > 0) {
          await database
            .delete(schema.devices)
            .where(inArray(schema.devices.pushToken, result.unregistered));
        }
      }
    }

    // Stamped regardless — see the note above.
    await database
      .update(schema.events)
      .set({ nudgedAt: new Date() })
      .where(eq(schema.events.id, event.id));
  }

  return notified;
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

  await run('seed-codes', () => seedCodes(database));
  await run('auto-hide', () => autoHide(database));
  await run('nudge', () => nudge(database));
  await run('purge', () => purge(database, objects));
  await run('recycle-codes', () => recycleCodes(database));
  await run('expire-rate-limits', () => expireRateLimits(database));
  process.exit(0);
}

if (process.argv[1]?.endsWith('jobs.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
