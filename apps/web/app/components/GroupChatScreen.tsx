/**
 * The bar over a group's conversation, and the conversation under it.
 *
 * The app's folded-up header, in the one place it still belongs. An album
 * stopped having two headers — its cover stays put across its three tabs — but
 * a group has no cover to keep: it is a room rather than an evening, and the
 * rule that a group's tile is a letter and never a photograph borrowed from
 * inside holds here as everywhere else.
 *
 * The whole block is the way into the room. Not a separate button beside the
 * name, which is the shape that asks somebody to notice a second control; the
 * name *is* the link, the way the person at the top of a message thread is the
 * way to their profile in every app anybody has used.
 *
 * A server component. It draws a bar out of props and hands the one client
 * thing on the page — the thread, which polls — to `GroupChat`.
 */

import { GroupChat } from './GroupChat';

export function GroupChatScreen({
  group,
}: {
  group: {
    id: string;
    name: string;
    memberCount: number;
    eventCount: number;
    lens: { fill: string; ink: string };
  };
}) {
  return (
    <main className="chat-screen">
      {/*
        Back to the conversations rather than to the room.

        This screen is reached from Chat, and the room is the thing the
        bar below goes to — a back arrow that landed there as well would make
        the two controls one control with a coin flip in it.
      */}
      <nav className="crumbs" aria-label="Where you are">
        <a href="/groups">Chat</a>
        <span aria-hidden="true">{'›'}</span>
        <span className="crumbs-here">{group.name}</span>
      </nav>

      <a className="chat-head" href={`/group/${group.id}`}>
        <span
          className="group-tile chat-head-tile"
          style={{ background: group.lens.fill, color: group.lens.ink }}
          aria-hidden="true"
        >
          {group.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <span className="chat-head-what">
          <span className="chat-head-name">{group.name}</span>
          {/*
            What the room is, in the line the app puts here: how many people
            and how many albums. Not what was last said — that is the list this
            screen was opened from, and repeating it at the top of the thread
            it belongs to is the page telling somebody what they just read.
          */}
          <span className="chat-head-meta">
            {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
            {group.eventCount > 0 &&
              ` · ${group.eventCount} ${group.eventCount === 1 ? 'album' : 'albums'}`}
          </span>
        </span>
        {/* Says where the block goes, because a whole header that happens to
            be a link is a link nobody is told about. */}
        <span className="chat-head-go" aria-hidden="true">
          {'›'}
        </span>
      </a>

      <GroupChat groupId={group.id} />
    </main>
  );
}
