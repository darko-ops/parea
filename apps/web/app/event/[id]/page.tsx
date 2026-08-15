import { schema, visiblePhotos } from '@parea/core';
import { and, asc, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { EventView } from '@/../app/components/EventView';
import { decide, findEventById } from '@/access';
import { contributorKey, contributorsOf } from '@/contributors';
import { getDb } from '@/db';
import { messagesFor } from '@/messages';
import { findGroup } from '@/groups';
import { membersOf } from '@/members';
import { hasDerivatives, imageSrc } from '@/images';
import { viewerContext } from '@/moderation';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';
import { Shell } from '@/../app/components/Shell';

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
      by: photo.uploaderId ? contributorKey(event.id, photo.uploaderId) : null,
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      full: await imageSrc(photo, hasDerivatives(photo) ? 'full' : 'orig', event.capEpoch),
    })),
  );

  const people = await contributorsOf(db, event.id, rows, viewerId);

  // Seeded server-side for the same reason the grid is: the thread is part of
  // arriving at an event, and making it wait on a client fetch puts a spinner
  // where a conversation goes.
  const messages = await messagesFor(db, event.id, viewerId, (id) =>
    contributorKey(event.id, id),
  );

  // Uploaded and not through the deriver yet. Not in `rows` by definition —
  // `visiblePhotos` returns what can be looked at, and these cannot be yet.
  const [pending] = await db
    .select({ n: countDistinct(schema.photos.id) })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, event.id),
        eq(schema.photos.status, 'pending'),
        isNull(schema.photos.deletedAt),
      ),
    );


  /*
   * The share details, for everybody who can already see the event.
   *
   * A widening, and worth being explicit about: until now the link lived on
   * the manage page, so only the creator and a group admin could pass it on.
   * Participation deliberately is not a credential — somebody who opened a
   * link once and lost it could not let anybody else in — and handing the link
   * to every viewer means anybody who can see the event can now invite. That is
   * what "everybody else sees the share info" asks for, and `joins_open` is
   * still the switch that decides whether a link admits anyone at all.
   */
  const [spoken] = await db
    .select({ words: schema.codes.words })
    .from(schema.codes)
    .where(and(eq(schema.codes.eventId, event.id), isNull(schema.codes.releasedAt)));

  /*
   * People waiting on this host, for the badge on the settings menu.
   *
   * Only computed for somebody who can actually answer them — for everybody
   * else it is zero, not because the number is secret but because a count of
   * decisions you cannot make is a notification about somebody else's job.
   */
  const canAdminister = (await decide(db, event, 'administer', requester)).allow;
  const [waitingRow] = canAdminister
    ? await db
        .select({ n: countDistinct(schema.eventAccessRequests.id) })
        .from(schema.eventAccessRequests)
        .where(
          and(
            eq(schema.eventAccessRequests.eventId, event.id),
            eq(schema.eventAccessRequests.status, 'open'),
          ),
        )
    : [{ n: 0 }];

  return (
    <Shell>
      <EventView
        eventId={event.id}
        initial={{
          event: {
            id: event.id,
            name: event.name,
            uploadsOpen: event.uploadsOpen,
            canAdminister,
      waiting: waitingRow?.n ?? 0,
            groupId: event.groupId,
            groupName: event.groupId
              ? ((await findGroup(db, event.groupId))?.name ?? null)
              : null,
            caption: event.caption,
      startsAt: event.startsAt?.toISOString() ?? null,
            linkToken: event.linkToken,
            code: spoken?.words ?? null,
            // Both here and in `/api/events/[id]/photos`, because this page
            // renders the first frame and that route replaces it — a field
            // present in one and not the other is a panel that changes what it
            // claims a second after it opens.
            accessPolicy: event.accessPolicy,
            joinsOpen: event.joinsOpen,
          },
          contributors: people.length,
          people,
          // Both frames carry it, for the reason the access fields do: a field
          // in one and not the other is a head that changes a second after it
          // draws.
          members: await membersOf(db, event.id),
          messages,
          // `contribute` and an account, matching what the POST actually enforces.
    // Computed from the same helper rather than from `viewerId != null`, which
    // is true for a guest — the composer would have been drawn for somebody the
    // server was always going to refuse.
    canPost:
      (await decide(db, event, 'contribute', requester)).allow &&
      (await currentAccountActorId()) != null,
          arriving: pending?.n ?? 0,
          count: photos.length,
          photos,
        }}
      />
    </Shell>
  );
}
