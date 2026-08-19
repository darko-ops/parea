/**
 * One photograph, as a page rather than a dialog.
 *
 * It was a 720px white card over an 82% black scrim: the photograph was
 * bounded by the card, there was no way to reach the next one, nothing said
 * who added it or when, and `Report` sat in the open at the same weight as a
 * comment. None of that is fixable inside a dialog, because the problem is
 * that it *is* one.
 *
 * The deciding reason for a route is that a single photograph becomes
 * linkable. "Look at this one" is a URL, Back returns to the gallery, and the
 * browser's own history does the work `onClose` was doing.
 *
 * Everything the page needs is resolved here, on the server, for the same
 * reason the album page seeds its own grid: the photograph is what somebody
 * came for, and putting a client fetch in front of it puts a spinner there
 * instead.
 */

import { ago } from '@parea/cards';
import { schema, visiblePhotos } from '@parea/core';
import { asc, eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { avatarUrl } from '@/accounts';
import { decide, findEventById } from '@/access';
import { contributorKey, contributorsOf } from '@/contributors';
import { getDb } from '@/db';
import { hasDerivatives, imageSources, imageSrc } from '@/images';
import { membersOf } from '@/members';
import { messagesFor } from '@/messages';
import { viewerContext } from '@/moderation';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';
import { PhotoView } from '@/../app/components/PhotoView';
import { Shell } from '@/../app/components/Shell';

export const dynamic = 'force-dynamic';

/**
 * How many neighbours the filmstrip carries either side of this one.
 *
 * The strip is the album's order and it scrolls, but it is not the whole
 * album: presigning 214 thumbnails to draw eight of them is 214 signatures
 * and 214 URLs on the wire for a strip somebody will move one step along.
 * Every step is a page load, so the window re-centres itself as you go and
 * the strip never runs out under the hand.
 */
const STRIP_REACH = 12;

/**
 * A title, and the reason there is no `og:image` under it.
 *
 * The spec asks for the photograph as the preview image so a shared link
 * unfurls. It cannot be: this URL is not the credential — access comes from
 * the capability cookie or the link exchange — so an `og:image` would hand the
 * photograph itself to whatever service unfurls a pasted URL, and to everybody
 * in the chat it was pasted into, none of whom passed the gate. The card would
 * be a way to look at somebody's photograph without being let in.
 *
 * The title is safe because it is rendered to the person who fetched the page,
 * and an unauthorised fetch does not get this far.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; photoId: string }>;
}) {
  /*
   * Belt and braces with the `X-Robots-Tag` in `next.config.ts`, exactly as
   * the album page does it: the header is a deployment property and this
   * survives it not being applied. Written out here rather than shared,
   * because a page that grows a `generateMetadata` and forgets this is a page
   * that quietly stops saying it — and a photograph is the one thing on this
   * URL worth a crawler's while.
   */
  const noindex = { robots: { index: false, follow: false } };
  const { id } = await params;

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return { title: 'Parea', ...noindex };

  const decision = await decide(db, event, 'view', await requesterFor(id));
  if (!decision.allow) return { title: 'Parea', ...noindex };

  return { title: `${event.name} · Parea`, ...noindex };
}

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string; photoId: string }>;
}) {
  const { id, photoId } = await params;

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) notFound();

  const requester = await requesterFor(id);
  const decision = await decide(db, event, 'view', requester);
  // The album's own gate, not a 404 of its own: a page that answered
  // differently for a real photo id than for a made-up one would be a way to
  // test whether a photograph exists.
  if (!decision.allow) notFound();

  const viewerId = await currentActorId();

  /*
   * The album's order, which is the order the gallery is in.
   *
   * The whole list rather than one row, because this page's other job is to
   * say where you are in the album and what is either side of you — and
   * "photo 7 of 214" is not answerable from the photograph alone.
   */
  const rows = await db
    .select()
    .from(schema.photos)
    .where(visiblePhotos(event.id, await viewerContext(db, viewerId)))
    .orderBy(asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`));

  const index = rows.findIndex((row) => row.id === photoId);
  // Not in the visible list is the same answer as not existing, and it has to
  // be: the list is already filtered for deleted, removed, hidden and blocked,
  // and a distinguishable response would say which.
  if (index < 0) notFound();

  const photo = rows[index]!;
  const previous = rows[index - 1] ?? null;
  const next = rows[index + 1] ?? null;

  const uploader = photo.uploaderId
    ? ((
        await db
          .select({
            displayName: schema.actors.displayName,
            handle: schema.actors.handle,
            avatarKey: schema.actors.avatarKey,
          })
          .from(schema.actors)
          .where(eq(schema.actors.id, photo.uploaderId))
      )[0] ?? null)
    : null;

  const from = Math.max(0, index - STRIP_REACH);
  const strip = await Promise.all(
    rows.slice(from, index + STRIP_REACH + 1).map(async (row) => ({
      id: row.id,
      src: await imageSrc(row, hasDerivatives(row) ? 'thumb' : 'orig', event.capEpoch),
    })),
  );

  const full = (row: typeof photo) =>
    imageSrc(row, hasDerivatives(row) ? 'full' : 'orig', event.capEpoch);

  return (
    <Shell>
      <PhotoView
        event={{ id: event.id, name: event.name }}
        photo={{
          id: photo.id,
          full: await full(photo),
          sources: await imageSources(photo, 'full', event.capEpoch),
          mine: viewerId != null && photo.uploaderId === viewerId,
          by:
            uploader?.displayName?.trim() ||
            (uploader?.handle ? `@${uploader.handle}` : 'Someone'),
          byAvatar: await avatarUrl(uploader?.avatarKey ?? null),
          ...when(photo.capturedAt, photo.uploadedAt),
        }}
        position={{ index, total: rows.length }}
        /*
         * The neighbours by id, and their full renditions as well.
         *
         * The URLs are not for drawing anything — the client warms them into
         * the browser's cache so the picture is already there when the next
         * page renders. Paging that flashes an empty frame for half a second
         * is paging nobody does twice.
         */
        previous={
          previous ? { id: previous.id, full: await full(previous) } : null
        }
        next={next ? { id: next.id, full: await full(next) } : null}
        strip={strip}
        /*
         * The album's conversation, not this photograph's.
         *
         * A per-photo comment thread is a comment section, and a comment
         * section on a photograph of somebody's evening turns an album into a
         * feed. The people here are already one group talking to each other,
         * so the column beside the picture is that group's chat — the same
         * messages as the Conversation tab, and anything said here is said to
         * the album rather than filed under one picture.
         */
        messages={await messagesFor(db, event.id, viewerId, (actorId) =>
          contributorKey(event.id, actorId),
        )}
        people={await contributorsOf(db, event.id, rows, viewerId)}
        members={await membersOf(db, event.id)}
        canPost={
          (await decide(db, event, 'contribute', requester)).allow &&
          (await currentAccountActorId()) != null
        }
      />
    </Shell>
  );
}

/**
 * When the photograph is from, said two ways, and worded here.
 *
 * Both halves are computed on the server because both would otherwise
 * disagree with it: `ago` is relative to a clock, and a laptop a minute out
 * renders "59m ago" against the server's "1h ago", which React resolves by
 * throwing the tree away.
 *
 * The distinction the line makes is real rather than cosmetic. `captured_at`
 * is what the camera recorded; `uploaded_at` is when it arrived here, and iOS
 * Safari strips EXIF on upload, so a web-contributed photo often has only the
 * second one (design §8). Printing an upload time in the shape of a capture
 * time would state, in a caption, that a photograph was taken at the moment it
 * was posted — which for most of somebody's album is false.
 */
function when(
  capturedAt: Date | null,
  uploadedAt: Date,
): { when: string; whenAgo: string } {
  const at = capturedAt ?? uploadedAt;
  const exact = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
    .format(at)
    // "Friday 14 March at 21:40" — Intl's own joining word, replaced with the
    // comma the design asks for.
    .replace(' at ', ', ');

  return {
    when: capturedAt ? exact : `Added ${exact}`,
    whenAgo: ago(at, new Date()),
  };
}
