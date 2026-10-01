/**
 * Looking somebody up, and suspending them — the admin hub's people pages.
 *
 * Reports and flags are about one thing at a time. A person who keeps doing it
 * is only visible from here: everything reported about them, everything they
 * reported, what staff already did, and whether they are suspended.
 *
 * No pictures here either, the profile picture included. Words and counts.
 */

import { schema } from '@parea/core';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { AdminConflict } from './admin';
import type { Db } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `%` and `_` are wildcards to ILIKE; a person typing them means the characters. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Find people by id, email, handle or name.
 *
 * - an actor id goes straight to that person, following a merge to whoever
 *   they became;
 * - anything with an `@` in the middle is an email, matched exactly;
 * - a leading `@` is a handle;
 * - anything else matches the start of a handle or anywhere in a name.
 *
 * Merged-away actors are left out of the name search: they are tombstones,
 * and the person is listed under the actor they were merged into.
 */
export async function searchPeople(db: Db, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];

  const base = db
    .select({
      id: schema.actors.id,
      kind: schema.actors.kind,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      email: schema.accounts.email,
      createdAt: schema.actors.createdAt,
      mergedIntoId: schema.actors.mergedIntoId,
    })
    .from(schema.actors)
    .leftJoin(schema.accounts, eq(schema.actors.accountId, schema.accounts.id));

  let rows;
  if (UUID.test(q)) {
    rows = await base.where(eq(schema.actors.id, q)).limit(1);
    if (rows[0]?.mergedIntoId) {
      rows = await base.where(eq(schema.actors.id, rows[0].mergedIntoId)).limit(1);
    }
  } else if (/^[^@\s]+@[^@\s]+$/.test(q)) {
    rows = await base.where(eq(schema.accounts.email, q.toLowerCase())).limit(5);
  } else {
    const handle = q.replace(/^@/, '');
    const conditions = [ilike(schema.actors.handle, `${literal(handle)}%`)];
    if (!q.startsWith('@')) conditions.push(ilike(schema.actors.displayName, `%${literal(q)}%`));
    rows = await base
      .where(and(isNull(schema.actors.mergedIntoId), or(...conditions)))
      .orderBy(desc(schema.actors.createdAt))
      .limit(25);
  }

  const suspended = await activeSuspensions(db, rows.map((r) => r.id));
  return rows.map(({ mergedIntoId: _merged, ...r }) => ({ ...r, suspended: suspended.has(r.id) }));
}

async function activeSuspensions(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ actorId: schema.suspensions.actorId })
    .from(schema.suspensions)
    .where(and(inArray(schema.suspensions.actorId, ids), isNull(schema.suspensions.liftedAt)));
  return new Set(rows.map((r) => r.actorId));
}

const count = sql<number>`count(*)::int`;

