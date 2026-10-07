/**
 * A group's own picture: the room's profile picture.
 *
 * The avatar route's shape, for a room instead of a person. The phone crops to
 * a square and sends the file as the body; this re-encodes it as a 512px JPEG,
 * which is also what makes a HEIC off an iPhone something every client can
 * draw.
 *
 * Hosts and co-hosts set it, because they are the ones who name the room
 * (security review L13) — and it is refused where naming is refused: a chat between two people is drawn as the
 * other person, and a picture over them would be a mask on somebody's face.
 *
 * Keyed by group *and* a fresh id, where the avatar is keyed by actor alone.
 * A room's picture is looked at by everybody in it, on phones that cache
 * images by URL, and a key that never changed would go on showing the old
 * picture to anyone whose signed URL happened to come out the same. The old
 * object is deleted once the new one is in place.
 */

import { randomUUID } from 'node:crypto';

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { findGroup, memberCount, membershipOf } from '@/groups';
import { admit, decode } from '@/imaging';
import { AVATAR_LIMIT, withinLimit } from '@/ratelimit';
import { screenUpload } from '@/safety';
import { currentAccountActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

const EDGE = 512;
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * The group, if the reader runs it and it is the kind that can have one.
 *
 * Hosts and co-hosts only — the `admin` role — for the reason renaming is
 * theirs (L13): the picture is the group's face to everyone in it.
 */
async function editable(id: string) {
  const db = getDb();
  const group = await findGroup(db, id);
  if (!group) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  const actorId = await currentAccountActorId();
  if (!actorId) return { error: NextResponse.json({ error: 'no_actor' }, { status: 403 }) };
  const membership = await membershipOf(db, group.id, actorId);
  if (!membership) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  if (membership.role !== 'admin') {
    return { error: NextResponse.json({ error: 'admin_only' }, { status: 403 }) };
  }
  return { db, group, actorId };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const found = await editable(id);
  if ('error' in found) return found.error;
  const { db, group, actorId } = found;

  // A conversation with one person has no picture of its own; a named group
  // does, at any size — see the same rule on renaming.
  if (group.name === null && (await memberCount(db, group.id)) < 3) {
    return NextResponse.json({ error: 'chat_not_nameable' }, { status: 409 });
  }
  if (!(await withinLimit(db, AVATAR_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  // Size and file type, before a decoder sees it. See `@/imaging`.
  const admitted = admit(Buffer.from(await request.arrayBuffer()), MAX_BYTES);
  if (!admitted.ok) {
    return NextResponse.json({ error: admitted.error }, { status: admitted.status });
  }

  // Checked against the child-safety provider before it is stored. See `@/safety`.
  const refused = await screenUpload(
    admitted.bytes,
    admitted.mime,
    { kind: 'group_photo', groupId: group.id },
    actorId,
  );
  if (refused) return refused;

  let jpeg: Buffer;
  try {
    jpeg = await decode(admitted.bytes)
      .rotate()
      .resize({ width: EDGE, height: EDGE, fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: 'not_an_image' }, { status: 400 });
  }

  const storage = getStorage();
  const key = `groups/${group.id}-${randomUUID()}.jpg`;
  await storage.putSmall(key, jpeg, 'image/jpeg');
  await db.update(schema.groups).set({ photoKey: key }).where(eq(schema.groups.id, group.id));
  if (group.photoKey) await storage.delete(group.photoKey).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const found = await editable(id);
  if ('error' in found) return found.error;
  const { db, group } = found;

  await db.update(schema.groups).set({ photoKey: null }).where(eq(schema.groups.id, group.id));
  if (group.photoKey) await getStorage().delete(group.photoKey).catch(() => {});

  return NextResponse.json({ ok: true });
}
