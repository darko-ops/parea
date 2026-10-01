/**
 * The admin API — what the hub may ask Parea, and what it may do.
 *
 * docs/design.md said there was no admin authentication in this product and
 * that inventing one so a dashboard could exist was a larger surface than it
 * was worth. That still holds for a dashboard *inside* Parea. What exists
 * instead is a separate app, the hub, behind its own sign-in (Cloudflare
 * Access), which calls these routes server to server. Parea never shows an
 * admin page and never signs a member of staff in.
 *
 * ## Two keys, both required
 *
 * - `ADMIN_API_TOKEN` — the bearer token only the hub holds. Absent, or wrong,
 *   and every admin route answers 404, the way the cron routes hide.
 * - `ADMIN_STAFF` — a comma-separated list of the emails allowed to act. The
 *   hub names the person on every request (`x-parea-staff`), and a name not on
 *   the list is refused even with the right token. A leaked token alone
 *   cannot act as somebody who was never staff, and removing someone here
 *   takes effect without touching the hub.
 *
 * ## What it will not do
 *
 * Return an image, a storage key, or a URL that renders one. The runbook's
 * first rule for a child-safety alert is not to open the image, and an API
 * that could serve one would make following it a matter of discipline. An
 * incident comes back as identifiers, a hash and a classification — what a
 * report to NCMEC needs — and nothing else.
 *
 * One exception, and it is narrow: reviewing a classifier flag can need a
 * look, so `src/adminReveal.ts` hands out a short-lived link to one flagged
 * photo at a time — recorded first, and never for a photo under a
 * child-safety hold.
 *
 * Every action is written to `staff_action` in the same transaction as the
 * change, so there is no change without a record of who made it.
 */

import { preservationHold, recordModeration, REASON, schema } from '@parea/core';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import type { Db } from './db';
import { takeDown, type TakeDownKind } from './removal';
import { quarantinePhoto } from './safety';
import { hoursLeft, stageFor } from './reportDeadline';

export const STAFF_HEADER = 'x-parea-staff';

function staffList(): Set<string> {
  return new Set(
    (process.env.ADMIN_STAFF ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The staff email this request acts for, or the response that refuses it.
 *
 * Every route under `app/api/admin` starts here; `access-chokepoint.test.ts`
 * checks that they do.
 */
export function adminGuard(request: Request): string | Response {
  const token = process.env.ADMIN_API_TOKEN?.trim();
  const notFound = NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Too short to be a real secret is the same as not configured.
  if (!token || token.length < 32) return notFound;

  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), token)) return notFound;

  const staff = request.headers.get(STAFF_HEADER)?.trim().toLowerCase();
  if (!staff || !staffList().has(staff)) {
    return NextResponse.json({ error: 'not_staff' }, { status: 403 });
  }
  return staff;
}

