/**
 * Hourly: any child-safety incident not yet reported, and how long is left.
 *
 * See `reportDeadline.ts` for the rule and why it is 72 hours. On Vercel
 * rather than on the Fly jobs machine because this is where the mailer and
 * `SAFETY_ALERT_EMAIL` are, and because a reminder that depends on the hourly
 * job being healthy would fail silently in the same outage the heartbeat
 * exists for.
 *
 * Identifiers only, never an image or a link that renders one — the rule the
 * detection alert follows, for the same reason.
 */

import * as Sentry from '@sentry/nextjs';
import { mailerFromEnv, schema } from '@parea/core';
import { and, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';
import { getDb } from '@/db';
import { hoursLeft, REPORT_WITHIN_HOURS, stageFor } from '@/reportDeadline';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const now = new Date();
  const open = await getDb()
    .select({
      id: schema.safetyIncidents.id,
      provider: schema.safetyIncidents.provider,
      classification: schema.safetyIncidents.classification,
      subject: schema.safetyIncidents.subject,
      detectedAt: schema.safetyIncidents.detectedAt,
    })
    .from(schema.safetyIncidents)
    .where(and(isNull(schema.safetyIncidents.reportedAt), isNull(schema.safetyIncidents.releasedAt)));

  const due = open
    .map((incident) => ({ ...incident, stage: stageFor(incident.detectedAt, now) }))
    .filter((incident) => incident.stage !== null);

  if (due.length === 0) return NextResponse.json({ open: open.length, reminded: 0 });

  const overdue = due.filter((i) => i.stage === 'overdue').length;
  const soonest = Math.min(...due.map((i) => hoursLeft(i.detectedAt, now)));
  const headline =
    overdue > 0
      ? `${overdue} child-safety ${overdue === 1 ? 'incident is' : 'incidents are'} past the ${REPORT_WITHIN_HOURS}-hour reporting deadline`
      : `${due.length} child-safety ${due.length === 1 ? 'incident' : 'incidents'} unreported — ${soonest} hours left`;

  const text = [
    headline + '.',
    '',
    ...due.map(
      (i) =>
        `${i.id}  ${i.subject}  found by ${i.provider}  detected ${i.detectedAt.toISOString()}  ` +
        (i.stage === 'overdue' ? 'OVERDUE' : `${hoursLeft(i.detectedAt, now)}h left`),
    ),
    '',
    'Each must be reported within 72 hours of detection (PhotoDNA agreement;',
    '18 U.S.C. §2258A), or released if a person has confirmed it is not what',
    'it was flagged as. Do not open the image. Steps: docs/csam-runbook.md,',
    '"If you get an alert". Then set reported_at and report_reference.',
  ].join('\n');

  Sentry.captureMessage(headline, {
    level: overdue > 0 ? 'fatal' : 'error',
    tags: { kind: 'safety_deadline' },
    extra: { incidents: due.map((i) => i.id) },
  });
  await Sentry.flush(2000).catch(() => false);

  const to = process.env.SAFETY_ALERT_EMAIL;
  if (to) {
    await mailerFromEnv()
      .send({ to, subject: `Parea URGENT: ${headline}`, text })
      .catch((err) => console.error('safety deadlines: alert email failed', err));
  } else {
    console.error(`SAFETY: ${headline}, and no SAFETY_ALERT_EMAIL is set to say so.`);
  }

  return NextResponse.json({ open: open.length, reminded: due.length, overdue });
}
