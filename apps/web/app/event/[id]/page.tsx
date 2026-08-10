import { schema } from '@parea/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { EventView } from '@/../app/components/EventView';
import { decide, findEventById } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const dynamic = 'force-dynamic';

/**
 * The event page. Reached after `/e/<token>` has exchanged the link for a
 * capability cookie, so no secret is in this URL.
 *
 * Rendered server-side with the first page of photos already in it: the grid
 * is the whole point of arriving, and making it wait on a client fetch would
 * put a spinner in front of the one thing people came for.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) notFound();

  const requester = await requesterFor(id);
  const decision = await decide(db, event, 'view', requester);
  // No distinction between "no such event" and "not yours" — the page must not
  // become a way to test whether an event id is real.
  if (!decision.allow) notFound();

  const rows = await db
    .select()
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, event.id),
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`),
    );

  const storage = getStorage();
  const viewerId = await currentActorId();

  const photos = await Promise.all(
    rows.map(async (photo) => ({
      id: photo.id,
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
      mine: viewerId != null && photo.uploaderId === viewerId,
      src: await storage.presignGet(photo.storageKey, 3600),
    })),
  );

  return (
    <EventView
      eventId={event.id}
      initial={{
        event: { id: event.id, name: event.name, uploadsOpen: event.uploadsOpen },
        contributors: new Set(rows.map((p) => p.uploaderId)).size,
        count: photos.length,
        photos,
      }}
    />
  );
}
