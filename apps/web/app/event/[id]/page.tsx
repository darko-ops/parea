import { schema, visiblePhotos } from '@parea/core';
import { asc, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { EventView } from '@/../app/components/EventView';
import { decide, findEventById } from '@/access';
import { getDb } from '@/db';
import { findGroup } from '@/groups';
import { hasDerivatives, imageSrc } from '@/images';
import { viewerContext } from '@/moderation';
import { currentActorId, requesterFor } from '@/session';

export const dynamic = 'force-dynamic';

/**
 * Belt and braces with the `X-Robots-Tag` header in `next.config.ts`. The
 * header is the one that covers non-HTML responses and survives a crawler
 * finding the URL elsewhere; this one survives the headers not being applied,
 * which is a deployment property rather than a code one.
 */
export const metadata = { robots: { index: false, follow: false } };


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
    // One shared predicate for deleted / removed / hidden / blocked — see
    // @parea/core's visibility module for why those are four states.
    .where(visiblePhotos(event.id, await viewerContext(db, await currentActorId())))
    .orderBy(
      asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`),
    );

  const viewerId = await currentActorId();

  const photos = await Promise.all(
    rows.map(async (photo) => ({
      id: photo.id,
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
      mine: viewerId != null && photo.uploaderId === viewerId,
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      full: await imageSrc(photo, hasDerivatives(photo) ? 'full' : 'orig', event.capEpoch),
    })),
  );

  return (
    <EventView
      eventId={event.id}
      initial={{
        event: {
          id: event.id,
          name: event.name,
          uploadsOpen: event.uploadsOpen,
          canAdminister: (await decide(db, event, 'administer', requester)).allow,
          groupId: event.groupId,
          groupName: event.groupId
            ? ((await findGroup(db, event.groupId))?.name ?? null)
            : null,
        },
        contributors: new Set(rows.map((p) => p.uploaderId)).size,
        count: photos.length,
        photos,
      }}
    />
  );
}
