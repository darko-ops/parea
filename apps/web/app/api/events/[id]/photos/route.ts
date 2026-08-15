/**
 * List an event's photos — screen 3 of design §3.
 *
 * Returns metadata plus a presigned URL per photo. The browser fetches image
 * bytes from storage directly; this handler never touches them.
 *
 * Sorted by `coalesce(captured_at, uploaded_at)`. Both halves of that are known
 * to be imperfect — six phones disagree about the time, and iOS Safari strips
 * EXIF on upload so web-contributed photos may have no capture time at all
 * (design §8). v1 accepts it.
 */

import { ago } from '@parea/cards';
import { schema, visiblePhotos } from '@parea/core';
import { and, asc, countDistinct, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, guard, toResponse } from '@/access';
import { contributorKey, contributorsOf } from '@/contributors';
import { getDb } from '@/db';
import { membersOf } from '@/members';
import { messagesFor } from '@/messages';
import { findGroup } from '@/groups';
import { hasDerivatives, imageSources, imageSrc } from '@/images';
import { viewerContext } from '@/moderation';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: url.searchParams.get('t') ?? undefined,
    code: url.searchParams.get('c') ?? undefined,
  });

  try {
    await guard(db, event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

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
      width: photo.width,
      height: photo.height,
      mime: photo.mime,
      byteSize: photo.byteSize,
      takenAt: (photo.capturedAt ?? photo.uploadedAt).toISOString(),
      // Surfaced so the client can offer "remove" only where it will work.
      mine: viewerId != null && photo.uploaderId === viewerId,
      // Which contributor chip this photo belongs to. A per-event digest, not
      // an actor id — see `contributors.ts`.
      by: photo.uploaderId ? contributorKey(event.id, photo.uploaderId) : null,
      // A 320px thumbnail rather than a multi-megabyte original: a 200-photo
      // grid of originals is ~800MB of pointless transfer.
      src: await imageSrc(photo, hasDerivatives(photo) ? 'thumb' : 'orig', event.capEpoch),
      // The same thumbnail in every encoding that exists, best first, so the
      // browser can take the AVIF if it can decode one (§11). Empty before
      // ingest, in which case `src` is the original and there is no choice.
      sources: await imageSources(photo, 'thumb', event.capEpoch),
      full: await imageSrc(photo, hasDerivatives(photo) ? 'full' : 'orig', event.capEpoch),
      // What the camera produced, untouched apart from the metadata strip.
      // The native client saves these to the camera roll: "everyone gets the
      // full collection at full quality" is the product's headline, and the
      // 2560px `full` above is a lightbox rendition, not the photo. The web
      // has no use for it — its terminal action is the zip.
      original: await imageSrc(photo, 'orig', event.capEpoch),
    })),
  );

  // The contribution count is a recruiting device, not a statistic: "6 people,
  // 88 photos" is what gets the seventh person to add theirs (design §2).
  // Kept as a number as well as a list: the native client reads this field and
  // has no use for the filter the list is for.
  const people = await contributorsOf(db, event.id, rows, viewerId);
  const contributors = people.length;

  /*
   * Uploaded and not through the deriver yet — everybody's, not this tab's.
   *
   * Counted rather than taken from `rows`, because a photo mid-ingest is not
   * in `rows`: `visiblePhotos` returns what can be looked at, and this is the
   * number for the thing that cannot be looked at yet. Deliberately not
   * filtered by uploader — "12 arriving" is about the event filling up, and
   * whose they are is not knowable until they land anyway.
   */
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
  const arriving = pending?.n ?? 0;

  // Folded into the feed rather than given its own timer. The event page
  // already polls this endpoint while anything is in flight; a second poller
  // for the thread would be a second schedule to reason about and twice the
  // requests from a tab somebody left open.
  const messages = await messagesFor(db, event.id, viewerId, (actorId) =>
    contributorKey(event.id, actorId),
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

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      uploadsOpen: event.uploadsOpen,
      canAdminister,
      waiting: waitingRow?.n ?? 0,
      groupId: event.groupId,
      groupName: event.groupId ? ((await findGroup(db, event.groupId))?.name ?? null) : null,
      caption: event.caption,
      startsAt: event.startsAt?.toISOString() ?? null,
      linkToken: event.linkToken,
      code: spoken?.words ?? null,
      // What the link actually does, so the share panel can say. It used to
      // claim "anybody with this can open the event and add their photos" on
      // every album, which is false on two of the three policies and false
      // again once joins are closed — and it is the sentence somebody reads
      // immediately before sending the link to six people.
      accessPolicy: event.accessPolicy,
      joinsOpen: event.joinsOpen,
      place: event.place,
      /*
       * Worded here rather than in the browser.
       *
       * It is a relative time, and the head is rendered on the server before
       * it is hydrated in the client: two clocks, one of which is somebody's
       * laptop. A minute's disagreement between them is "59m ago" against "1h
       * ago", which React resolves by throwing the tree away. The client
       * re-reads this string every time it polls, so it stays honest.
       */
      added: ago(event.lastActiveAt, new Date()),
    },
    contributors,
    people,
    // Everybody in the album, for the faces in the head and the Members tab.
    // Not the same list as `people`, which is whose photographs these are.
    members: await membersOf(db, event.id),
    messages,
    // `contribute` and an account, matching what the POST actually enforces.
    // Computed from the same helper rather than from `viewerId != null`, which
    // is true for a guest — the composer would have been drawn for somebody the
    // server was always going to refuse.
    canPost:
      (await decide(db, event, 'contribute', requester)).allow &&
      (await currentAccountActorId()) != null,
    arriving,
    count: photos.length,
    photos,
  });
}
