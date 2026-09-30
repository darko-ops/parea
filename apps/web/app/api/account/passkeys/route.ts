/**
 * The passkeys on this account: what there are, and keeping a new one.
 *
 * Both halves need an account for the same reason the options route does — a
 * passkey is a key to one, and a guest has nothing for it to open.
 */

import { mailerFromEnv, passkeyAddedEmail, redact, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { listPasskeys, verifyRegistration } from '@/passkeys';
import { signedInRecently } from '@/sessions';
import {
  currentAccountActorId,
  currentActorId,
  currentSessionId,
  fromBrowser,
  requestHost,
  userAgent,
} from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  return NextResponse.json({ passkeys: await listPasskeys(getDb(), actorId) });
}

/**
 * Finishes a registration.
 *
 * `currentActorId` rather than `currentAccountActorId`, and then the account is
 * established by the challenge: the challenge row was issued to this actor by
 * the options route, which already required an account, and
 * `verifyRegistration` refuses a challenge belonging to anybody else. Asking
 * the database the same question twice would be a second answer that can
 * disagree with the first.
 */
export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    response?: unknown;
    platform?: unknown;
  } | null;
  if (!body?.response || typeof body.response !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  /*
   * What to call this key on the list.
   *
   * `fromBrowser` decides whether to read a user agent at all, and the app says
   * which store it came from — because the alternative is labelling every
   * Android passkey "Parea for iOS", which is the kind of wrong that is worse
   * than saying nothing: the list exists so somebody can tell their devices
   * apart.
   */
  // Asked again here, not only when the options were issued: the challenge
  // lives for minutes and the rule is about the moment the key is kept.
  const db = getDb();
  if (!(await signedInRecently(db, await currentSessionId()))) {
    return NextResponse.json({ error: 'recent_sign_in_required' }, { status: 403 });
  }

  const browser = await fromBrowser();
  const kind = browser ? 'browser' : body.platform === 'android' ? 'android' : 'ios';

  const outcome = await verifyRegistration(db, {
    actorId,
    response: body.response as never,
    host: await requestHost(),
    userAgent: await userAgent(),
    kind,
  });

  if (!outcome.ok) {
    /*
     * Three outcomes and three sentences, because each has a different thing
     * for a person to do.
     *
     * This is not the sign-in path and there is no oracle to protect here:
     * whoever is asking has already proved they hold this account, so telling
     * them their authenticator is already enrolled says nothing they could not
     * learn from the list on the same screen.
     */
    const status = outcome.reason === 'already_registered' ? 409 : 400;
    return NextResponse.json({ error: outcome.reason }, { status });
  }

  await tellTheOwner(db, actorId, outcome.passkey.label);
  return NextResponse.json({ passkey: outcome.passkey }, { status: 201 });
}

/**
 * An email to the account's address saying a passkey was added.
 *
 * Best effort, and after the key is kept: a mail outage must not undo an
 * enrolment the person is watching succeed. Logged without the address.
 */
async function tellTheOwner(
  db: ReturnType<typeof getDb>,
  actorId: string,
  label: string | null,
): Promise<void> {
  let email = '';
  try {
    const [row] = await db
      .select({ email: schema.accounts.email })
      .from(schema.actors)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
      .where(eq(schema.actors.id, actorId))
      .limit(1);
    if (!row?.email) return;
    email = row.email;
    await mailerFromEnv().send({ to: email, ...passkeyAddedEmail(label) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`passkey-added email not sent: ${redact(detail, email)}`);
  }
}