export class AdminConflict extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** For the routes: a conflict is a 409 with its code, a missing row a 404. */
export function adminError(err: unknown): Response {
  if (err instanceof AdminConflict) {
    return NextResponse.json({ error: err.code }, { status: err.code === 'not_found' ? 404 : 409 });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Reading

export async function overview(db: Db, now = new Date()) {
  const count = sql<number>`count(*)::int`;

  const incidents = await db
    .select({ detectedAt: schema.safetyIncidents.detectedAt })
    .from(schema.safetyIncidents)
    .where(and(isNull(schema.safetyIncidents.reportedAt), isNull(schema.safetyIncidents.releasedAt)));

  const [photoReports] = await db
    .select({ n: count })
    .from(schema.reports)
    .where(and(eq(schema.reports.status, 'open'), ne(schema.reports.kind, 'removal_request')));
  const [removalRequests] = await db
    .select({ n: count })
    .from(schema.reports)
    .where(and(eq(schema.reports.status, 'open'), eq(schema.reports.kind, 'removal_request')));
  const [contentReports] = await db
    .select({ n: count })
    .from(schema.contentReports)
    .where(eq(schema.contentReports.status, 'open'));
  const [flags] = await db
    .select({ n: count })
    .from(schema.moderationFlags)
    .where(eq(schema.moderationFlags.status, 'open'));

  return {
    incidents: {
      open: incidents.length,
      overdue: incidents.filter((i) => stageFor(i.detectedAt, now) === 'overdue').length,
      soonestHoursLeft: incidents.length
        ? Math.min(...incidents.map((i) => hoursLeft(i.detectedAt, now)))
        : null,
    },
    reports: {
      photo: photoReports?.n ?? 0,
      content: contentReports?.n ?? 0,
    },
    // Hosts answer these; shown so a pile-up is visible, not to be acted on.
    removalRequests: removalRequests?.n ?? 0,
    flags: flags?.n ?? 0,
  };
}

/** Every incident, newest first: open ones carry their clock. */
export async function listIncidents(db: Db, now = new Date()) {
  const rows = await db
    .select({
      id: schema.safetyIncidents.id,
      subject: schema.safetyIncidents.subject,
      subjectId: schema.safetyIncidents.subjectId,
      photoId: schema.safetyIncidents.photoId,
      eventId: schema.safetyIncidents.eventId,
      uploaderActorId: schema.safetyIncidents.uploaderActorId,
      provider: schema.safetyIncidents.provider,
      classification: schema.safetyIncidents.classification,
      providerReference: schema.safetyIncidents.providerReference,
      contentHash: schema.safetyIncidents.contentHash,
      detectedAt: schema.safetyIncidents.detectedAt,
      reportedAt: schema.safetyIncidents.reportedAt,
      reportReference: schema.safetyIncidents.reportReference,
      preservationEndsAt: schema.safetyIncidents.preservationEndsAt,
      releasedAt: schema.safetyIncidents.releasedAt,
      notes: schema.safetyIncidents.notes,
    })
    .from(schema.safetyIncidents)
    .orderBy(desc(schema.safetyIncidents.detectedAt))
    .limit(200);

  return rows.map(({ contentHash, ...row }) => {
    const open = !row.reportedAt && !row.releasedAt;
    const left = open ? hoursLeft(row.detectedAt, now) : null;
    return {
      ...row,
      contentHash: contentHash ? Buffer.from(contentHash).toString('hex') : null,
      state: row.releasedAt ? 'released' : row.reportedAt ? 'filed' : 'open',
      hoursLeft: left,
      // For display, not for reminders: `stageFor` answers "remind now?",
      // which is a different question from "how worried should this look".
      urgency: left === null ? null : left <= 0 ? 'overdue' : left <= 24 ? 'urgent' : 'due',
    };
  });
}

async function namesOf(db: Db, ids: (string | null)[]): Promise<Map<string, string | null>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: schema.actors.id, displayName: schema.actors.displayName, handle: schema.actors.handle })
    .from(schema.actors)
    .where(inArray(schema.actors.id, wanted));
  return new Map(rows.map((r) => [r.id, r.handle ? `@${r.handle}` : r.displayName]));
}

/**
 * The words that were reported, where the thing reported is words.
 *
 * A moment is a picture and comes back without one; a reviewer who needs to
 * see it goes to it in the product as anybody would.
 */
async function excerptOf(db: Db, kind: string, id: string): Promise<string | null> {
  switch (kind) {
    case 'event_message': {
      const [row] = await db
        .select({ body: schema.eventMessages.body })
        .from(schema.eventMessages)
        .where(eq(schema.eventMessages.id, id));
      return row?.body ?? null;
    }
    case 'group_message': {
      const [row] = await db
        .select({ body: schema.groupMessages.body })
        .from(schema.groupMessages)
        .where(eq(schema.groupMessages.id, id));
      return row?.body ?? null;
    }
    case 'moment_comment': {
      const [row] = await db
        .select({ body: schema.momentComments.body })
        .from(schema.momentComments)
        .where(eq(schema.momentComments.id, id));
      return row?.body ?? null;
    }
    case 'group': {
      const [row] = await db
        .select({ name: schema.groups.name })
        .from(schema.groups)
        .where(eq(schema.groups.id, id));
      return row?.name ?? null;
    }
    case 'profile': {
      const [row] = await db
        .select({ displayName: schema.actors.displayName, handle: schema.actors.handle })
        .from(schema.actors)
        .where(eq(schema.actors.id, id));
      return row ? [row.displayName, row.handle && `@${row.handle}`].filter(Boolean).join(' ') : null;
    }
    default:
      return null;
  }
}

