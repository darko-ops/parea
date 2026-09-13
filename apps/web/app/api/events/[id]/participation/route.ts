/**
 * Leaving an album.
 *
 * The counterpart to `DELETE /api/events/[id]`, and deliberately a different
 * verb on a different path: that one ends the evening for everybody and needs
 * `administer`; this one removes the caller from it and needs nothing but being
 * them. Sharing a route would mean one endpoint whose blast radius depended on
 * who was asking, which is the kind of thing that is fine until somebody's
 * permissions change.
 *
 * ## Why there is no `guard` here
 *
 * Because there is nothing to guard. This handler reads no event and no photo:
 * it hands an actor id to `leaveEvent`, which is scoped to that actor by its
 * own signature and cannot touch anybody else's row, and hands back the two
 * facts about the caller that come out of it. The authorization is that
 * signature — the same shape `eventsFor(db, actorId)` has, and the reason
 * `access-chokepoint.test.ts` reaches neither. Adding a question about the
 * event itself here changes that, and would need the guard.
 *
 * What leaving does and does not take — the photographs stay, the link still
 * works, and the host is refused — is argued where it is decided, in
 * `src/events.ts`.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { leaveEvent } from '@/events';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorId = await currentActorId();
  // No session, no membership to end. A 404 rather than a 401 for the same
  // reason every other event route gives one: whether an id exists is not a
  // question this product answers to somebody who is not signed in.
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await leaveEvent(getDb(), id, actorId);

  if (!result.left) {
    return NextResponse.json(
      { error: result.reason === 'host' ? 'host_cannot_leave' : 'not_found' },
      { status: result.reason === 'host' ? 409 : 404 },
    );
  }

  // Idempotent otherwise: somebody who was never in it, or who left on another
  // device, is already where they asked to be. A failure there would be a
  // report about a state they wanted.
  return NextResponse.json({
    left: true,
    wasIn: result.wasIn,
    throughGroup: result.throughGroup,
  });
}
