/**
 * Taking things down — the parts of it that touch storage.
 *
 * Each kind of thing has an owner-scoped removal in its own module
 * (`removeMoment`, `deleteMessage`, …) and its route adds the storage half.
 * Staff removal (`src/admin.ts`) needs the same two halves without being the
 * owner, so the storage half lives here, once, rather than being copied into
 * a second caller.
 */

import { schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from './db';
import { deleteGroupMessage } from './groupMessages';
import { deleteMessage } from './messages';
import { removeMoment, removeMomentComment } from './moments';
import { revokePhotoLinks } from './revoke';
import { getStorage } from './storage';

/**
 * Take the renditions out of storage, now rather than on the purge job's clock.
 *
 * The image Worker holds no database and decides nothing: it verifies a
 * signature and streams. Its only revocation signal is the event's epoch
 * marker, so a photograph removed here keeps serving on any URL already minted
 * for it until that URL's hour bucket expires — up to two hours. For an
 * ordinary removal that is a defensible trade and the design says so.
 *
 * This is not an ordinary removal. Somebody asked for their photograph to come
 * down and a host agreed; "it will stop appearing within two hours" is a poor
 * answer to that, and the fix is cheap because a missing object is an immediate
 * 404 from the Worker with no epoch involved.
 *
 * ## Only here, and only the derivatives
 *
 * Not on the uploader's own delete, which is soft on purpose so an accidental
 * removal is recoverable. Not on the 48-hour auto-hide, which is *reversible*
 * — a host who was away can still decline and the photograph comes back, and
 * deleting its renditions would turn that into a re-derive. Not on an ingest
 * quarantine, which never builds derivatives at all. This is the one path that
 * is both terminal and requested by a person.
 *
 * The original stays. `photo.storage_key` is what an abuse investigation reads
 * and what the purge job removes on its own schedule; the derivatives are what
 * a viewer sees, and they are the whole of what is being revoked.
 *
 * The rows stay too. Nothing lists a `removed` photograph — `visiblePhotos`
 * excludes it four ways over — so a row pointing at an absent object is
 * unreachable rather than wrong, and the purge job tidies both together.
 *
 * Failure is swallowed deliberately. The row is already `removed` and the
 * photograph is already out of every listing; a storage blip must not turn a
 * host's decision into a 500 and leave the report unresolved.
 *
 * Shared with staff removal (`removeContent` below), which is the same kind of
 * removal: terminal, and decided by a person. Tested directly, because what is
 * worth pinning is the storage effect — which keys go, which stay — not the
 * authorization, which each caller owns.
 */
export async function dropDerivatives(db: Db, photoId: string) {
  const rows = await db
    .select({ storageKey: schema.derivatives.storageKey })
    .from(schema.derivatives)
    .where(eq(schema.derivatives.photoId, photoId))
    .catch(() => [] as { storageKey: string }[]);

  const storage = getStorage();
  await Promise.all(
    rows.map((row) =>
      storage.delete(row.storageKey).catch((err) => {
        console.error(`removal: could not delete ${row.storageKey}: ${err}`);
      }),
    ),
  );
}

/** Storage keys go after the database change, and a failure is only logged. */
export async function dropObjects(keys: (string | null | undefined)[]): Promise<void> {
  const storage = getStorage();
  await Promise.all(
    keys
      .filter((key): key is string => Boolean(key))
      .map((key) =>
        storage.delete(key).catch((err) => {
          console.error(`removal: could not delete ${key}: ${err}`);
        }),
      ),
  );
}

export type TakeDownKind =
  | 'photo'
  | 'moment'
  | 'moment_comment'
  | 'event_message'
  | 'group_message'
  | 'profile'
  | 'group';

export type TakenDown =
  /** Done. `after` is the storage half, to run once the change has committed. */
  | { result: 'removed'; after: () => Promise<void>; photo?: { id: string; eventId: string } }
  /** Nothing left to take down — its author got there first, or it never was. */
  | { result: 'already_gone' }
  /** A photo held for child safety. Its incident decides, not a takedown. */
  | { result: 'under_review' };

/**
 * Take one thing down on somebody else's say-so.
 *
 * Each case finds the thing's author and goes through the same owner-scoped
 * function the author's own delete uses, so a staff removal leaves exactly
 * what the author's would: an emptied message row, a tombstoned moment. Where
 * there is no such function — a profile, a group — it does what the owner's
 * own controls do: clear the picture, and the name.
 *
 * Takes a `db` that may be a transaction, and touches no storage itself; the
 * caller runs `after` once the change is committed, so a rolled-back removal
 * has not already deleted anything.
 */
export async function takeDown(db: Db, kind: TakeDownKind, id: string): Promise<TakenDown> {
  switch (kind) {
    case 'photo': {
      const [photo] = await db
        .select({
          id: schema.photos.id,
          eventId: schema.photos.eventId,
          contentHash: schema.photos.contentHash,
          status: schema.photos.status,
        })
        .from(schema.photos)
        .where(eq(schema.photos.id, id));
      if (!photo || photo.status === 'removed') return { result: 'already_gone' };
      if (photo.status === 'quarantined') return { result: 'under_review' };
      await db
        .update(schema.photos)
        .set({ status: 'removed', deletedAt: new Date() })
        .where(eq(schema.photos.id, id));
      // Read now: `after` runs once a transaction has closed, and cannot query.
      const renditions = await db
        .select({ storageKey: schema.derivatives.storageKey })
        .from(schema.derivatives)
        .where(eq(schema.derivatives.photoId, id));
      return {
        result: 'removed',
        photo: { id: photo.id, eventId: photo.eventId },
        after: async () => {
          await dropObjects(renditions.map((r) => r.storageKey));
          await revokePhotoLinks(photo);
        },
      };
    }

    case 'moment': {
      const [row] = await db
        .select({ author: schema.moments.actorId })
        .from(schema.moments)
        .where(eq(schema.moments.id, id));
      const removed = row ? await removeMoment(db, row.author, id) : null;
      if (!removed) return { result: 'already_gone' };
      return { result: 'removed', after: () => dropObjects([removed.key, removed.thumbKey]) };
    }

    case 'moment_comment': {
      const [row] = await db
        .select({ author: schema.momentComments.actorId })
        .from(schema.momentComments)
        .where(eq(schema.momentComments.id, id));
      if (!row || !(await removeMomentComment(db, row.author, id))) return { result: 'already_gone' };
      return { result: 'removed', after: async () => {} };
    }

    case 'event_message': {
      const [row] = await db
        .select({ author: schema.eventMessages.authorActorId })
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.id, id));
      if (!row?.author || !(await deleteMessage(db, id, row.author))) return { result: 'already_gone' };
      return { result: 'removed', after: async () => {} };
    }

    case 'group_message': {
      const [row] = await db
        .select({ author: schema.groupMessages.authorActorId })
        .from(schema.groupMessages)
        .where(eq(schema.groupMessages.id, id));
      if (!row?.author || !(await deleteGroupMessage(db, id, row.author))) {
        return { result: 'already_gone' };
      }
      return { result: 'removed', after: async () => {} };
    }

    case 'profile': {
      // What a person can change about how they appear: their name and their
      // picture. The handle stays — it is how people are found and linked,
      // and taking it is a different decision from taking a picture down.
      const [row] = await db
        .select({ avatarKey: schema.actors.avatarKey, displayName: schema.actors.displayName })
        .from(schema.actors)
        .where(eq(schema.actors.id, id));
      if (!row || (!row.avatarKey && !row.displayName)) return { result: 'already_gone' };
      await db
        .update(schema.actors)
        .set({ avatarKey: null, displayName: null })
        .where(eq(schema.actors.id, id));
      return { result: 'removed', after: () => dropObjects([row.avatarKey]) };
    }

    case 'group': {
      // The name and the picture, as an admin clearing them would — and with
      // the name goes findability, for the reason `PATCH /api/groups/[id]`
      // gives. The members and their messages stay.
      const [row] = await db
        .select({ name: schema.groups.name, photoKey: schema.groups.photoKey })
        .from(schema.groups)
        .where(and(eq(schema.groups.id, id), isNull(schema.groups.deletedAt)));
      if (!row || (!row.name && !row.photoKey)) return { result: 'already_gone' };
      await db
        .update(schema.groups)
        .set({ name: null, slug: null, findable: false, photoKey: null })
        .where(eq(schema.groups.id, id));
      return { result: 'removed', after: () => dropObjects([row.photoKey]) };
    }
  }
}
