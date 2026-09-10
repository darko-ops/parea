/**
 * One person, for the app.
 *
 * The same page `/u/[handle]` renders, said in JSON so the native client draws
 * it rather than reimplementing who may see what. Both go through
 * `profileFor`, which is the point: two clients, one protocol has to mean the
 * same decision being made once, not the same fields being fetched twice.
 *
 * Every reason to have no page is the same 404 here — an unknown handle, a
 * device that never signed in, a merged actor, either side of a block — so the
 * app cannot be used to ask a question the page will not answer.
 *
 * `GET /api/people?q=` finds people and this reads one. Same segment, and
 * deliberately: a handle is the only key either of them takes.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { coverSrc, leadImage } from '@/cards';
import { albumsBy, eventsWithBoth, profileFor } from '@/people';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const db = getDb();
  const actorId = await currentActorId();

  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const person = await profileFor(db, actorId, decodeURIComponent(handle));
  if (!person) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [shared, albums] = await Promise.all([
    eventsWithBoth(db, actorId, person.actorId),
    albumsBy(db, actorId, person.actorId),
  ]);
  const alsoShared = new Set(shared.map((listing) => listing.id));

  return NextResponse.json({
    person: {
      actorId: person.actorId,
      handle: person.handle,
      displayName: person.displayName,
      // Presigned, an hour, like every other avatar that crosses this
      // boundary. The key itself never does.
      avatar: await avatarUrl(person.avatarKey),
      standing: person.standing,
      requestId: person.requestId,
    },
    /*
     * The events you are both in — the viewer's own list, filtered. The `when`
     * is an ISO timestamp rather than the rounded string the web page passes
     * down: that one exists to stop the browser's clock disagreeing with the
     * server's mid-hydration, and a native screen has no hydration to break.
     */
    shared: await Promise.all(
      shared.map(async (listing) => ({
        id: listing.id,
        name: listing.name,
        caption: listing.caption,
        lastActiveAt: listing.lastActiveAt,
        thumb: await leadImage(listing),
      })),
    ),
    /*
     * Everything they made, which is how somebody asks their way into a
     * private album without a link — see `albumsBy` for how little a locked
     * row carries, and note that the locked ones have no cover key to sign
     * rather than a cover this route declines to sign.
     *
     * Minus the ones already in `shared`, so the app draws each album once.
     */
    albums: await Promise.all(
      albums
        .filter((album) => !alsoShared.has(album.id))
        .map(async (album) => ({
          id: album.id,
          name: album.name,
          locked: album.locked,
          photoCount: album.photoCount,
          eventDate: album.eventDate,
          thumb: await coverSrc(album.coverKey),
        })),
    ),
  });
}
