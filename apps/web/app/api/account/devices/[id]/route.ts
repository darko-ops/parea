/**
 * Ending one session from another device — design §3.
 *
 * The thing the old design could not do. A credential is revoked by marking
 * its row, and `currentCredential` refuses it on the next request: within a
 * moment, the laptop that was signed in is signed out, without its cooperation
 * and without touching anybody else's access to the same events.
 *
 * ## What it does not do
 *
 * It does not take back the capability cookies that browser holds. Those are
 * per-event and they are the thing that actually opens the photographs, so a
 * browser signed out this way can still open an album whose link it had already
 * visited — the same limit the local sign-out has always had, and the same
 * remedy: rotating the event's link. Revoking identity is not revoking
 * possession of a link, and the product has never claimed otherwise.
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