/** One person, and everything a reviewer needs to decide about them. */
export async function personDetail(db: Db, actorId: string) {
  const [person] = await db
    .select({
      id: schema.actors.id,
      kind: schema.actors.kind,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
      bio: schema.actors.bio,
      link: schema.actors.link,
      email: schema.accounts.email,
      phoneVerified: sql<boolean>`${schema.actors.phoneVerifiedAt} is not null`,
      createdAt: schema.actors.createdAt,
      mergedIntoId: schema.actors.mergedIntoId,
    })
    .from(schema.actors)
    .leftJoin(schema.accounts, eq(schema.actors.accountId, schema.accounts.id))
    .where(eq(schema.actors.id, actorId));
  if (!person) throw new AdminConflict('not_found');

  const [sessions] = await db
    .select({ live: count, lastSeenAt: sql<string | null>`max(${schema.sessions.lastSeenAt})` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.actorId, actorId), isNull(schema.sessions.revokedAt)));

  const photos = await db
    .select({ status: schema.photos.status, n: count })
    .from(schema.photos)
    .where(eq(schema.photos.uploaderId, actorId))
    .groupBy(schema.photos.status);

  const [rolls] = await db.select({ n: count }).from(schema.events).where(eq(schema.events.createdBy, actorId));
  const [groups] = await db
    .select({ n: count })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.actorId, actorId));
  const [moments] = await db
    .select({ n: count })
    .from(schema.moments)
    .where(and(eq(schema.moments.actorId, actorId), isNull(schema.moments.deletedAt)));

  // Reports about what they wrote or who they are, and about photos they uploaded.
  const aboutWords = await db
    .select({
      id: schema.contentReports.id,
      kind: schema.contentReports.kind,
      status: schema.contentReports.status,
      targetKind: schema.contentReports.targetKind,
      note: schema.contentReports.note,
      createdAt: schema.contentReports.createdAt,
    })
    .from(schema.contentReports)
    .where(eq(schema.contentReports.subjectActorId, actorId))
    .orderBy(desc(schema.contentReports.createdAt))
    .limit(50);

  const aboutPhotos = await db
    .select({
      id: schema.reports.id,
      kind: schema.reports.kind,
      status: schema.reports.status,
      note: schema.reports.note,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    .where(eq(schema.photos.uploaderId, actorId))
    .orderBy(desc(schema.reports.createdAt))
    .limit(50);

  const [filed] = await db
    .select({ n: count })
    .from(schema.contentReports)
    .where(eq(schema.contentReports.reporterActorId, actorId));
  const [filedPhotos] = await db
    .select({ n: count })
    .from(schema.reports)
    .where(eq(schema.reports.reporterActorId, actorId));

  const [incidents] = await db
    .select({ n: count })
    .from(schema.safetyIncidents)
    .where(eq(schema.safetyIncidents.uploaderActorId, actorId));
  const [flags] = await db
    .select({ n: count })
    .from(schema.moderationFlags)
    .innerJoin(schema.photos, eq(schema.moderationFlags.photoId, schema.photos.id))
    .where(eq(schema.photos.uploaderId, actorId));

  const suspensions = await db
    .select()
    .from(schema.suspensions)
    .where(eq(schema.suspensions.actorId, actorId))
    .orderBy(desc(schema.suspensions.createdAt));

  const staffActions = await db
    .select()
    .from(schema.staffActions)
    .where(and(eq(schema.staffActions.targetKind, 'actor'), eq(schema.staffActions.targetId, actorId)))
    .orderBy(desc(schema.staffActions.createdAt))
    .limit(50);

  return {
    person,
    suspended: suspensions.some((s) => !s.liftedAt),
    sessions: { live: sessions?.live ?? 0, lastSeenAt: sessions?.lastSeenAt ?? null },
    counts: {
      photos: Object.fromEntries(photos.map((p) => [p.status, p.n])) as Record<string, number>,
      rolls: rolls?.n ?? 0,
      groups: groups?.n ?? 0,
      moments: moments?.n ?? 0,
      reportsFiled: (filed?.n ?? 0) + (filedPhotos?.n ?? 0),
      incidents: incidents?.n ?? 0,
      flags: flags?.n ?? 0,
    },
    reportsAbout: [
      ...aboutWords.map((r) => ({ source: 'content' as const, ...r })),
      ...aboutPhotos.map((r) => ({ source: 'photo' as const, targetKind: 'photo', ...r })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    suspensions,
    staffActions,
  };
}

/**
 * Suspend somebody. Signs them out everywhere at once — `resolveSession`
 * stops resolving their sessions — and refuses them at sign-in until lifted.
 *
 * Their photos, messages and rolls stay: a suspension is about the person, and
 * what they left is taken down item by item through the reports, so each
 * removal is a decision rather than a side effect.
 */
export async function suspend(db: Db, staff: string, input: { actorId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ id: schema.actors.id, mergedIntoId: schema.actors.mergedIntoId })
      .from(schema.actors)
      .where(eq(schema.actors.id, input.actorId));
    if (!actor) throw new AdminConflict('not_found');
    // A tombstone signs nobody in; the person is whoever it was merged into.
    if (actor.mergedIntoId) throw new AdminConflict('merged');

    const [active] = await tx
      .select({ id: schema.suspensions.id })
      .from(schema.suspensions)
      .where(and(eq(schema.suspensions.actorId, input.actorId), isNull(schema.suspensions.liftedAt)));
    if (active) throw new AdminConflict('already_suspended');

    await tx.insert(schema.suspensions).values({
      actorId: input.actorId,
      reason: input.reason,
      suspendedBy: staff,
    });
    await tx.insert(schema.staffActions).values({
      staff,
      action: 'suspended',
      targetKind: 'actor',
      targetId: input.actorId,
      note: input.reason,
    });
  });
}

/** Lift it. Their sessions resolve again; nobody has to sign in twice. */
export async function liftSuspension(db: Db, staff: string, input: { actorId: string; note: string }) {
  return db.transaction(async (tx) => {
    const lifted = await tx
      .update(schema.suspensions)
      .set({ liftedAt: new Date(), liftedBy: staff, liftNote: input.note })
      .where(and(eq(schema.suspensions.actorId, input.actorId), isNull(schema.suspensions.liftedAt)))
      .returning({ id: schema.suspensions.id });
    if (!lifted.length) throw new AdminConflict('not_suspended');
    await tx.insert(schema.staffActions).values({
      staff,
      action: 'suspension_lifted',
      targetKind: 'actor',
      targetId: input.actorId,
      note: input.note,
    });
  });
}
