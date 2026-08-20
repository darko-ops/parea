import { notFound } from 'next/navigation';

import { GroupView } from '@/../app/components/GroupView';
import { getDb } from '@/db';
import {
  findGroup,
  groupArchive,
  groupPeople,
  lensFor,
  memberCount,
  membershipOf,
  participatedInGroup,
} from '@/groups';
import { invitesSeenAtFor } from '@/invites';
import { currentActorId } from '@/session';
import { Shell } from '@/../app/components/Shell';

export const dynamic = 'force-dynamic';

/**
 * Belt and braces with the `X-Robots-Tag` header in `next.config.ts`. The
 * header is the one that covers non-HTML responses and survives a crawler
 * finding the URL elsewhere; this one survives the headers not being applied,
 * which is a deployment property rather than a code one.
 */
export const metadata = { robots: { index: false, follow: false } };

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * Which month heading an album sits under.
 *
 * Computed here, in the same pass that formats the dates, for the reason
 * `activity.ts` gives about its day buckets: a boundary worked out in the
 * browser can disagree with the one the HTML was rendered against, and React
 * answers a text mismatch by throwing the tree away.
 *
 * "This month" for the current one, because that is what somebody calls it,
 * and the month's own name for everything before.
 */
function monthOf(iso: string, now: Date): string {
  const at = new Date(iso);
  return at.getUTCFullYear() === now.getUTCFullYear() &&
    at.getUTCMonth() === now.getUTCMonth()
    ? 'This month'
    : MONTH.format(at);
}

/**
 * A group — the running archive, for members. Non-members get the door, and
 * only if the group is findable; otherwise it is indistinguishable from a
 * group that does not exist.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const group = await findGroup(db, id);
  if (!group) notFound();

  const actorId = await currentActorId();
  const membership = await membershipOf(db, group.id, actorId);
  if (!membership && !group.findable) notFound();

  /*
   * Nothing from inside is fetched for somebody who is not in the group.
   *
   * Not fetched-and-hidden: the door has to be unable to leak rather than
   * merely choose not to, and a later change to the component cannot disclose
   * what was never handed to it.
   */
  // Null means never looked, which has to mean everything is new rather than
  // nothing — the epoch, not `now`.
  const since = membership ? ((await invitesSeenAtFor(db, actorId)) ?? new Date(0)) : null;
  const [albums, people] =
    membership && since
      ? await Promise.all([
          groupArchive(db, group.id, actorId, since),
          groupPeople(db, group.id),
        ])
      : [[], []];

  const now = new Date();

  /*
   * Contiguous runs of one month, in the order the albums already have.
   *
   * Contiguous rather than collected, like the activity feed's days: the list
   * is sorted newest-first by the query, so a month's albums are already
   * together. Grouping into a map would quietly reorder them if that stopped
   * being true; this way a mis-sorted list draws the same heading twice, which
   * is visibly wrong rather than silently rearranged.
   */
  const months: { label: string; ids: string[] }[] = [];
  for (const album of albums) {
    const label = monthOf(album.at, now);
    const last = months[months.length - 1];
    if (last && last.label === label) last.ids.push(album.id);
    else months.push({ label, ids: [album.id] });
  }

  return (
    <Shell current="groups">
      <GroupView
        group={{
          id: group.id,
          name: group.name,
          memberCount: await memberCount(db, group.id),
          member: membership !== null,
          role: membership?.role ?? null,
          canJoinDirectly:
            membership === null && actorId
              ? await participatedInGroup(db, group.id, actorId)
              : false,
          albums,
          people,
          lens: lensFor(group.id),
          months,
          // Formatted here rather than in the browser, for the reason the
          // month headings are: two clocks, one of them somebody's laptop.
          dates: Object.fromEntries(
            albums.map((album) => [album.id, DAY.format(new Date(album.at))]),
          ),
        }}
      />
    </Shell>
  );
}
