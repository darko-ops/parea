/**
 * The thread on an event — read it, add to it.
 *
 * Two capabilities, and they are the two the product already has. `view` reads,
 * which is the same decision that lets somebody see the photographs; and
 * `contribute` posts, which is the same decision the upload route makes. There
 * is deliberately no third rule here: "who may talk about this evening" is not
 * a new question, it is the question of who is in it.
 */

import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { contributorKey } from '@/contributors';
import { getDb } from '@/db';
import { MAX_BODY, messagesFor, postMessage } from '@/messages';
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

  const viewerId = await currentActorId();
  const messages = await messagesFor(db, event.id, viewerId, (actorId) =>
    contributorKey(event.id, actorId),
  );

  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id);
  try {
    // The same decision the upload route makes. A thread on an event nobody
    // may add to is a thread nobody may add to.
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  /*
   * An account, not merely a browser.
   *
   * `contribute` is held by anybody with the link, and `currentActorId`
   * answers for a guest — an actor exists for every browser that has opened
   * one. Checking that pair let a link-holder post under a name nobody had
   * claimed. Posting is the one thing here that addresses the room, so it is
   * the one thing that requires having said who you are.
   */
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    body?: unknown;
    photoId?: unknown;
  };

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  // Empty is rejected here rather than in the column, because the column has to
  // allow it: deleting a message overwrites the body.
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: 'too_long', max: MAX_BODY }, { status: 400 });
  }

  /*
   * A photo comment is a message with an anchor, and the anchor has to be a
   * photograph in *this* event. Without the check, `photoId` would be a way to
   * attach a comment to a photo in an event the poster cannot see — and then
   * read it back from the thread they can.
   */
  let photoId: string | null = null;
  if (typeof body.photoId === 'string' && body.photoId) {
    const { schema } = await import('@parea/core');
    const { and, eq } = await import('drizzle-orm');
    const [photo] = await db
      .select({ id: schema.photos.id })
      .from(schema.photos)
      .where(and(eq(schema.photos.id, body.photoId), eq(schema.photos.eventId, event.id)));
    if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    photoId = photo.id;
  }

  const messageId = await postMessage(db, event.id, actorId, text, photoId);
  return NextResponse.json({ id: messageId }, { status: 201 });
}
