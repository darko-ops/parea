/**
 * Blocking a contributor — docs/design.md §13, and an App Store 1.2
 * requirement for any app carrying user-generated content.
 *
 * Silent. The blocked party is never told, because telling them turns a
 * safety tool into a confrontation — which is exactly what someone reaching
 * for it is trying to avoid.
 *
 * Both ways: the two of you stop seeing each other's photographs, messages,
 * comments, reactions, tags and moments everywhere — including albums and
 * groups you are both still in — and they cannot join events you administer.
 * Only the person who blocked can see the block, on their list, and undo it.
 */

import { schema } from '@parea/core';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { avatarUrl } from '@/accounts';
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
 * a photograph of you, in an event you are both in, put there by somebody you
 * cannot simply stop asking. That is the handle a viewer has on a person, and
 * it is the one this takes.
 */
async function resolveTarget(
  db: ReturnType<typeof getDb>,
  { photoId, momentId }: { photoId?: unknown; momentId?: unknown },
): Promise<string | null> {
  /*
   * Or by moment, which is the same argument with a different picture: a
   * moment is a photograph somebody put in front of you, and it is the handle
   * a viewer has on the person who did. It says whose it is and nothing else.
   */
  if (typeof momentId === 'string' && UUID.test(momentId)) {
    const [row] = await db
      .select({ actorId: schema.moments.actorId })
      .from(schema.moments)
      .where(eq(schema.moments.id, momentId))
      .limit(1);
    return row?.actorId ?? null;
  }
  if (typeof photoId !== 'string') return null;
  const found = await findPhotoWithEvent(db, photoId);
  return found?.photo.uploaderId ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    photoId?: unknown;
    momentId?: unknown;
  };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const target = await resolveTarget(db, body);
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

/**
 * Everybody this person has blocked, newest first — the list in settings.
 *
 * Only their own blocks, never the ones against them: a block is silent, and
 * a list of who has blocked you would announce every one.
 */
export async function GET() {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ blocked: [] });

  const rows = await getDb()
    .select({
      actorId: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
      blockedAt: schema.blocks.createdAt,
    })
    .from(schema.blocks)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.blocks.blockedActorId))
    .where(eq(schema.blocks.blockerActorId, actorId))
    .orderBy(desc(schema.blocks.createdAt));

  const blocked = await Promise.all(
    rows.map(async (row) => ({
      actorId: row.actorId,
      name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
      handle: row.handle,
      avatarUrl: await avatarUrl(row.avatarKey),
      blockedAt: row.blockedAt.toISOString(),
    })),
  );
  return NextResponse.json({ blocked });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    photoId?: unknown;
    momentId?: unknown;
    actorId?: unknown;
  };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  /*
   * Or by the person, from the list. Safe to take an id here where blocking
   * does not: this only ever deletes a row this person made, so it can say
   * nothing about anybody they have not already blocked.
   */
  const target =
    typeof body.actorId === 'string' && UUID.test(body.actorId)
      ? body.actorId
      : await resolveTarget(db, body);
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
