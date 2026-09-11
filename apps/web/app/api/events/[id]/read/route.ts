/**
 * "I have read this event's thread."
 *
 * Its own route because of where the native client gets the conversation
 * from. The web fetches `/api/events/[id]/messages` and that GET can mark the
 * thread read on the way past; the phone reads the whole screen — photographs,
 * roster and thread — out of `/api/events/[id]/photos` in one request, and
 * marking a thread read because somebody opened an album would clear a badge
 * for a conversation they never looked at.
 *
 * So the phone says so explicitly, when the Talk pane has actually been
 * reached and scrolled to the bottom, which is the same moment `onSeen` fires
 * in the client today.
 *
 * `view` rather than `contribute`: everybody who can see the photographs can
 * read the thread, and having read something is not a claim about being
 * allowed to add to it.
 */

import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { markEventThreadRead } from '@/groupMessages';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
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

  /*
   * A guest counts, and that is the point of using `currentActorId` here
   * rather than `currentAccountActorId`.
   *
   * An actor row exists for every browser that has opened a link, so a
   * link-holder with no account has somewhere to keep this and gets working
   * unread counts on the device they are reading from. Requiring an account
   * would leave exactly the people who arrive by link — most of them — with a
   * badge that never clears.
   *
   * Null only when there is no actor at all, which is a caller with nothing to
   * record rather than a caller doing something wrong: "nothing was written"
   * is the honest answer, not a refusal.
   */
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ ok: true, recorded: false });

  await markEventThreadRead(db, event.id, actorId);
  return NextResponse.json({ ok: true, recorded: true });
}
