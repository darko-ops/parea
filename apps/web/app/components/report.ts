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

/*
 * Blocking the person behind something, from wherever it was said.
 *
 * Beside Report because it is the other answer to the same moment — "this is
 * not OK" and "I do not want this person here" — and one call so a message, a
 * comment and a profile block the same way. The route works out whose it was;
 * the page only says which thing it was looking at.
 *
 * Photographs and moments keep their own calls, as they do for reports.
 */

export type BlockTarget =
  | { messageId: string }
  | { groupMessageId: string }
  | { momentCommentId: string }
  | { actorId: string };

export type BlockResult = { ok: true } | { ok: false; reason: 'self' | 'failed' };

export async function blockPerson(target: BlockTarget): Promise<BlockResult> {
  const res = await fetch('/api/blocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(target),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  if (res?.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'cannot_block_self') return { ok: false, reason: 'self' };
  }
  return { ok: false, reason: 'failed' };
}

/**
 * Who a block is about, in a sentence: their first name, or "this person".
 * A handle standing in for a name is still a name, without its `@`.
 */
export function blockName(name: string | null | undefined): string {
  const first = (name ?? '').replace(/^@/, '').trim().split(/\s+/)[0];
  return first || 'this person';
}

/** What a block costs, said before it is done. The same words on every surface. */
export function blockAsk(name: string): string {
  return `Block ${name}? You won't see each other's messages, photos, comments or albums, even in groups you share. They won't be told. You can undo this in Settings.`;
}

/** What to put on the page afterwards, where the control was. */
export function blockSaid(result: BlockResult): string {
  if (result.ok) return 'Blocked. You can undo this in Settings → Blocked.';
  if (result.reason === 'self') return 'That is you. There is nobody to block.';
  return 'That did not work. Try again.';
}
