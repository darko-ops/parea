/**
 * Answering a group invitation.
 *
 * The mirror of `app/api/invites/[id]`, which answers the event kind. Same
 * shape and the same reasoning: the write is scoped to the invitation's own
 * actor and to `open` in a single statement, so answering twice from two tabs
 * cannot turn a decline back into an accept, and "is this mine" is not asked
 * about a row something else could change in between.
 *
 * Everything not allowed answers 404, including somebody else's invitation.
 * Distinguishing "no such invitation" from "not yours" would make this a way
 * to ask whether an id is real.
 *
 * Accepting is what makes somebody a member — the row was an offer until now.
 * `answerGroupInvite` writes the membership in the same call, so there is no
 * moment where an invitation is accepted and the person is not in the group.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { answerGroupInvite } from '@/groups';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== 'accept' && body.action !== 'decline') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const answered = await answerGroupInvite(db, id, actorId, body.action === 'accept');
  if (!answered) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /*
   * No capability cookie to grant, unlike the event kind.
   *
   * An event's invitation ends in `grantCapability`, because access to an
   * event is a credential this browser holds. Group membership is a row about
   * the actor, so it is true on every device they sign in on, and nothing has
   * to be handed to this one.
   */
  return NextResponse.json({ ok: true });
}
