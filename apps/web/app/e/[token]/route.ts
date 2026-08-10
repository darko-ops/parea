/**
 * The shareable link. Exchanges a token for a scoped capability, then redirects.
 *
 * This is a route handler rather than a page for two reasons. Cookies can only
 * be set outside of rendering, and redirecting to `/event/<id>` means the link
 * token appears in the address bar exactly once and is gone on the next
 * navigation — which, combined with `Referrer-Policy: no-referrer`, is what
 * stops the credential leaking (design §3).
 *
 * The link itself keeps working forever, for everyone. It is the capability
 * that becomes ambient, not the URL.
 */

import { isWellFormedLinkToken } from '@parea/core';
import { redirect } from 'next/navigation';

import { findEventByLinkToken, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { grantCapability, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Cheap shape check before putting an arbitrary path segment near the db.
  if (!isWellFormedLinkToken(token)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const event = await findEventByLinkToken(db, token);
  if (!event) return Response.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id, { linkToken: token });
  try {
    // 'view' rather than 'contribute': arriving at a link with uploads closed
    // should still show you the photos.
    await guard(db, event, 'view', requester);
  } catch (err) {
    return toResponse(err);
  }

  await grantCapability(event.id, event.capEpoch);
  redirect(`/event/${event.id}`);
}
