/**
 * Uploads that did not go through — see `upload_failure` in the schema.
 *
 * Two doors in. `parseReports` takes what a client's upload queue says went
 * wrong (`/api/uploads/failures`); `recordServerFailure` is for what the
 * server sees for itself. Both keep to short text: an error message is a
 * diagnosis, and anything longer than this is a stack trace or somebody
 * writing into a table.
 */

import { schema } from '@parea/core';

import type { Db } from '@/db';

/** Per report, so one request cannot stand for a whole hour's queue. */
export const MAX_REPORTS = 50;

const STAGES = new Set(['presign', 'put', 'complete']);
const CLIENTS = new Set(['web', 'ios', 'android']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : null;
}

export type UploadFailureRow = typeof schema.uploadFailures.$inferInsert;

/**
 * A client's reports as rows, dropping any that do not say what failed.
 *
 * The photo and album ids are recorded as claimed rather than checked: this is
 * a diagnosis somebody's own browser sent about itself, readable by staff
 * alone, and it reaches no other row. What it can do is fill this table, which
 * the rate limit and `MAX_REPORTS` bound.
 */
export function parseReports(
  body: unknown,
  actorId: string,
  userAgent: string | null,
): UploadFailureRow[] {
  const list = (body as { failures?: unknown } | null)?.failures;
  if (!Array.isArray(list)) return [];
  const client = text((body as { client?: unknown }).client, 16);

  const rows: UploadFailureRow[] = [];
  for (const raw of list.slice(0, MAX_REPORTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const stage = text(r.stage, 16);
    const error = text(r.error, 500);
    if (!stage || !STAGES.has(stage) || !error) continue;
    rows.push({
      actorId,
      eventId: uuid(r.eventId),
      photoId: uuid(r.photoId),
      source: 'client',
      stage,
      kind: text(r.kind, 40),
      error,
      cause: text(r.cause, 500),
      attempts: count(r.attempts),
      status: text(r.status, 16),
      client: client && CLIENTS.has(client) ? client : null,
      userAgent: text(userAgent, 300),
      mime: text(r.mime, 60),
      byteSize: count(r.size),
    });
  }
  return rows;
}

/** What the server saw go wrong with an upload. Never fails the caller. */
export async function recordServerFailure(
  db: Db,
  row: Omit<UploadFailureRow, 'source'>,
): Promise<void> {
  try {
    await db.insert(schema.uploadFailures).values({ ...row, source: 'server' });
  } catch (err) {
    console.error(`could not record an upload failure: ${err}`);
  }
}
