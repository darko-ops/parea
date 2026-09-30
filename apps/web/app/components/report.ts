/**
 * Saying "this is not OK" about anything that is not a roll photograph.
 *
 * One call for the six things `/api/reports` takes, so a message, a comment, a
 * moment, a profile and a group are reported the same way and answered in the
 * same words. The words are the photograph's own — see `DONE` in `PhotoView` —
 * because a report is the same act wherever it was made, and a second wording
 * of "someone will look at it" is a second promise.
 *
 * Photos keep their own route, which also carries removal requests.
 */

export type ReportTarget =
  | 'moment'
  | 'moment_comment'
  | 'event_message'
  | 'group_message'
  | 'profile'
  | 'group';

export type ReportResult =
  | { ok: true }
  | { ok: false; reason: 'sign_in' | 'too_many' | 'failed' };

export async function reportContent(
  targetKind: ReportTarget,
  targetId: string,
  kind: 'abuse' | 'other' | 'child_safety' = 'abuse',
): Promise<ReportResult> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetKind, targetId, kind }),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  if (res?.status === 401) return { ok: false, reason: 'sign_in' };
  if (res?.status === 429) return { ok: false, reason: 'too_many' };
  return { ok: false, reason: 'failed' };
}

/** What to put on the page afterwards. Said where the menu was, not a toast. */
export function reportSaid(result: ReportResult): string {
  if (result.ok) return 'Reported. Someone will look at it.';
  switch (result.reason) {
    case 'sign_in':
      return 'Sign in first. Reporting needs to know who is asking.';
    case 'too_many':
      return 'That is a lot at once. Wait a while and try again.';
    default:
      return 'That did not work. Try again.';
  }
}
