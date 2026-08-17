/**
 * Blocking a contributor — docs/design.md §13, and an App Store 1.2
 * requirement for any app carrying user-generated content.
 *
 * One-directional and silent. The blocked party is never told, because telling
 * them turns a safety tool into a confrontation — which is exactly what
 * someone reaching for it is trying to avoid.
 *
 * Two effects: their uploads disappear from your view everywhere, and they
 * cannot join events you administer.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/**
 * Blocking is by photo rather than by actor id.
 *
 * It stays that way now that people have pages. A profile is reached by
 * handle, and what it offers is the ask — the answer to somebody you do not
 * want to hear from is to decline, which is said once and cannot be pressed
 * past. Blocking is the heavier tool and belongs where the heavier problem is:
 * a photograph of you, in an album you are both in, put there by somebody you
 * cannot simply stop asking. That is the handle a viewer has on a person, and
 * it is the one this takes.
 */
async function resolveTarget(
  db: ReturnType<typeof getDb>,
  photoId: unknown,
): Promise<string | null> {
  if (typeof photoId !== 'string') return null;
  const found = await findPhotoWithEvent(db, photoId);
  return found?.photo.uploaderId ?? null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { photoId?: unknown };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const target = await resolveTarget(db, body.photoId);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (target === actorId) {
    return NextResponse.json({ error: 'cannot_block_self' }, { status: 400 });
  }

  await db
    .insert(schema.blocks)
    .values({ blockerActorId: actorId, blockedActorId: target })
    .onConflictDoNothing();

  return NextResponse.json({ blocked: true });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { photoId?: unknown };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const target = await resolveTarget(db, body.photoId);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await db
    .delete(schema.blocks)
    .where(
      and(
        eq(schema.blocks.blockerActorId, actorId),
        eq(schema.blocks.blockedActorId, target),
      ),
    );

  return NextResponse.json({ blocked: false });
}
