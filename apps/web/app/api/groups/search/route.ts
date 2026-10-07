/**
 * Group name search — docs/design.md §3.
 *
 * The backstop for a lost link, and the only discovery surface in the product.
 * The governing rule: groups can be findable, photos never are. This returns a
 * door — a name and a member count — and there is deliberately no equivalent
 * endpoint for events or photos.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { currentAccountActorId } from '@/session';
import { searchGroups } from '@/groups';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  // Signed in only, like everything else since accounts became required: it
  // answered anybody, no cookie at all, with group names and sizes.
  if (!(await currentAccountActorId())) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }
  const query = new URL(request.url).searchParams.get('q') ?? '';
  const groups = await searchGroups(getDb(), query);
  return NextResponse.json({ groups });
}
