/**
 * Ending one session from another device — design §3.
 *
 * The thing the old design could not do. A credential is revoked by marking
 * its row, and `currentCredential` refuses it on the next request: within a
 * moment, the laptop that was signed in is signed out, without its cooperation
 * and without touching anybody else's access to the same events.
 *
 * ## What it does and does not reach
 *
 * This used to say that the capability cookies survive — that they are "the
 * thing that actually opens the photographs", so a revoked browser could still
 * open any album it had visited, and the remedy was to rotate the event's link.
 * That was wrong, and wrong in the expensive direction: rotating a link
 * punishes everybody else at the party, and it was being prescribed for a gap
 * that is not there.
 *
 * A capability cookie is not a credential on its own. `authorize` counts it
 * only as `isParticipant && capFresh`, and `isParticipant` is resolved from the
 * *actor* on the request — which, once this row is revoked, is nobody. So on a
 * private album the revoked browser is refused on every path it has: the cookie
 * alone, the cookie beside a participant row that still exists, the cookie plus
 * the link still sitting in its history, and download. All four answer
 * `sign_in_required`, because the private branch asks `signedIn` first and a
 * revoked credential resolves to no actor at all.
 *
 * What revocation genuinely cannot do is take back a *public* album, and that
 * is not a property of this route. A public album needs no credential by
 * design — "possession of the link is a convenience for finding the thing, not
 * the lock on it" — so anyone holding the link can open it whether or not they
 * were ever signed in. Rotating the link would not change that either; see the
 * note on `isPublic` in `policy.ts`, which says so directly.
 *
 * `devices.test.ts` pins the four private refusals, so this comment cannot
 * drift back into describing a hole that was closed before it was written.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { currentAccountActorId } from '@/session';
import { revokeSession } from '@/sessions';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  /*
   * Revoking the session you are holding is allowed.
   *
   * It is the same thing the Sign out button does, arrived at from a list, and
   * refusing it would mean a row on the screen with no button on it and a
   * sentence explaining why. The client keeps the current row's button labelled
   * as itself; the server does not need a rule about it.
   */
  const ended = await revokeSession(getDb(), actorId, id);
  if (!ended) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(null, { status: 204 });
}
