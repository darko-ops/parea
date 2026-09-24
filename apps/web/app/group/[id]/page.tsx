import { notFound } from 'next/navigation';

import { GroupView, type GroupTab } from '@/../app/components/GroupView';
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
 * A group — the running archive, for members. Non-members get the door, and
 * only if the group is findable; otherwise it is indistinguishable from a
 * group that does not exist.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: asked } = await searchParams;
  /*
   * Which pane, out of the URL rather than out of state.
   *
   * The album's three tabs do the same: a link to the room's people is a link
   * somebody can send, and Back is the way out of it. Anything unrecognised
   * falls to the albums rather than 404ing — a stale `?tab=archive` in
   * somebody's history should open the room, not refuse it.
   */
  const tab: GroupTab = asked === 'chat' || asked === 'people' ? asked : 'albums';
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
  const [events, people] =
    membership && since
      ? await Promise.all([
          groupArchive(db, group.id, actorId, since),
          groupPeople(db, group.id),
        ])
      : [[], []];

  return (
    <Shell current="groups">
      <GroupView
        tab={tab}
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
          events,
          people,
          lens: lensFor(group.id),
          /*
           * Formatted here rather than in the browser.
           *
           * Two clocks, one of them somebody's laptop: a date worked out in
           * the browser can disagree with the one the HTML was rendered
           * against, and React answers a text mismatch by throwing the tree
           * away. The month headings this used to sit beside are gone — every
           * tile carries its own date now, which is what they were saying.
           */
          dates: Object.fromEntries(
            events.map((event) => [event.id, DAY.format(new Date(event.at))]),
          ),
        }}
      />
    </Shell>
  );
}
