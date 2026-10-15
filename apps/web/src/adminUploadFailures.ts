/**
 * Uploads that did not go through, for the hub — see `upload_failure`.
 *
 * Two answers. The list: newest first, each row with who and which roll, so
 * "my photos never showed up" can be looked up by handle. And the tally: the
 * same failures grouped by what went wrong, over a day and a week, so a
 * pattern — every iPhone, every HEIC, every PUT since a deploy — is one glance
 * rather than a scroll.
 *
 * Identifiers and words only, like the rest of the admin API: never a storage
 * key, and the table has no file names to give.
 */

import { schema } from '@parea/core';
import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';

import type { Db } from './db';

export const UPLOAD_FAILURE_PERIODS = [1, 7, 30] as const;
export type UploadFailurePeriod = (typeof UPLOAD_FAILURE_PERIODS)[number];

const LIST_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadFailures(
  db: Db,
  opts: { days: UploadFailurePeriod; person?: string },
  now = new Date(),
) {
  const since = new Date(now.getTime() - opts.days * 24 * 3600_000);
  const conditions: SQL[] = [gte(schema.uploadFailures.createdAt, since)];

  // A handle, with or without its @, or an actor id.
  const asked = opts.person?.trim().replace(/^@/, '');
  if (asked) {
    conditions.push(
      UUID.test(asked)
        ? eq(schema.uploadFailures.actorId, asked.toLowerCase())
        : sql`lower(${schema.actors.handle}) = ${asked.toLowerCase()}`,
    );
  }

  const failures = await db
    .select({
      id: schema.uploadFailures.id,
      at: schema.uploadFailures.createdAt,
      actorId: schema.uploadFailures.actorId,
      handle: schema.actors.handle,
      name: schema.actors.displayName,
      eventId: schema.uploadFailures.eventId,
      roll: schema.events.name,
      photoId: schema.uploadFailures.photoId,
      source: schema.uploadFailures.source,
      stage: schema.uploadFailures.stage,
      kind: schema.uploadFailures.kind,
      error: schema.uploadFailures.error,
      cause: schema.uploadFailures.cause,
      attempts: schema.uploadFailures.attempts,
      status: schema.uploadFailures.status,
      client: schema.uploadFailures.client,
      userAgent: schema.uploadFailures.userAgent,
      mime: schema.uploadFailures.mime,
      size: schema.uploadFailures.byteSize,
    })
    .from(schema.uploadFailures)
    .leftJoin(schema.actors, eq(schema.uploadFailures.actorId, schema.actors.id))
    .leftJoin(schema.events, eq(schema.uploadFailures.eventId, schema.events.id))
    .where(and(...conditions))
    .orderBy(desc(schema.uploadFailures.createdAt))
    .limit(LIST_LIMIT);

  // Grouped by what went wrong. The cause is left out on purpose: it carries
  // paths and ids that would make every row its own group.
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const groups = await db
    .select({
      source: schema.uploadFailures.source,
      stage: schema.uploadFailures.stage,
      error: schema.uploadFailures.error,
      client: schema.uploadFailures.client,
      count: sql<number>`count(*)::int`,
      lastDay: sql<number>`(count(*) filter (where ${schema.uploadFailures.createdAt} >= ${dayAgo.toISOString()}))::int`,
      people: sql<number>`count(distinct ${schema.uploadFailures.actorId})::int`,
      last: sql<string>`max(${schema.uploadFailures.createdAt})`,
    })
    .from(schema.uploadFailures)
    .leftJoin(schema.actors, eq(schema.uploadFailures.actorId, schema.actors.id))
    .where(and(...conditions))
    .groupBy(
      schema.uploadFailures.source,
      schema.uploadFailures.stage,
      schema.uploadFailures.error,
      schema.uploadFailures.client,
    )
    .orderBy(sql`count(*) desc`)
    .limit(50);

  const [totals] = await db
    .select({
      failures: sql<number>`count(*)::int`,
      people: sql<number>`count(distinct ${schema.uploadFailures.actorId})::int`,
      photos: sql<number>`count(distinct ${schema.uploadFailures.photoId})::int`,
    })
    .from(schema.uploadFailures)
    .leftJoin(schema.actors, eq(schema.uploadFailures.actorId, schema.actors.id))
    .where(and(...conditions));

  return {
    days: opts.days,
    person: asked || null,
    totals: totals ?? { failures: 0, people: 0, photos: 0 },
    groups: groups.map((g) => ({ ...g, last: new Date(g.last).toISOString() })),
    failures,
    truncated: failures.length === LIST_LIMIT,
  };
}
