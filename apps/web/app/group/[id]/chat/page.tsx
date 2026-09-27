/**
 * A group's conversation, on a screen of its own.
 *
 * Opening a chat from Chat used to land on `/group/<id>?tab=chat` — the
 * room, with its crest, its three tabs and its albums, showing the Chat pane.
 * Which is the album view with a conversation inside it, and it made the page
 * a list of conversations open a page about a *group*. The app does not: its
 * Chats tab opens a thread screen directly, and the room is one press away
 * from the bar at the top of it.
 *
 * So this is that screen. The room's own Chat tab stays exactly where it is —
 * both draw the same `GroupChat`, which is the point of it being a component
 * rather than a page. What differs is what surrounds the conversation: here,
 * nothing but a bar naming the room and a way into it.
 *
 * Members only, and a non-member gets the 404 a nonexistent group gets rather
 * than the door. The door is a thing you knock on, which is `/group/<id>`; a
 * conversation has no such state, and answering "you may not read this" is a
 * sentence about a room that this screen would otherwise have to invent.
 */

import { notFound } from 'next/navigation';

import { GroupChatScreen } from '@/../app/components/GroupChatScreen';
import { Shell } from '@/../app/components/Shell';
import { getDb } from '@/db';
import { findGroup, groupEvents, lensFor, memberCount, membershipOf, roomOf } from '@/groups';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function GroupChatPage({
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
  if (!membership) notFound();

  /*
   * Enough to draw the bar, and no more.
   *
   * The app's note on the same screen is the argument: it took a whole group
   * summary and read four fields off it, which was fine while one screen ever
   * opened it. Asking for what is used lets the page fetch two counts instead
   * of a room.
   */
  const [people, albums, room] = await Promise.all([
    memberCount(db, group.id),
    groupEvents(db, group.id),
    // The title and the mark off one query — `titleOf` answered only the
    // first, and asking for the second separately is the same query twice for
    // one row. See `roomOf`.
    roomOf(db, group, actorId),
  ]);

  return (
    <Shell current="groups">
      <GroupChatScreen
        group={{
          id: group.id,
          name: room.title,
          memberCount: people,
          eventCount: albums.length,
          lens: lensFor(group.id),
          kind: room.kind,
          deck: room.deck,
        }}
      />
    </Shell>
  );
}
