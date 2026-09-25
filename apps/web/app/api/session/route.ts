/**
 * Mint a guest identity for a client without cookies — design §3.
 *
 * The web gets its actor from a Set-Cookie on first contribution. Native has
 * no equivalent, so it asks for the same signed value and keeps it in the
 * keychain.
 *
 * Still minted on first *contribution*, not first launch: the mobile client
 * calls this the first time someone adds photos, so opening an event you were
 * sent creates no durable record of you.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { actorToken, currentCredential, fromBrowser, userAgent } from '@/session';
import { startSession } from '@/sessions';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  /*
   * There is no browser caller and there should not be one. A page gets its
   * actor from the cookie the contribution routes set; this route answers with
   * the signed value in the body, and that is the one thing `httpOnly` exists
   * to prevent — a script on the page reading who you are and keeping it
   * somewhere the browser cannot clear.
   *
   * 404 rather than 403, and before any work: the route does not exist as far
   * as a browser is concerned, and a browser that reached it also does not get
   * an actor row minted for a token it will never be given.
   */
  if (await fromBrowser()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    displayName?: unknown;
    platform?: unknown;
  };
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : null;
  /*
   * Which store this build came from, for the row on the Devices screen.
   *
   * Asked for rather than sniffed. The app knows, and a user agent is a string
   * a caller chose — a guess from one would be a worse answer to a question
   * that has already been answered correctly. An absent or unrecognised value
   * is treated as iOS rather than refused: the platform decorates a list and
   * decides nothing, so a build that has not been taught to send it should
   * still be able to get an identity.
   */
  const kind = body.platform === 'android' ? 'android' : 'ios';

  const db = getDb();

  const existing = await currentCredential();
  if (existing) {
    // A name given now is a rename, not a no-op. The profile tab is the only
    // place someone can set one after the fact, and this used to answer with
    // the token and quietly discard it.
    if (displayName) {
      await db
        .update(schema.actors)
        .set({ displayName })
        .where(eq(schema.actors.id, existing.actorId));
    }
    /*
     * The same credential back, session and all.
     *
     * Re-minting a session here would give one phone a second row every time
     * it asked, and the app asks on launch. The row it already has is the one
     * that has been getting its `last_seen_at` bumped, which is what the list
     * is for.
     */
    return NextResponse.json({
      actorToken: actorToken(existing.actorId, existing.sessionId),
    });
  }

  // Deliberately not `ensureActor`: that sets the cookie, and native shares
  // the platform cookie store. An app carrying both a keychain token and a
  // cookie for the same actor is two credentials to reason about instead of
  // one, for no gain.
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName })
    .returning();

  // Unlike the browser path in `ensureActor`, the session is recorded here
  // because this *is* the moment a credential is handed out: the token in the
  // response is the thing the keychain will hold.
  const session = await startSession(db, {
    actorId: actor!.id,
    kind,
    userAgent: await userAgent(),
    method: 'guest',
  });

  return NextResponse.json(
    { actorToken: actorToken(actor!.id, session.id) },
    { status: 201 },
  );
}
