/**
 * "Hide from profile" — PUT hides a roll from the caller's profile, DELETE
 * puts it back.
 *
 * ## Why there is no `guard` here
 *
 * The same reason `participation` has none: this handler reads no event and no
 * photo. It hands an actor id to `setHiddenFromProfile`, which is scoped to
 * that actor by its signature and touches one row of theirs, and answers only
 * whether the event exists — which a 404 from any other route already says.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { setHiddenFromProfile } from '@/events';
import { currentAccountActorId } from '@/session';

export const runtime = 'nodejs';

async function set(params: Promise<{ id: string }>, hidden: boolean) {
  const { id } = await params;
  const actorId = await currentAccountActorId();
  // A profile is an account's, so no account, no profile to hide it from.
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const found = await setHiddenFromProfile(getDb(), id, actorId, hidden);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ hiddenFromProfile: hidden });
}

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return set(params, true);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return set(params, false);
}
