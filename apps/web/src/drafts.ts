/**
 * Drafts: your own photographs in a roll that are not in it yet.
 *
 * An upload used to have two ends, live or gone. A photo whose file never
 * arrived sat invisible for a day and was then swept away, and whoever had
 * added it saw it vanish — on another device at once, and on the same one
 * after a reload or a day. So a photo row that is not `ready` is now a draft:
 * shown to the person who added it, on their own view of the roll and nobody
 * else's, with what happened and what to do about it.
 *
 * `bytesAt` is what says whether the server holds the file. It is set when an
 * upload is confirmed (or found in storage without having been), and cleared
 * when a failed photo's file is removed after a week — after which the only
 * way on is to choose the photo again.
 *
 * Never listed: a quarantined photo (its own status), and anything hidden
 * pending a decision. Neither is a draft, and saying either exists would say
 * something about it.
 */

import { schema } from '@parea/core';
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';

import type { Db } from './db';

/** A grant is good for fifteen minutes; after that, an upload with no file has stopped. */
export const SENDING_GRACE_MS = 15 * 60 * 1000;

export type DraftState =
  /** Granted moments ago; the device is (probably) still sending it. */
  | 'sending'
  /** The file is here and is being processed. */
  | 'processing'
  /** Processing failed; the file is still here, so the server can try again. */
  | 'failed'
  /** The file never arrived, or is gone: it has to be chosen again. */
  | 'needs_file';

type Row = Pick<typeof schema.photos.$inferSelect, 'status' | 'bytesAt' | 'uploadedAt'>;

export function draftState(row: Row, now = Date.now()): DraftState {
  if (row.status === 'pending') {
    if (row.bytesAt) return 'processing';
    return now - row.uploadedAt.getTime() < SENDING_GRACE_MS ? 'sending' : 'needs_file';
  }
  return row.bytesAt ? 'failed' : 'needs_file';
}

/** Mine, in this roll, not live, not hidden. */
function draftsOf(eventId: string, actorId: string): SQL {
  return and(
    eq(schema.photos.eventId, eventId),
    eq(schema.photos.uploaderId, actorId),
    inArray(schema.photos.status, ['pending', 'failed']),
    isNull(schema.photos.deletedAt),
    isNull(schema.photos.hiddenAt),
  )!;
}

export type Draft = {
  id: string;
  state: DraftState;
  mime: string;
  size: number;
  addedAt: string;
  capturedAt: string | null;
  /** Why processing failed, in the deriver's words, when it did. */
  reason: string | null;
};

export async function listDrafts(db: Db, eventId: string, actorId: string, now = Date.now()): Promise<Draft[]> {
  const rows = await db
    .select({
      id: schema.photos.id,
      status: schema.photos.status,
      bytesAt: schema.photos.bytesAt,
      uploadedAt: schema.photos.uploadedAt,
      mime: schema.photos.mime,
      byteSize: schema.photos.byteSize,
      capturedAt: schema.photos.capturedAt,
      failureReason: schema.photos.failureReason,
    })
    .from(schema.photos)
    .where(draftsOf(eventId, actorId))
    .orderBy(desc(schema.photos.uploadedAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    state: draftState(r, now),
    mime: r.mime,
    size: r.byteSize,
    addedAt: r.uploadedAt.toISOString(),
    capturedAt: r.capturedAt?.toISOString() ?? null,
    reason: r.status === 'failed' ? r.failureReason : null,
  }));
}

/**
 * Drafts a new upload may take over rather than adding a row of its own.
 *
 * Asked for by id — a queue retrying its own photograph, which used to leave
 * an empty row behind at every attempt — or found by type and size when the
 * same photograph is chosen again. Only drafts with no file qualify: one whose
 * file is here is finished by the server, not by sending it twice.
 *
 * Returns, for each file in order, the draft id it takes over, or null.
 */
export async function claimDrafts(
  db: Db,
  eventId: string,
  actorId: string,
  files: { size: number; type: string; draftId?: string }[],
  now = Date.now(),
): Promise<(string | null)[]> {
  const open = await db
    .select({
      id: schema.photos.id,
      status: schema.photos.status,
      bytesAt: schema.photos.bytesAt,
      uploadedAt: schema.photos.uploadedAt,
      mime: schema.photos.mime,
      byteSize: schema.photos.byteSize,
    })
    .from(schema.photos)
    .where(and(draftsOf(eventId, actorId), isNull(schema.photos.bytesAt)))
    .orderBy(desc(schema.photos.uploadedAt))
    .limit(1000);

  const byId = new Map(open.map((d) => [d.id, d]));
  const taken = new Set<string>();
  // Asked-for ids first, so a guess never takes the draft somebody named.
  const out: (string | null)[] = files.map((f) => {
    const d = f.draftId ? byId.get(f.draftId) : undefined;
    if (!d || taken.has(d.id)) return null;
    taken.add(d.id);
    return d.id;
  });
  files.forEach((f, i) => {
    if (out[i] || f.draftId) return;
    // Only a draft that has stopped: one still sending is a different upload
    // of a photograph the same size, not this one.
    const match = open.find(
      (d) =>
        !taken.has(d.id) &&
        d.byteSize === f.size &&
        d.mime === f.type &&
        draftState(d, now) === 'needs_file',
    );
    if (match) {
      taken.add(match.id);
      out[i] = match.id;
    }
  });
  return out;
}

/** The rows that count against an album's caps: everything not tombstoned, less drafts with no file. */
export function countsTowardCap(): SQL {
  return and(
    isNull(schema.photos.deletedAt),
    or(
      inArray(schema.photos.status, ['pending', 'ready', 'removed', 'quarantined']),
      // A failed photo whose file is still here still costs its bytes.
      and(eq(schema.photos.status, 'failed'), isNotNull(schema.photos.bytesAt)),
    ),
  )!;
}
