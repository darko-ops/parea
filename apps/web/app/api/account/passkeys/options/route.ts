/**
 * What the browser needs to make a passkey — design §3.
 *
 * An account, not an actor. A passkey is a key to an account, so there has to
 * be one to be a key to: offering this to a guest would mint a credential for
 * something that does not exist yet, and the thing it should offer them
 * instead is signing in.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { registrationOptions } from '@/passkeys';
import { PASSKEY_CHALLENGE_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId, requestHost } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const db = getDb();
  if (!(await withinLimit(db, PASSKEY_CHALLENGE_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  // The address and the account id together: one names the person to the
  // authenticator, the other is what it files the key under. See the note on
  // `userID` in `passkeys.ts` for why the account id and not the actor id.
  const [row] = await db
    .select({
      accountId: schema.accounts.id,
      email: schema.accounts.email,
      displayName: schema.actors.displayName,
    })
    .from(schema.actors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
    .where(eq(schema.actors.id, actorId))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  /*
   * Whether this client has a biometric of its own to offer.
   *
   * Taken from the caller rather than guessed, because it is a question only the
   * caller can answer — and trusted, because getting it wrong costs the person
   * asking a worse prompt and nobody else anything. See `preferPlatform`.
   */
  const body = (await request.json().catch(() => ({}))) as { platform?: unknown };

  const options = await registrationOptions(db, {
    actorId,
    accountId: row.accountId,
    email: row.email,
    displayName: row.displayName,
    host: await requestHost(),
    preferPlatform: body.platform === true,
  });

  return NextResponse.json(options);
}
