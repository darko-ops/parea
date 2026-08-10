/**
 * The albums this actor can reach.
 *
 * Backs the app's home and profile tabs. Part of the shared protocol like
 * everything else — the web has no screen for it yet, and could.
 *
 * Answers an empty list rather than 403 for someone with no actor: the app
 * asks on launch, before anyone has contributed anything, and having no
 * albums and not existing look the same from here because they should.
 */

import { NextResponse } from 'next/server';

import { albumsFor } from '@/albums';
import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    albums: await albumsFor(getDb(), await currentActorId()),
  });
}