/**
 * Open reports that come to Parea rather than to a host.
 *
 * Removal requests are left out: they are the host's to answer, with their
 * own clock, and `overview` counts them.
 */
export async function listReports(db: Db) {
  const photo = await db
    .select({
      id: schema.reports.id,
      kind: schema.reports.kind,
      note: schema.reports.note,
      createdAt: schema.reports.createdAt,
      reporterActorId: schema.reports.reporterActorId,
      photoId: schema.photos.id,
      photoStatus: schema.photos.status,
      eventId: schema.events.id,
      eventName: schema.events.name,
      uploaderActorId: schema.photos.uploaderId,
    })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    .innerJoin(schema.events, eq(schema.photos.eventId, schema.events.id))
    .where(and(eq(schema.reports.status, 'open'), ne(schema.reports.kind, 'removal_request')))
    .orderBy(desc(schema.reports.createdAt))
    .limit(200);

  const content = await db
    .select()
    .from(schema.contentReports)
    .where(eq(schema.contentReports.status, 'open'))
    .orderBy(desc(schema.contentReports.createdAt))
    .limit(200);

  const names = await namesOf(db, [
    ...photo.flatMap((r) => [r.reporterActorId, r.uploaderActorId]),
    ...content.flatMap((r) => [r.reporterActorId, r.subjectActorId]),
  ]);
  const name = (id: string | null) => (id ? names.get(id) ?? null : null);

  return {
    photo: photo.map((r) => ({
      source: 'photo' as const,
      ...r,
      reporterName: name(r.reporterActorId),
      uploaderName: name(r.uploaderActorId),
    })),
    content: await Promise.all(
      content.map(async (r) => ({
        source: 'content' as const,
        id: r.id,
        kind: r.kind,
        note: r.note,
        createdAt: r.createdAt,
        targetKind: r.targetKind,
        targetId: r.targetId,
        excerpt: await excerptOf(db, r.targetKind, r.targetId),
        subjectActorId: r.subjectActorId,
        subjectName: name(r.subjectActorId),
        reporterActorId: r.reporterActorId,
        reporterName: name(r.reporterActorId),
      })),
    ),
  };
}

/**
 * Open classifier flags, most confident first.
 *
 * What the classifier said and where the photo is — never the photo. Seeing
 * it is a separate, recorded request (`src/adminReveal.ts`), because most
 * flags are swimwear and most reviews should not need to look.
 */
export async function listFlags(db: Db) {
  const rows = await db
    .select({
      id: schema.moderationFlags.id,
      provider: schema.moderationFlags.provider,
      labels: schema.moderationFlags.labels,
      score: schema.moderationFlags.score,
      createdAt: schema.moderationFlags.createdAt,
      photoId: schema.photos.id,
      photoStatus: schema.photos.status,
      photoDeleted: schema.photos.deletedAt,
      eventId: schema.events.id,
      eventName: schema.events.name,
      uploaderActorId: schema.photos.uploaderId,
    })
    .from(schema.moderationFlags)
    .innerJoin(schema.photos, eq(schema.moderationFlags.photoId, schema.photos.id))
    .innerJoin(schema.events, eq(schema.moderationFlags.eventId, schema.events.id))
    .where(eq(schema.moderationFlags.status, 'open'))
    .orderBy(desc(sql`coalesce(${schema.moderationFlags.score}, 0)`), schema.moderationFlags.createdAt)
    .limit(200);

  const names = await namesOf(db, rows.map((r) => r.uploaderActorId));
  return rows.map(({ photoDeleted, ...r }) => ({
    ...r,
    labels: r.labels.split(',').map((l) => l.trim()).filter(Boolean),
    uploaderName: names.get(r.uploaderActorId) ?? null,
    // Only a photo still shown can be looked at or acted on; anything else is
    // already out of sight and its flag can simply be cleared.
    shown: r.photoStatus === 'ready' && !photoDeleted,
  }));
}

