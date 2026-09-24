/**
 * Who is in a photograph.
 *
 * A tag is a claim by the person who uploaded a picture about somebody else,
 * which is what makes it different in kind from a reaction. A reaction is a
 * fact about the person who left it and needs no permission from anybody; a tag
 * is a fact asserted about a third party who was not asked. Everything below
 * follows from that.
 *
 * **Only the uploader may tag.** Not the host, and not everybody who can see
 * the album. Whoever took the photograph is the only person in a position to
 * say who is in it, and opening it wider turns a label into a thing strangers
 * can attach to somebody's face.
 *
 * **Only people already in the event may be tagged.** Tagging is not a way to
 * point at somebody who cannot open the album and therefore cannot object. It
 * also keeps the search local: the picker offers the roster, not everybody with
 * an account.
 *
 * **A tag grants nothing.** It does not add a participant row and has no
 * bearing on what anybody can open. Being named in a photograph and being able
 * to see the evening are separate questions, and conflating them would make
 * tagging a way to hand out access.
 *
 * **And the tagged person can take it off.** That is not in this file — it is
 * the route above it — but it is the reason `taggedBy` is stored: somebody who
 * finds themselves labelled is entitled to know who said so.
 */

import { schema } from '@parea/core';
import { and, eq, inArray } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import { contributorKey } from './contributors';
import type { Db } from './db';

export type PhotoTag = {
  /**
   * Opaque and per-event, exactly as a contributor's is.
   *
   * A tag names somebody inside one album, and the name is all a client needs
   * to draw it. Sending an actor id would make "who is in this photograph" a
   * fact that follows the person out of the event, which is the thing
   * `contributors.ts` exists to prevent — and it matters more here, because
   * this one is about somebody's face rather than about their upload.
   */
  key: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  /** Whether this is the person looking, so they can take it off. */
  mine: boolean;
};

/**
 * The tags on a set of photographs, by photo id.
 *
 * One query for the lot. The feed reads every photograph in an album at once
 * and a tag lookup per row would be two hundred round trips to draw a grid.
 */
export async function tagsForPhotos(
  db: Db,
  eventId: string,
  photoIds: string[],
  viewerId: string | null,
): Promise<Map<string, PhotoTag[]>> {
  const byPhoto = new Map<string, PhotoTag[]>();
  if (photoIds.length === 0) return byPhoto;

  const rows = await db
    .select({
      photoId: schema.photoTags.photoId,
      actorId: schema.photoTags.actorId,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.photoTags)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.photoTags.actorId))
    .where(inArray(schema.photoTags.photoId, photoIds));

  // One presign per person rather than per row: somebody tagged in forty
  // photographs of one evening is one face, signed once.
  const faces = new Map<string, string | null>();
  await Promise.all(
    [...new Set(rows.map((row) => row.avatarKey))].map(async (key) => {
      faces.set(key ?? '', await avatarUrl(key ?? null));
    }),
  );

  for (const row of rows) {
    const list = byPhoto.get(row.photoId) ?? [];
    list.push({
      key: contributorKey(eventId, row.actorId),
      name: row.displayName?.trim() || (row.handle ? `@${row.handle}` : 'Someone'),
      handle: row.handle,
      avatarUrl: faces.get(row.avatarKey ?? '') ?? null,
      mine: viewerId != null && row.actorId === viewerId,
    });
    byPhoto.set(row.photoId, list);
  }

  for (const list of byPhoto.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byPhoto;
}

/** Everybody already tagged in one photograph, as actor ids. For the routes. */
export async function taggedIn(db: Db, photoId: string): Promise<string[]> {
  const rows = await db
    .select({ actorId: schema.photoTags.actorId })
    .from(schema.photoTags)
    .where(eq(schema.photoTags.photoId, photoId));
  return rows.map((row) => row.actorId);
}

/**
 * Adds a tag, or does nothing if it is already there.
 *
 * Idempotent on purpose: two taps racing each other are one tag, and the
 * primary key already says so.
 */
export async function tagPhoto(
  db: Db,
  photoId: string,
  actorId: string,
  taggedBy: string,
): Promise<void> {
  await db
    .insert(schema.photoTags)
    .values({ photoId, actorId, taggedBy })
    .onConflictDoNothing();
}

export async function untagPhoto(db: Db, photoId: string, actorId: string): Promise<void> {
  await db
    .delete(schema.photoTags)
    .where(
      and(eq(schema.photoTags.photoId, photoId), eq(schema.photoTags.actorId, actorId)),
    );
}
