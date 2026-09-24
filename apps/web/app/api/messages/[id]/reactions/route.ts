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
import { eventOfMessage, reactionCountForMessage, toggleReaction } from '@/messages';
import { MAX_PER_MESSAGE, isEmoji } from '@/reactions';
import { currentAccountActorId, requesterFor } from '@/session';

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

  // Same rule as posting: a reaction is attributed, counted, and shown to
  // everybody in the event. `currentActorId` would answer for a guest.
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { emoji?: unknown };
  /*
   * Any emoji, not one of six.
   *
   * This checked `isReaction` — the closed set the picker used to offer — so
   * the list was both the vocabulary and the validation. It stopped being
   * both the day the app put a `+` beside those six: everything reached
   * through it came back 400 `unknown_reaction`, which the client swallows,
   * so choosing an emoji from the grid looked like a tap that did nothing.
   *
   * The photo route made this move already and the reasoning is its: the
   * question is "is this an emoji at all" rather than "is it one of the ones
   * we like", and the rule doing the real work inside `isEmoji` is that it
   * must be a single grapheme. Without that, a row of pills under a comment
   * is an unmoderated text channel reached through a box labelled "pick an
   * emoji" — and the column's own length check is the second lock on it.
   */
  if (!isEmoji(body.emoji)) {
    return NextResponse.json({ error: 'not_an_emoji' }, { status: 400 });
  }

  /*
   * And a ceiling, which the closed set used to be.
   *
   * Six offered and six enforced meant nobody could reach a seventh; with the
   * set open it is a limit somebody can hit while meaning well, so the
   * seventh is refused with `too_many` rather than silently dropped. Checked
   * before adding and never before removing — somebody at the limit must
   * still be able to take one back, and a check that ran on both would leave
   * them stuck with six they cannot undo.
   */
  const already = await reactionCountForMessage(db, id, actorId);
  if (already >= MAX_PER_MESSAGE) {
    const state = await toggleReaction(db, id, actorId, body.emoji);
    if (state === 'added') {
      // It was not one of theirs, so the toggle just added a seventh. Put it
      // back and refuse — cheaper than a read to find out first, and the race
      // between the two is a reaction nobody loses.
      await toggleReaction(db, id, actorId, body.emoji);
      return NextResponse.json({ error: 'too_many', max: MAX_PER_MESSAGE }, { status: 409 });
    }
    return NextResponse.json({ state });
  }

  const state = await toggleReaction(db, id, actorId, body.emoji);
  return NextResponse.json({ state });
}