/** What staff have done, newest first. */
export async function listStaffActions(db: Db, limit = 100) {
  return db
    .select()
    .from(schema.staffActions)
    .orderBy(desc(schema.staffActions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

// ---------------------------------------------------------------------------
// Acting

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function record(
  tx: Tx,
  entry: { staff: string; action: string; targetKind: string; targetId: string; note?: string | null },
) {
  await tx.insert(schema.staffActions).values({ ...entry, note: entry.note ?? null });
}

/**
 * Close a report as needing nothing done.
 *
 * Declining changes no visibility: abuse and other reports never hid
 * anything. A child-safety report about a photo is not declined here at all —
 * it opened an incident and quarantined the photo, and the incident is where
 * that decision is made (`releaseIncident`). A child-safety report about
 * words has no incident, so it can be declined, but only with a reason.
 */
export async function declineReport(
  db: Db,
  staff: string,
  input: { source: 'photo' | 'content'; id: string; note: string | null },
) {
  return db.transaction(async (tx) => {
    if (input.source === 'photo') {
      const [report] = await tx
        .select({ kind: schema.reports.kind, status: schema.reports.status })
        .from(schema.reports)
        .where(eq(schema.reports.id, input.id));
      if (!report || report.kind === 'removal_request' || report.status !== 'open') {
        throw new AdminConflict('not_found');
      }
      if (report.kind === 'child_safety') throw new AdminConflict('use_incident');

      const [claimed] = await tx
        .update(schema.reports)
        .set({ status: 'declined', resolvedAt: new Date() })
        .where(and(eq(schema.reports.id, input.id), eq(schema.reports.status, 'open')))
        .returning({ id: schema.reports.id });
      if (!claimed) throw new AdminConflict('not_found');
      await record(tx, { staff, action: 'report_declined', targetKind: 'report', targetId: input.id, note: input.note });
      return;
    }

    const [report] = await tx
      .select({ kind: schema.contentReports.kind, status: schema.contentReports.status })
      .from(schema.contentReports)
      .where(eq(schema.contentReports.id, input.id));
    if (!report || report.status !== 'open') throw new AdminConflict('not_found');
    if (report.kind === 'child_safety' && !input.note) throw new AdminConflict('note_required');

    const [claimed] = await tx
      .update(schema.contentReports)
      .set({ status: 'declined', resolvedAt: new Date() })
      .where(and(eq(schema.contentReports.id, input.id), eq(schema.contentReports.status, 'open')))
      .returning({ id: schema.contentReports.id });
    if (!claimed) throw new AdminConflict('not_found');
    await record(tx, {
      staff,
      action: 'report_declined',
      targetKind: 'content_report',
      targetId: input.id,
      note: input.note,
    });
  });
}

/**
 * Take down what a report is about, and close every open report on it.
 *
 * The removal itself is `takeDown`, which goes through the same code the
 * author's own delete does. What this adds is the staff half: the report and
 * any others on the same thing are marked actioned, the visibility change of
 * a photo is written to `moderation_action` with a null actor and the
 * `staff_removed` reason, and `staff_action` names who — against the thing
 * removed, so "who took this down" is one lookup.
 *
 * Something already gone (its author deleted it while the report waited)
 * still closes the reports as actioned: the outcome the reporter wanted
 * happened, and declining would say otherwise.
 *
 * Storage goes after the transaction commits, so a removal that rolls back
 * has not already deleted anything.
 */
export async function removeContent(
  db: Db,
  staff: string,
  input: { source: 'photo' | 'content'; id: string; note: string | null },
): Promise<{ alreadyGone: boolean }> {
  let after: (() => Promise<void>) | null = null;

  const outcome = await db.transaction(async (tx) => {
    const now = new Date();
    let kind: TakeDownKind;
    let targetId: string;

    if (input.source === 'photo') {
      const [report] = await tx
        .select({ kind: schema.reports.kind, status: schema.reports.status, photoId: schema.reports.photoId })
        .from(schema.reports)
        .where(eq(schema.reports.id, input.id));
      if (!report || report.kind === 'removal_request' || report.status !== 'open') {
        throw new AdminConflict('not_found');
      }
      if (report.kind === 'child_safety') throw new AdminConflict('use_incident');
      kind = 'photo';
      targetId = report.photoId;
    } else {
      const [report] = await tx
        .select({
          status: schema.contentReports.status,
          targetKind: schema.contentReports.targetKind,
          targetId: schema.contentReports.targetId,
        })
        .from(schema.contentReports)
        .where(eq(schema.contentReports.id, input.id));
      if (!report || report.status !== 'open') throw new AdminConflict('not_found');
      kind = report.targetKind;
      targetId = report.targetId;
    }

    const taken = await takeDown(tx as unknown as Db, kind, targetId);
    if (taken.result === 'under_review') throw new AdminConflict('under_review');

    if (kind === 'photo') {
      await tx
        .update(schema.reports)
        .set({ status: 'actioned', resolvedAt: now })
        .where(
          and(
            eq(schema.reports.photoId, targetId),
            eq(schema.reports.status, 'open'),
            inArray(schema.reports.kind, ['abuse', 'other']),
          ),
        );
    } else {
      await tx
        .update(schema.contentReports)
        .set({ status: 'actioned', resolvedAt: now })
        .where(
          and(
            eq(schema.contentReports.targetKind, kind),
            eq(schema.contentReports.targetId, targetId),
            eq(schema.contentReports.status, 'open'),
          ),
        );
    }

    if (taken.result === 'removed' && taken.photo) {
      await recordModeration(tx, {
        photoId: taken.photo.id,
        eventId: taken.photo.eventId,
        action: 'removed',
        actorId: null,
        reason: REASON.staffRemoved,
      });
    }

    const alreadyGone = taken.result === 'already_gone';
    await record(tx, {
      staff,
      action: alreadyGone ? 'content_already_gone' : 'content_removed',
      targetKind: kind,
      targetId,
      note: [`report ${input.id}`, input.note].filter(Boolean).join(' — '),
    });

    if (taken.result === 'removed') after = taken.after;
    return { alreadyGone };
  });

  if (after) await (after as () => Promise<void>)();
  return outcome;
}

async function openFlag(tx: Tx, id: string) {
  const [flag] = await tx
    .select({ photoId: schema.moderationFlags.photoId, status: schema.moderationFlags.status })
    .from(schema.moderationFlags)
    .where(eq(schema.moderationFlags.id, id));
  if (!flag || flag.status !== 'open') throw new AdminConflict('not_found');
  return flag;
}

/** Every open flag on this photo, closed together: they are one question. */
async function closeFlags(tx: Tx, photoId: string, status: 'cleared' | 'actioned') {
  await tx
    .update(schema.moderationFlags)
    .set({ status, resolvedAt: new Date() })
    .where(and(eq(schema.moderationFlags.photoId, photoId), eq(schema.moderationFlags.status, 'open')));
}

/**
 * Answer a classifier flag.
 *
 * - `clear` — a person looked and it is fine. Nothing changes but the flag.
 * - `remove` — explicit content that does not belong: taken down exactly as a
 *   reported photo is (`takeDown`), with any open abuse reports on it closed.
 * - `escalate` — it looked like a child. Down the same path a person's
 *   child-safety report takes: quarantined, an incident opened with provider
 *   `staff_review`, the responder woken. From then on the incident decides,
 *   on the 72-hour clock.
 *
 * A flag on a photo already out of sight can only be cleared.
 */
export async function answerFlag(
  db: Db,
  staff: string,
  input: { id: string; action: 'clear' | 'remove' | 'escalate'; note: string | null },
): Promise<{ incidentId?: string }> {
  let after: (() => Promise<void>) | null = null;

  const outcome = await db.transaction(async (tx) => {
    const flag = await openFlag(tx, input.id);
    const note = [`flag ${input.id}`, input.note].filter(Boolean).join(' — ');

    if (input.action === 'clear') {
      await closeFlags(tx, flag.photoId, 'cleared');
      await record(tx, { staff, action: 'flag_cleared', targetKind: 'photo', targetId: flag.photoId, note });
      return {};
    }

    const [photo] = await tx.select().from(schema.photos).where(eq(schema.photos.id, flag.photoId));
    if (!photo || photo.status !== 'ready' || photo.deletedAt) throw new AdminConflict('not_shown');

    if (input.action === 'remove') {
      const taken = await takeDown(tx as unknown as Db, 'photo', photo.id);
      if (taken.result !== 'removed') throw new AdminConflict('not_shown');
      await tx
        .update(schema.reports)
        .set({ status: 'actioned', resolvedAt: new Date() })
        .where(
          and(
            eq(schema.reports.photoId, photo.id),
            eq(schema.reports.status, 'open'),
            inArray(schema.reports.kind, ['abuse', 'other']),
          ),
        );
      await recordModeration(tx, {
        photoId: photo.id,
        eventId: photo.eventId,
        action: 'removed',
        actorId: null,
        reason: REASON.staffRemoved,
      });
      await closeFlags(tx, photo.id, 'actioned');
      await record(tx, { staff, action: 'content_removed', targetKind: 'photo', targetId: photo.id, note });
      after = taken.after;
      return {};
    }

    const incidentId = await quarantinePhoto(tx as unknown as Db, photo, photo.eventId, {
      actorId: null,
      provider: 'staff_review',
      classification: 'escalated_from_classifier',
      reason: REASON.staffEscalated,
    });
    await closeFlags(tx, photo.id, 'actioned');
    await record(tx, { staff, action: 'flag_escalated', targetKind: 'photo', targetId: photo.id, note });
    return { incidentId };
  });

  if (after) await (after as () => Promise<void>)();
  return outcome;
}

/**
 * The incident was reported to NCMEC (or through PhotoDNA): step 4 of the
 * runbook, which used to be an UPDATE by hand.
 *
 * Setting `reported_at` starts the preservation clock, so `preservation_ends_at`
 * is set from it here — the purge job reads that column, and left null the
 * hold would never end.
 */
export async function fileIncident(db: Db, staff: string, input: { id: string; reference: string; note: string | null }) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [filed] = await tx
      .update(schema.safetyIncidents)
      .set({
        reportedAt: now,
        reportReference: input.reference,
        preservationEndsAt: preservationHold(now),
      })
      .where(
        and(
          eq(schema.safetyIncidents.id, input.id),
          isNull(schema.safetyIncidents.reportedAt),
          isNull(schema.safetyIncidents.releasedAt),
        ),
      )
      .returning({ id: schema.safetyIncidents.id });
    if (!filed) throw await incidentConflict(tx, input.id);
    await record(tx, {
      staff,
      action: 'incident_filed',
      targetKind: 'safety_incident',
      targetId: input.id,
      note: [`reference ${input.reference}`, input.note].filter(Boolean).join(' — '),
    });
  });
}

