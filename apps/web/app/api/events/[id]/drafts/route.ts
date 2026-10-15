/**
 * Your own photographs in this roll that are not in it yet — see `@/drafts`.
 *
 * Nobody else's, and nothing about anybody else: the rows are scoped to the
 * caller in the query, so there is nothing to check the roll's access for.
 * Somebody with no actor has added nothing and gets an empty list.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { listDrafts } from '@/drafts';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ drafts: [] });
  return NextResponse.json({ drafts: await listDrafts(getDb(), id, actorId) });
}
