import { ago } from '@parea/cards';
import { schema, visiblePhotos } from '@parea/core';
import { and, asc, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { EventView } from '@/../app/components/EventView';
import { decide, findEventById } from '@/access';
import { contributorKey, contributorsOf } from '@/contributors';
import { getDb } from '@/db';
import { messagesFor } from '@/messages';
import { findGroup } from '@/groups';
import { membersOf, rosterFor } from '@/members';
import type { EventTab } from '@/../app/components/EventView';
import { hasDerivatives, imageSources, imageSrc, imageSrcSet, photosWithCard } from '@/images';
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?tab=conversation|people`. Photos is the bare URL. */
  searchParams: Promise<{ tab?: string }>;
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

  // Asked once for the page rather than per row — see `photosWithCard`.
  const hasCard = await photosWithCard(db, rows.map((row) => row.id));

  const photos = await Promise.all(
    rows.map(async (photo) => ({
      id: photo.id,
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
      /*
       * The shape of the picture, so the gallery can lay it out without
       * waiting to measure it. A masonry that measures after load reflows
       * under the reader's hand as each photograph arrives; one that knows
       * the ratios up front draws the final layout on the first paint.
       *
       * Null for anything the deriver has not read yet, which the client
       * treats as 3:2 — a guess that is right often enough and wrong by a
       * few pixels of column height when it is not.
       */
      width: photo.width,
      height: photo.height,
      mine: viewerId != null && photo.uploaderId === viewerId,
      by: photo.uploaderId ? contributorKey(event.id, photo.uploaderId) : null,
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      /*
       * Two sizes, so the browser can pick one that matches the slot.
       *
       * `src` stays the 320 for anything that ignores `srcset`, and for a
       * photograph still mid-ingest, which has no derivatives to choose
       * between.
       */
      srcSet: await imageSrcSet(photo, event.capEpoch, 'jpeg', hasCard.has(photo.id)),
      srcSetAvif: await imageSrcSet(photo, event.capEpoch, 'avif', hasCard.has(photo.id)),
      /*
       * Present here as well as in the route that replaces this frame.
       *
       * It was missing, so the first paint of every album offered no AVIF at
       * all and only gained it if something happened to re-poll the feed —
       * which only happens while an upload is running. A field in one frame
       * and not the other is exactly what the notes on `accessPolicy` and
       * `added` warn about, and this one cost bytes on every photograph.
       */
      sources: await imageSources(photo, 'thumb', event.capEpoch),
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
        tab={tabOf((await searchParams).tab)}
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
            place: event.place,
            // Both frames again: a field in one and not the other is a head
            // that changes a second after it draws.
            added: ago(event.lastActiveAt, new Date()),
          },
          contributors: people.length,
          people,
          // Both frames carry it, for the reason the access fields do: a field
          // in one and not the other is a head that changes a second after it
          // draws.
          members: await membersOf(db, event.id),
          // The People tab's fuller answer: everybody in it with what they
          // have put in, plus whoever was asked and has not arrived.
          roster: await rosterFor(db, event.id, photoCounts(rows)),
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

/**
 * Whose photographs these are, counted once.
 *
 * By actor id rather than by the per-event contributor key: the roster is a
 * list of people the viewer can already see in the Members list, so it is
 * keyed by who they are. The key exists for the *photo* feed, where an
 * uploader id must not cross the boundary — see `contributors.ts`.
 */
function photoCounts(rows: { uploaderId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.uploaderId) continue;
    counts.set(row.uploaderId, (counts.get(row.uploaderId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which pane, from the query string.
 *
 * Anything unrecognised is Photos rather than a 404: a tab name is not a
 * credential, and a stale link from before a rename should land somebody on
 * the album rather than on an error.
 */
function tabOf(value: string | undefined): EventTab {
  return value === 'conversation' || value === 'people' ? value : 'photos';
}