/**
 * A person has confirmed it is not what it was flagged as: step 5.
 *
 * Lifts the hold, so the photo returns to ordinary handling — it stays
 * quarantined and the purge job removes it on its usual schedule. A reason is
 * required, as the runbook asks. An incident already filed cannot be
 * released: once reported, preservation is a legal duty, not a judgement.
 */
export async function releaseIncident(db: Db, staff: string, input: { id: string; note: string }) {
  return db.transaction(async (tx) => {
    const [released] = await tx
      .update(schema.safetyIncidents)
      .set({
        releasedAt: new Date(),
        notes: sql`concat_ws(E'\n', ${schema.safetyIncidents.notes}, ${`released by ${staff}: ${input.note}`}::text)`,
      })
      .where(
        and(
          eq(schema.safetyIncidents.id, input.id),
          isNull(schema.safetyIncidents.reportedAt),
          isNull(schema.safetyIncidents.releasedAt),
        ),
      )
      .returning({ id: schema.safetyIncidents.id });
    if (!released) throw await incidentConflict(tx, input.id);
    await record(tx, {
      staff,
      action: 'incident_released',
      targetKind: 'safety_incident',
      targetId: input.id,
      note: input.note,
    });
  });
}

async function incidentConflict(tx: Tx, id: string): Promise<AdminConflict> {
  const [row] = await tx
    .select({ reportedAt: schema.safetyIncidents.reportedAt, releasedAt: schema.safetyIncidents.releasedAt })
    .from(schema.safetyIncidents)
    .where(eq(schema.safetyIncidents.id, id));
  if (!row) return new AdminConflict('not_found');
  return new AdminConflict(row.releasedAt ? 'already_released' : 'already_filed');
}
