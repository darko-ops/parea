/**
 * Report a photo to us — docs/design.md §13.
 *
 * Deliberately not routed to the host: for abuse, the host may be the problem,
 * and a reporting channel that ends at the person you are reporting is not a
 * reporting channel. This lands in a queue a human reads.
 *
 * One kind does not wait for that human. `child_safety` quarantines the photo
 * on receipt, opens a safety incident and wakes a responder — see
 * docs/csam-runbook.md. The asymmetry is the point: being slow about suspected
 * child sexual abuse material is categorically worse than being wrong about
 * it, and being wrong is undone by a reviewer releasing the hold.
 *
 * Every other kind leaves the photo up. A report is not a verdict, and a
 * channel that hid on sight would hand any guest a way to empty an album one
 * report at a time — which is a censorship tool wearing a safety label.
 *
 * No SLA is promised in the response, because none can currently be kept.
 */

import { alertResponder, recordModeration, REASON, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const KINDS = new Set(['abuse', 'other', 'child_safety']);

/** The kinds that act before a human looks. One, for now. */
const QUARANTINES_ON_RECEIPT = new Set(['child_safety']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    note?: unknown;
  };
  const kind =
    typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'abuse';

  const db = getDb();
  const found = await findPhotoWithEvent(db, id);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(found.event.id);
  try {
    await guard(db, found.event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;
  const reporter = await currentActorId();
  await db.insert(schema.reports).values({
    photoId: id,
    reporterActorId: reporter,
    kind: kind as 'abuse' | 'other' | 'child_safety',
    note,
  });

  if (QUARANTINES_ON_RECEIPT.has(kind)) {
    await quarantineOnReport(db, found.photo, found.event.id, reporter);
  }

  // The same answer either way. A reporter learning that this particular kind
  // did something immediate is a reporter who can probe which photos are
  // already quarantined, and it tells the person who uploaded it that they
  // have been noticed.
  return NextResponse.json({ reported: true });
}

/**
 * Hide it now, record why, wake someone.
 *
 * `quarantined` is the same terminal state the ingest scanner uses, and every
 * surface gates on `ready`, so this removes the photo from listings, downloads,
 * thumbnails and any signed URL in one move. The object itself is left exactly
 * where it is: the runbook's preservation rules need the original, and the
 * purge job already skips anything under an open hold.
 */
async function quarantineOnReport(
  db: ReturnType<typeof getDb>,
  photo: typeof schema.photos.$inferSelect,
  eventId: string,
  reporterActorId: string | null,
): Promise<void> {
  await db
    .update(schema.photos)
    .set({ status: 'quarantined', hiddenAt: new Date() })
    .where(eq(schema.photos.id, photo.id));

  const [incident] = await db
    .insert(schema.safetyIncidents)
    .values({
      photoId: photo.id,
      eventId,
      uploaderActorId: photo.uploaderId,
      // Named so an incident says how it was found. A person reporting is not
      // a hash match, and a reviewer reading this months later needs to know
      // which of the two they are looking at before deciding anything.
      provider: 'user_report',
      classification: 'reported_child_safety',
      providerReference: null,
      storageKey: photo.storageKey,
      contentHash: photo.contentHash,
      // Open-ended until someone files: the purge job skips a null hold.
      preservationEndsAt: null,
    })
    .returning();

  await recordModeration(db, {
    photoId: photo.id,
    eventId,
    action: 'quarantined',
    // The reporter, not the uploader: this row answers who caused the change.
    actorId: reporterActorId,
    reason: REASON.reportedChildSafety,
  });

  await alertResponder({
    incidentId: incident!.id,
    eventId,
    provider: 'user_report',
    classification: 'reported_child_safety',
  });
}
