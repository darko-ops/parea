/**
 * Reporting anything that is not a roll photo — M11.
 *
 * Photos had a report button from the start; moments, comments, messages,
 * profiles and groups had none, so the only way to flag a threatening message
 * was to leave. Each kind of thing is looked up here with the question "may
 * this person see it", because reporting is not a way to learn whether a row
 * exists, and with "whose is it", so a reviewer can act without re-deriving it.
 */

import { alertReport, schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';

import { decide, findEventById } from './access';
import type { Db } from './db';
import { membershipOf } from './groups';
import { canSeeMoment } from './moments';
import { requesterFor } from './session';

export const TARGET_KINDS = [
  'moment',
  'moment_comment',
  'event_message',
  'group_message',
  'profile',
  'group',
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const REPORT_KINDS = ['abuse', 'other', 'child_safety'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isTargetKind(value: unknown): value is TargetKind {
  return typeof value === 'string' && (TARGET_KINDS as readonly string[]).includes(value);
}

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && (REPORT_KINDS as readonly string[]).includes(value);
}

/**
 * Whose the thing is, if this viewer can see it; null if either answer is no.
 *
 * `{ subject: null }` is a found target with nobody to name — a group.
 */
export async function resolveTarget(
  db: Db,
  kind: TargetKind,
  id: string,
  viewer: string,
): Promise<{ subject: string | null } | null> {
  switch (kind) {
    case 'moment': {
      const [row] = await db
        .select({ author: schema.moments.actorId })
        .from(schema.moments)
        .where(eq(schema.moments.id, id))
        .limit(1);
      if (!row || !(await canSeeMoment(db, viewer, id))) return null;
      return { subject: row.author };
    }
    case 'moment_comment': {
      const [row] = await db
        .select({ author: schema.momentComments.actorId, momentId: schema.momentComments.momentId })
        .from(schema.momentComments)
        .where(eq(schema.momentComments.id, id))
        .limit(1);
      if (!row || !(await canSeeMoment(db, viewer, row.momentId))) return null;
      return { subject: row.author };
    }
    case 'event_message': {
      const [row] = await db
        .select({ author: schema.eventMessages.authorActorId, eventId: schema.eventMessages.eventId })
        .from(schema.eventMessages)
        .where(and(eq(schema.eventMessages.id, id), isNull(schema.eventMessages.deletedAt)))
        .limit(1);
      if (!row) return null;
      const event = await findEventById(db, row.eventId);
      if (!event) return null;
      const allowed = await decide(db, event, 'view', await requesterFor(event.id));
      return allowed.allow ? { subject: row.author } : null;
    }
    case 'group_message': {
      const [row] = await db
        .select({ author: schema.groupMessages.authorActorId, groupId: schema.groupMessages.groupId })
        .from(schema.groupMessages)
        .where(and(eq(schema.groupMessages.id, id), isNull(schema.groupMessages.deletedAt)))
        .limit(1);
      if (!row || !(await membershipOf(db, row.groupId, viewer))) return null;
      return { subject: row.author };
    }
    case 'profile': {
      const [row] = await db
        .select({ id: schema.actors.id })
        .from(schema.actors)
        .where(eq(schema.actors.id, id))
        .limit(1);
      return row ? { subject: row.id } : null;
    }
    case 'group': {
      const [row] = await db
        .select({ findable: schema.groups.findable })
        .from(schema.groups)
        .where(and(eq(schema.groups.id, id), isNull(schema.groups.deletedAt)))
        .limit(1);
      if (!row) return null;
      if (!row.findable && !(await membershipOf(db, id, viewer))) return null;
      return { subject: null };
    }
  }
}

/** Files the report and says so to whoever reviews them. */
export async function fileReport(
  db: Db,
  input: {
    targetKind: TargetKind;
    targetId: string;
    subject: string | null;
    reporter: string;
    kind: ReportKind;
    note: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(schema.contentReports)
    .values({
      targetKind: input.targetKind,
      targetId: input.targetId,
      subjectActorId: input.subject,
      reporterActorId: input.reporter,
      kind: input.kind,
      note: input.note,
    })
    .returning({ id: schema.contentReports.id });
  await alertReport({
    reportId: row!.id,
    target: input.targetKind,
    targetId: input.targetId,
    kind: input.kind,
  });
  return row!.id;
}
