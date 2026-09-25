/**
 * Where you are signed in — design §3.
 *
 * The screen this feeds is the answer to a question the product could not
 * answer at all until sessions existed: a laptop lent to somebody, a phone
 * sold, a browser in a hotel. The cookie lasts four hundred days, so "it will
 * expire eventually" was never a real answer.
 *
 * An account, not an actor. A guest has exactly one session and is reading this
 * page with it, so there would be one row saying "you, here, now".
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import {
  currentAccountActorId,
  currentCredential,
  fromBrowser,
  issueActorCookie,
  userAgent,
} from '@/session';
import { listSessions, revokeOtherSessions, startSession } from '@/sessions';

export const runtime = 'nodejs';

export async function GET() {
  const credential = await currentCredential();
  const actorId = await currentAccountActorId();
  if (!credential || !actorId) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }

  const db = getDb();

  /*
   * A credential from before this table existed gets a row, here.
   *
   * Every browser and every phone that was signed in on the day sessions
   * shipped is carrying one of those, and they are invisible to this screen:
   * there is nothing to list and nothing to revoke. The fix could have been a
   * migration, and a migration cannot write the cookie — the session id has to
   * get into the signed value, and only a response can do that.
   *
   * So it happens on the one page where the gap is visible. Somebody who opens
   * Devices to see where they are signed in finds the device they are holding
   * on the list, rather than a screen that has quietly left it out.
   *
   * Browsers only, for the reason `ensureActor` gives: this can hand back a
   * cookie and it cannot reach into a keychain, so re-credentialling the app
   * would have to happen where the app asks for a token. It does, on launch.
   */
  let sessionId = credential.sessionId;
  if (!sessionId && (await fromBrowser())) {
    const adopted = await startSession(db, {
      actorId,
      kind: 'browser',
      userAgent: await userAgent(),
      // Honest about what is known: this credential proves somebody signed in,
      // and nothing anywhere records how. Guessing `code` would put a fact on
      // the screen that nobody established.
      method: 'guest',
    });
    await issueActorCookie(actorId, adopted.id);
    sessionId = adopted.id;
  }

  return NextResponse.json({
    devices: await listSessions(db, actorId, sessionId),
    /*
     * Whether anything here can actually be ended.
     *
     * False for a native client still carrying a pre-sessions token, whose row
     * cannot be minted from a GET. The screen says so rather than drawing a
     * list with a button that would do nothing.
     */
    manageable: sessionId !== null,
  });
}

/**
 * Sign out everywhere else.
 *
 * Keeps the session asking, which is what makes it pressable: signing somebody
 * out of the page they are standing on reads as the product breaking rather
 * than as the button working.
 */
export async function DELETE() {
  const credential = await currentCredential();
  const actorId = await currentAccountActorId();
  if (!credential || !actorId) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }

  const ended = await revokeOtherSessions(getDb(), actorId, credential.sessionId);
  return NextResponse.json({ ended });
}
