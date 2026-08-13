/**
 * How many invites are waiting, for the badge in the rail.
 *
 * Its own route rather than a field on the session, because the rail is on
 * every page and the session is fetched by one of them. A single small number
 * that any page can ask for beats threading a count through every server
 * component's props — which is the version that gets forgotten on the next
 * page somebody adds.
 *
 * Answers 0 rather than 403 for a caller with no actor. The rail renders for
 * everyone, and "you have nothing waiting" is the true answer for a browser
 * that has never been anywhere.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { invitesWaiting } from '@/invites';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const waiting = await invitesWaiting(getDb(), await currentActorId());
  return NextResponse.json({ waiting });
}
