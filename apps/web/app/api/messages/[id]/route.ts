/**
 * One message — rewrite it, or take it back.
 *
 * The path has no event in it, so the first thing both verbs do is find the
 * event the message belongs to and ask `authorize()` about *that*. A route
 * that skipped straight to "is this row yours" would be checking ownership
 * without checking access, and ownership survives losing access: somebody
 * removed from an event still owns the messages they left in it.
 *
 * Everything that is not allowed answers 404, including "yours but you can no
 * longer see the event". Distinguishing them would turn this into a way to ask
 * whether a message id is real.
 */

import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { deleteMessage, editMessage, eventOfMessage, MAX_BODY } from '@/messages';
import { currentAccountActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/** The common preamble: which event, may I see it, and am I the author. */
async function mine(messageId: string) {
  const db = getDb();
  const message = await eventOfMessage(db, messageId);
  if (!message) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  const event = await findEventById(db, message.eventId);
  if (!event) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'view', requester);
  } catch {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }

  // Only an account can have written one, so only an account can change one.
  const actorId = await currentAccountActorId();
  if (!actorId || actorId !== message.authorActorId) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { db, actorId };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const checked = await mine(id);
  if ('error' in checked) return checked.error;

  const body = (await request.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: 'too_long', max: MAX_BODY }, { status: 400 });
  }

  // The update is scoped by author as well, so this is belt and braces — and
  // the false it returns is the deleted-message case, which the check above
  // cannot see.
  const ok = await editMessage(checked.db, id, checked.actorId, text);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const checked = await mine(id);
  if ('error' in checked) return checked.error;

  const ok = await deleteMessage(checked.db, id, checked.actorId);
  // Already gone is the outcome that was asked for, so it is not an error —
  // deleting twice from two tabs must not put a failure in front of somebody.
  if (!ok) return new NextResponse(null, { status: 204 });
  return new NextResponse(null, { status: 204 });
}
