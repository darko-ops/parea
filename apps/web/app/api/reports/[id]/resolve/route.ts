/**
 * The host answering a removal request — docs/design.md §13.
 *
 * Two outcomes. `remove` takes the photo down for good; `decline` clears the
 * request and un-hides the photo if the 48-hour deadline had already passed.
 * That second half is why hiding and deleting are separate states: a host who
 * was on holiday can still say no, and the photo comes back.
 */

import { recordModeration, REASON, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { getStorage } from '@/storage';
import { notifyRemovalAnswered } from '@/notify';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === 'remove' ? 'remove' : body.action === 'decline' ? 'decline' : null;
  if (!action) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const db = getDb();
  const [found] = await db
    .select({ report: schema.reports, photo: schema.photos })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    .where(eq(schema.reports.id, id))
    .limit(1);

  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, found.photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = await currentActorId();
  const now = new Date();

  if (action === 'remove') {
    await db
      .update(schema.photos)
      .set({ status: 'removed', deletedAt: now })
      .where(eq(schema.photos.id, found.photo.id));

    await dropDerivatives(db, found.photo.id);
  } else {
    // Declining also lifts an auto-hide that already took effect.
    await db
      .update(schema.photos)
      .set({ hiddenAt: null })
      .where(eq(schema.photos.id, found.photo.id));
  }

  await recordModeration(db, {
    photoId: found.photo.id,
    eventId: found.photo.eventId,
    action: action === 'remove' ? 'removed' : 'unhidden',
    actorId,
    reason: action === 'remove' ? REASON.hostRemoved : REASON.hostDeclined,
  });

  await db
    .update(schema.reports)
    .set({
      status: action === 'remove' ? 'actioned' : 'declined',
      resolvedAt: now,
      resolvedBy: actorId,
    })
    .where(eq(schema.reports.id, id));

  // The person who asked may have no account and no reason to come back, so
  // this is the only way they learn the answer.
  await notifyRemovalAnswered(db, {
    reporterActorId: found.report.reporterActorId,
    eventId: found.photo.eventId,
    removed: action === 'remove',
  });

  return NextResponse.json({ resolved: action });
}

/**
 * Take the renditions out of storage, now rather than on the purge job's clock.
 *
 * The image Worker holds no database and decides nothing: it verifies a
 * signature and streams. Its only revocation signal is the event's epoch
 * marker, so a photograph removed here keeps serving on any URL already minted
 * for it until that URL's hour bucket expires — up to two hours. For an
 * ordinary removal that is a defensible trade and the design says so.
 *
 * This is not an ordinary removal. Somebody asked for their photograph to come
 * down and a host agreed; "it will stop appearing within two hours" is a poor
 * answer to that, and the fix is cheap because a missing object is an immediate
 * 404 from the Worker with no epoch involved.
 *
 * ## Only here, and only the derivatives
 *
 * Not on the uploader's own delete, which is soft on purpose so an accidental
 * removal is recoverable. Not on the 48-hour auto-hide, which is *reversible*
 * — a host who was away can still decline and the photograph comes back, and
 * deleting its renditions would turn that into a re-derive. Not on an ingest
 * quarantine, which never builds derivatives at all. This is the one path that
 * is both terminal and requested by a person.
 *
 * The original stays. `photo.storage_key` is what an abuse investigation reads
 * and what the purge job removes on its own schedule; the derivatives are what
 * a viewer sees, and they are the whole of what is being revoked.
 *
 * The rows stay too. Nothing lists a `removed` photograph — `visiblePhotos`
 * excludes it four ways over — so a row pointing at an absent object is
 * unreachable rather than wrong, and the purge job tidies both together.
 *
 * Failure is swallowed deliberately. The row is already `removed` and the
 * photograph is already out of every listing; a storage blip must not turn a
 * host's decision into a 500 and leave the report unresolved.
 *
 * Exported only so it can be tested. Reaching the route itself means staging
 * an `administer` credential, and what is worth pinning here is the storage
 * effect — which keys go, which stay — not the authorization, which `guard`
 * above already owns and `access-chokepoint.test.ts` already enforces.
 */
export async function dropDerivatives(db: ReturnType<typeof getDb>, photoId: string) {
  const rows = await db
    .select({ storageKey: schema.derivatives.storageKey })
    .from(schema.derivatives)
    .where(eq(schema.derivatives.photoId, photoId))
    .catch(() => [] as { storageKey: string }[]);

  const storage = getStorage();
  await Promise.all(
    rows.map((row) =>
      storage.delete(row.storageKey).catch((err) => {
        console.error(`removal: could not delete ${row.storageKey}: ${err}`);
      }),
    ),
  );
}
