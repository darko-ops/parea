import { notFound } from 'next/navigation';

import { GroupView } from '@/../app/components/GroupView';
import { getDb } from '@/db';
import { findGroup, groupEvents, memberCount, membershipOf, participatedInGroup } from '@/groups';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

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

  return (
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
        events: membership ? await groupEvents(db, group.id) : [],
      }}
    />
  );
}
