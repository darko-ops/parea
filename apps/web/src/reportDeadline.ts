/**
 * The clock on a child-safety incident — 72 hours to report.
 *
 * PhotoDNA is free on one condition, agreed on application: every match is
 * reported through its reporting API within 72 hours of the match, or the
 * service can be suspended. US law says "as soon as reasonably possible" and
 * this is the concrete number that makes it checkable. Reporting stays a
 * person's act (see docs/csam-runbook.md), so the product's job is to make
 * sure that person cannot forget: a reminder a day in, then every hour from
 * two days until `reported_at` is set, or the hold is released as a false
 * match.
 *
 * Every open incident, not only scanner matches: a quarantine from a user's
 * report also has to be reviewed and, if it is what it was reported as,
 * reported — on the same clock.
 */

export const REPORT_WITHIN_HOURS = 72;

export type DeadlineStage = 'first' | 'urgent' | 'overdue';

/**
 * What to say about an incident detected at `detectedAt`, when the check runs
 * hourly. Null means nothing yet: the responder was alerted at detection.
 *
 * `first` is a one-hour window so an hourly run says it once. From 48 hours it
 * says it every run, because by then quiet is the failure.
 */
export function stageFor(detectedAt: Date, now: Date): DeadlineStage | null {
  const hours = (now.getTime() - detectedAt.getTime()) / 3_600_000;
  if (hours >= REPORT_WITHIN_HOURS) return 'overdue';
  if (hours >= 48) return 'urgent';
  if (hours >= 24 && hours < 25) return 'first';
  return null;
}

export function hoursLeft(detectedAt: Date, now: Date): number {
  return Math.floor(REPORT_WITHIN_HOURS - (now.getTime() - detectedAt.getTime()) / 3_600_000);
}
