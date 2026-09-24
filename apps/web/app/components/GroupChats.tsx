'use client';

/**
 * The group chats, and nothing else.
 *
 * This page was a list of *rooms*: a name, a stack of faces, a count of albums
 * and people, three covers and a `View all`. Around two hundred pixels a
 * group, so three of them filled a laptop screen — and the one line saying
 * what anybody had actually said was the last thing in each block, under the
 * furniture. The app went through the same thing and its note is the argument:
 * "the talk was underneath the furniture", and "a tab whose heading says GROUP
 * CHATS over a list containing none of them".
 *
 * So this is one list of conversations, the shape a chat list has everywhere:
 * a tile, a name, the last thing said, and when. The rooms have not gone
 * anywhere — Find lists the groups, and a group's own screen is still the
 * albums, the chat and the people. What moved is which of those this page is
 * about.
 *
 * ## Ordered by when somebody last spoke
 *
 * Not by `lastActiveAt`, which is when an album in the room was last added to.
 * That is the other page's subject: sorting a chat list by it puts a room
 * full of photographs and no conversation above the one two people are
 * talking in right now. A group nobody has spoken in has nothing to sort by
 * and goes last, behind every group that has — and it is still listed, because
 * a silent room is one you might be the first to say something in.
 *
 * ## `'use client'` for the field
 *
 * The filtering is local. Everything on this screen is already in the props by
 * the time it draws, so a round trip would cost the one thing that makes a
 * search field feel like one: that the list narrows while you type rather than
 * a moment after you stop.
 *
 * It reads what was *said* as well as the names. Somebody looking for a
 * conversation, on the page that is only conversations, is as likely to
 * remember a word out of it as the name of the room it happened in.
 */

import { useState } from 'react';

import { LeaveGroup } from './LeaveGroup';
import { SearchIcon } from './SearchIcon';

export type ChatRow = {
  id: string;
  name: string;
  /** The group's own colour, by a stable hash of the id — see `lensFor`. */
  lens: { fill: string; ink: string };
  /**
   * The last thing said in the room, or null for one nobody has spoken in.
   *
   * `when` is worded on the server, like every relative time in this product:
   * the two clocks disagree and React answers a text mismatch by throwing the
   * tree away.
   */
  last: {
    author: string;
    body: string;
    when: string;
    mine: boolean;
    /** The author's own colour, from the same `lensFor` the tiles use. */
    lens: { fill: string; ink: string };
  } | null;
  /** Posted since this reader last opened the thread. Zero draws no count. */
  unread: number;
};

/** The first letter, for a tile. Trimmed, because " dinner" has one. */
const initialOf = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

/*
 * Both colours arrive as props rather than being worked out here.
 *
 * `lensFor` lives in `groups.ts`, which is a server module — it reaches the
 * database on the way past, so a client component cannot import it. The
 * alternative was a second copy of the five-colour palette in this file, and
 * a second copy is how the same person comes to be pink in one list and green
 * in another: the app's own note about `lens.ts` says exactly this, after it
 * happened there.
 */

export function GroupChats({ chats }: { chats: ChatRow[] }) {
  const [query, setQuery] = useState('');

  const looking = query.trim().toLowerCase();
  const shown = chats.filter(
    (chat) =>
      !looking ||
      [chat.name, chat.last?.body, chat.last?.author].some((field) =>
        field?.toLowerCase().includes(looking),
      ),
  );

  return (
    <>
      {/*
        A field that is always a field, unlike Home's.

        Home's search is a button that opens: it shares a head with a greeting
        and a title and is one of two things somebody might do there. This one
        is the only control on the page and the list under it is what it acts
        on, so a control that has to be opened before it can be used is a step
        in front of the thing it does.
      */}
      <div className="chat-search">
        <SearchIcon size={17} />
        <input
          type="search"
          value={query}
          placeholder="Search chats"
          aria-label="Search chats"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="chat-list">
        {shown.map((chat) => (
          <li className="chat-item" key={chat.id}>
            {/*
              Straight to the conversation, on a screen of its own.

              It was `?tab=chat`, which is the room — crest, three tabs, its
              albums — showing the Chat pane. So a list of conversations opened
              a page about a group, with the talking inside it. The app's Chats
              tab opens a thread directly and puts the room one press away from
              the bar at the top of it, which is what `/chat` is.
            */}
            <a className="chat-row" href={`/group/${chat.id}/chat`}>
              {/*
                A letter on the group's own colour, never a photograph. A group
                has no picture of its own and the only ones available are
                inside albums that belong to it — putting one on the door shows
                something from a room on the way in to it.
              */}
              <span
                className="group-tile chat-tile"
                style={{ background: chat.lens.fill, color: chat.lens.ink }}
                aria-hidden="true"
              >
                {initialOf(chat.name)}
              </span>

              <span className="chat-what">
                <span className="chat-name">{chat.name}</span>
                {chat.last ? (
                  <span className={`chat-said${chat.unread > 0 ? ' chat-said-new' : ''}`}>
                    {/*
                      Who said it, as their own initial in their own colour —
                      the same hash the tiles use, so one person is one colour
                      wherever they turn up.
                    */}
                    <span
                      className="sayer-face"
                      style={{
                        background: chat.last.lens.fill,
                        color: chat.last.lens.ink,
                      }}
                      aria-hidden="true"
                    >
                      {initialOf(chat.last.author)}
                    </span>
                    {/* "You" rather than your own name read back at you, which
                        is what every card in this product does. */}
                    <span className="chat-sayer">
                      {chat.last.mine ? 'You' : chat.last.author}
                    </span>{' '}
                    <span className="chat-body">{chat.last.body}</span>
                  </span>
                ) : (
                  // Listed anyway. A room nobody has spoken in is one somebody
                  // might be the first to say something in, and leaving it out
                  // would make the list disagree with the rooms on Find.
                  <span className="chat-said chat-said-quiet">
                    Nobody has said anything yet.
                  </span>
                )}
              </span>

              <span className="chat-when">
                {chat.last && <span className="chat-ago">{chat.last.when}</span>}
                {/* A count rather than a dot: a group is busy, and the number
                    is the useful part. */}
                {chat.unread > 0 && <span className="badge">{chat.unread}</span>}
              </span>
            </a>

            {/*
              Leaving, from the list rather than only from inside — the rule
              this page already had, kept through the redraw. The thought
              arrives while looking at the rooms, and the old answer was "open
              the one you want out of, then find a menu".
            */}
            <LeaveGroup groupId={chat.id} name={chat.name} />
          </li>
        ))}
      </ul>

      {/*
        A search that matches nothing has to say so. A head, a field and an
        empty page reads as the page having failed to load rather than as an
        answer — and it says where the other kind of conversation is, because
        somebody searching here for a remark on a photograph will not find it.
      */}
      {looking !== '' && shown.length === 0 && (
        <p className="chat-none">
          No chat of yours matches “{query.trim()}”. This searches your groups —
          comments on photographs are on the album they belong to.
        </p>
      )}
    </>
  );
}
