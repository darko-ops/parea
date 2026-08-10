/**
 * Presign a batch of uploads — step 2 of design §7.5.
 *
 * Returns one PUT URL per file. The client then talks to storage directly;
 * bytes never come back through here.
 */

import { schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { findEventById, guard, recordParticipant, toResponse } from '@/access';
import { getDb } from '@/db';
import { isBlockedBy } from '@/moderation';
import { ensureActor, requesterFor } from '@/session';
import { getStorage, objectKey } from '@/storage';

export const runtime = 'nodejs';

/** Anti-catastrophe bounds, not product limits (design §7.8). Log when they bite. */
const MAX_FILES_PER_REQUEST = 50;
const MAX_BYTES_PER_FILE = 200 * 1024 * 1024;

const ALLOWED_MIME = /^(image\/(jpeg|png|heic|heif|webp|avif|gif)|video\/(mp4|quicktime))$/;

type FileRequest = { name: string; size: number; type: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    files?: unknown;
    linkToken?: unknown;
    code?: unknown;
    displayName?: unknown;
  };

  const files = parseFiles(body.files);
  if (!files) return NextResponse.json({ error: 'invalid_files' }, { status: 400 });

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  // Only now does a browsing visitor become an actor.
  const actorId = await ensureActor(
    db,
    typeof body.displayName === 'string' ? body.displayName.trim() : undefined,
  );

  // The second half of what a block means: blocked by the host, cannot
  // contribute here. Checked after the actor exists, because until someone
  // contributes there is nobody to have blocked.
  if (await isBlockedBy(db, event.createdBy, actorId)) {
    return NextResponse.json({ error: 'blocked' }, { status: 403 });
  }

  await recordParticipant(db, event.id, actorId);

  const storage = getStorage();
  const uploads = await Promise.all(
    files.map(async (file) => {
      // A random discriminator, not a content hash: the client cannot be asked
      // to hash 200 files on a phone, and the deriver rewrites the key to a
      // content-addressed one once it has actually read the bytes.
      const key = objectKey(event.id, `${crypto.randomUUID()}`);
      const [photo] = await db
        .insert(schema.photos)
        .values({
          eventId: event.id,
          uploaderId: actorId,
          storageKey: key,
          byteSize: file.size,
          mime: file.type,
          status: 'pending',
        })
        .returning();

      const presigned = await storage.presignPut(key, file.type);
      return {
        photoId: photo!.id,
        name: file.name,
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expiresAt: presigned.expiresAt.toISOString(),
      };
    }),
  );

  return NextResponse.json({ uploads }, { status: 201 });
}

function parseFiles(value: unknown): FileRequest[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_FILES_PER_REQUEST) return null;

  const out: FileRequest[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { name, size, type } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name.length > 512) return null;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
    if (size > MAX_BYTES_PER_FILE) return null;
    if (typeof type !== 'string' || !ALLOWED_MIME.test(type)) return null;
    out.push({ name, size, type });
  }
  return out;
}
