/**
 * Reacting to a message.
 *
 * One verb, because the control is one pill: POST toggles, and the response
 * says which way it went. Separate add and remove routes would mean the client
 * has to know which state it is in before it can act, and with two tabs open
 * it does not.
 *
 * Gated on `contribute` rather than `view`. A reaction is a mark somebody
 * leaves on an event, visible to everyone in it and attributed by count — it
 * is a small thing to say, but it is saying something, and the rule for saying
 * things here is the rule for adding photographs.
 */

import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { eventOfMessage, isReaction, toggleReaction } from '@/messages';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const message = await eventOfMessage(db, id);
  if (!message) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, message.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { emoji?: unknown };
  /*
   * The closed set is enforced here, not in the column.
   *
   * The column takes any short string, which is what keeps the offered set a
   * design decision rather than a migration. That only works if the one door
   * into the table is narrow — otherwise "any text under 32 characters,
   * attributed to you, shown to everybody in the event" is a message field
   * with no length limit worth mentioning.
   */
  if (!isReaction(body.emoji)) {
    return NextResponse.json({ error: 'unknown_reaction' }, { status: 400 });
  }

  const state = await toggleReaction(db, id, actorId, body.emoji);
  return NextResponse.json({ state });
}
