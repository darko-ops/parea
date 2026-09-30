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
import { resolveTarget as resolveContent, type TargetKind } from '@/contentReports';
import { getDb } from '@/db';
import { findPhotoWithEvent } from '@/moderation';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/**
 * By photograph: the first handle, and still the commonest — a photograph of
 * you, in an event you are both in, put there by somebody you cannot simply
 * stop asking. `resolveAuthor` below takes the others.
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

/**
 * Or by what somebody wrote, or by who they are.
 *
 * A photograph turned out not to be the only handle worth having: the person
 * someone needs to stop hearing from is as often the one in the thread, under
 * a moment, or in a group chat. So a message, a group message, a comment on a
 * moment, or a profile each name their author — through the same lookup
 * reporting uses, which answers only for things this viewer can see, so
 * blocking is not a way to learn who wrote something you were never shown.
 */
async function resolveAuthor(
  db: ReturnType<typeof getDb>,
  viewer: string,
  body: { messageId?: unknown; groupMessageId?: unknown; momentCommentId?: unknown; actorId?: unknown },
): Promise<string | null | undefined> {
  const pairs: [TargetKind, unknown][] = [
    ['event_message', body.messageId],
    ['group_message', body.groupMessageId],
    ['moment_comment', body.momentCommentId],
    ['profile', body.actorId],
  ];
  for (const [kind, id] of pairs) {
    if (typeof id !== 'string') continue;
    if (!UUID.test(id)) return null;
    const found = await resolveContent(db, kind, id, viewer);
    return found?.subject ?? null;
  }
  return undefined;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    photoId?: unknown;
    momentId?: unknown;
    messageId?: unknown;
    groupMessageId?: unknown;
    momentCommentId?: unknown;
    actorId?: unknown;
  };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const author = await resolveAuthor(db, actorId, body);
  const target = author === undefined ? await resolveTarget(db, body) : author;
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
