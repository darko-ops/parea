'use client';

/**
 * The conversation about an event, beside the photographs it is about.
 *
 * The conversation already exists — in the group chat somebody pasted the link
 * into, where it is invisible to anyone who joined later and gone by next
 * year. This is the same conversation kept next to the thing it is about, so
 * that "whose is the one of the whole table?" is asked in front of the photo
 * rather than three apps away from it.
 *
 * One component for two shapes. On a wide screen it is a column beside the
 * grid; below the breakpoint it is a sheet that opens from a control in the
 * head. Both are this file because they are the same thread with the same
 * state — two components would be two composers, two optimistic append paths
 * and two places for the unread count to be wrong.
 *
 * Posting is `contribute`: the people who may add photographs. Everybody who
 * may see the event may read. That is not a new rule invented for messages, it
 * is the rule the event already had, which is the reason this feature is small
 * enough to be worth having.
 */

import { ago } from '@parea/cards';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Member } from '@/members';
import type { Message } from '@/messages';
// From `reactions.ts`, not `messages.ts`: this is a client component, and that
// module reads the database.
import { REACTIONS } from '@/reactions';

import { Face } from './Faces';
import { Mark } from './Mark';
import { Menu } from './Menu';
import { SignIn, useSession } from './SignIn';

type Person = { key: string; name: string; photoCount: number; mine: boolean };

export type ThreadProps = {
  eventId: string;
  messages: Message[];
  /** Whether this viewer may post — `contribute`, and signed in. */
  canPost: boolean;
  /** The event's contributors, for the mention list. Never anybody else. */
  people: Person[];
  /** Everybody in the event. Kept for the mention list's fallback names. */
  members: Member[];
  /** Re-fetches the feed, which carries the messages. */
  onChanged: () => void | Promise<void>;
  /**
   * Called when the thread has actually been read.
   *
   * The desktop column calls it on reaching the bottom of the list; the sheet
   * calls it on opening. Same rule the Invites badge follows — arriving is
   * what clears it, and a number still sitting there while you read the list
   * is a number describing a moment that has passed.
   */
  onSeen?: () => void;
};

/**
 * The album's conversation, as a pane of its own.
 *
 * It was a column beside the photographs — a third of the width on every
 * screen, whether anybody was talking or not — and a sheet on a phone, which
 * is one thread in two shapes with two ways to open and two ways to close.
 * Now it is a tab: full width when you are in it, and out of the way of the
 * pictures when you are not.
 *
 * Its own two tabs went with the column. "Chats" named the thing you were
 * looking at, and "Members" is now a pane of the page with room to say what
 * each person has put in.
 */
export function Thread({
  eventId,
  messages,
  canPost,
  people,
  members,
  onChanged,
  onSeen,
}: ThreadProps) {
  const session = useSession();
  /*
   * Two tabs, and the second one is a list rather than a conversation.
   *
   * Client state rather than a URL, unlike the Manage screen's tabs: those are
   * two pages of settings somebody might send to themselves, and this is a
   * column beside the photographs that comes back to the conversation the next
   * time the page loads. Nobody wants an album's link to open on its roster.
   */
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const live = messages.filter((m) => !m.deleted || m.body === '');

  /*
   * Stay at the bottom, but only if that is where you already were.
   *
   * A thread that scrolls itself down on every poll takes the screen away from
   * somebody reading back through it — which is exactly when a poll is most
   * likely to land, because they are not typing.
   */
  const atBottom = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !atBottom.current) return;
    list.scrollTop = list.scrollHeight;
    // Pinned to the bottom is the definition of having read it.
    onSeen?.();
  }, [messages.length, onSeen]);

  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(await explain(res));
      setDraft('');
      atBottom.current = true;
      await onChanged();
    } catch (err) {
      // The draft is left in the box. Losing what somebody typed because a
      // request failed is the failure mode this is written to avoid.
      setError(err instanceof Error ? err.message : 'Could not post that.');
    } finally {
      setPosting(false);
    }
  }, [draft, posting, eventId, onChanged]);

  const react = useCallback(
    async (id: string, emoji: string) => {
      await fetch(`/api/messages/${id}/reactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emoji }),
      }).catch(() => {});
      await onChanged();
    },
    [onChanged],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm('Delete this message? It leaves a gap saying it was deleted.')) return;
      await fetch(`/api/messages/${id}`, { method: 'DELETE' }).catch(() => {});
      await onChanged();
    },
    [onChanged],
  );

  const save = useCallback(
    async (id: string, body: string) => {
      const text = body.trim();
      if (!text) return;
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text }),
      }).catch(() => {});
      setEditing(null);
      await onChanged();
    },
    [onChanged],
  );

  return (
    <>
      <div
        className="thread-list"
        role="tabpanel"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (atBottom.current) onSeen?.();
        }}
      >
        {live.length === 0 && (
          /*
            An invitation rather than a report of emptiness. "Nothing said yet"
            describes the state somebody can already see; this says what the
            space is for, which is the only thing that turns an empty box into
            a first message.
          */
          <div className="thread-empty">
            <Mark size={48} />
            <h2>Talk about the moment</h2>
            <p>
              Ask for a missing photo, share what happened or let everyone know
              when you’ve added yours.
            </p>
          </div>
        )}

        {live.map((message) => (
          <Row
            key={message.id}
            message={message}
            canPost={canPost}
            editing={editing === message.id}
            onEdit={() => setEditing(message.id)}
            onCancelEdit={() => setEditing(null)}
            onSave={(body) => save(message.id, body)}
            onDelete={() => remove(message.id)}
            onReact={(emoji) => react(message.id, emoji)}
          />
        ))}
      </div>

      <div className="thread-composer">
        {canPost ? (
          <Composer
            draft={draft}
            setDraft={setDraft}
            people={people}
            posting={posting}
            error={error}
            onPost={post}
          />
        ) : session.known && !session.account ? (
          // The same treatment the upload path uses: sign in here, on the page,
          // rather than being sent away and losing what you were looking at.
          <SignIn
            why="Adding to the conversation needs an account. Reading it does not."
            onSignedIn={session.refresh}
          />
        ) : (
          <p className="muted thread-note">Only people who can add photos can post.</p>
        )}
      </div>
    </>
  );
}

function Composer({
  draft,
  setDraft,
  people,
  posting,
  error,
  onPost,
}: {
  draft: string;
  setDraft: (value: string) => void;
  people: Person[];
  posting: boolean;
  error: string | null;
  onPost: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);

  /*
   * The mention list, and the fragment it is completing.
   *
   * Only the contributors of this event, ever. A mention picker that reaches
   * anywhere else is a way to find out who exists by typing letters at it, and
   * this is the one text field in the product that a link-holder can use.
   */
  const mention = useMemo(() => {
    const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(draft);
    if (!match) return null;
    const term = match[1]!.toLowerCase();
    const found = people
      .filter((person) => !person.mine)
      .filter((person) => person.name.toLowerCase().replace(/^@/, '').startsWith(term))
      .slice(0, 5);
    return found.length > 0 ? { term: match[1]!, people: found } : null;
  }, [draft, people]);

  const complete = useCallback(
    (name: string) => {
      const clean = name.replace(/^@/, '');
      setDraft(draft.replace(/@[\p{L}\p{N}_-]*$/u, `@${clean} `));
      box.current?.focus();
    },
    [draft, setDraft],
  );

  /** Grows with the text rather than scrolling inside four lines. */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <>
      {mention && (
        <div className="mention-list">
          {mention.people.map((person) => (
            <button key={person.key} type="button" onClick={() => complete(person.name)}>
              {person.name}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={box}
        className="thread-field"
        rows={1}
        value={draft}
        placeholder="Message everyone in this album…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter posts, Shift+Enter is a new line. The opposite of a document
          // and the same as every other message box, which is what this is.
          if (e.key === 'Enter' && !e.shiftKey && !mention) {
            e.preventDefault();
            onPost();
          }
        }}
      />

      <div className="thread-actions">
        {/*
          Who reads it, and how to send it.

          This line was taken out once, on the grounds that a standing note is
          a sentence people read once and then have under every message they
          ever write. It comes back because half of it is not a note but an
          instruction: Enter sends, and a composer that posts on Enter without
          saying so is one somebody sends half a sentence from. An error
          replaces it rather than joining it — two lines under a box is the
          state this was originally objecting to.
        */}
        <span className="thread-note">
          {error ??
            'Everyone in this album can read it. Enter sends, Shift + Enter is a new line.'}
        </span>
        <button onClick={onPost} disabled={posting || draft.trim() === ''}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </>
  );
}

/**
 * Closes the reaction picker on a click away or Escape.
 *
 * The same three rules `Menu` applies to its panel, and for the same reason —
 * a picker whose only exit is choosing something is a picker that makes you
 * react to get rid of it. Not shared with `Menu` itself because the picker is
 * not a popover: its buttons sit in the row of reactions rather than in a
 * panel over them, so there is nothing to hand a `children` function.
 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);

  return ref;
}

function Row({
  message,
  canPost,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onReact,
}: {
  message: Message;
  canPost: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  const [body, setBody] = useState(message.body);
  const [picking, setPicking] = useState(false);
  const pickerRef = useDismiss(picking, useCallback(() => setPicking(false), []));

  if (message.deleted) {
    // A gap that says so, rather than a message quietly missing from the
    // middle of a conversation — the ones around it would appear to be
    // answering each other.
    return <p className="muted thread-gone">Message deleted</p>;
  }

  return (
    <div className={`message${message.author.mine ? ' message-mine' : ''}`}>
      {/*
        Their actual picture. `Face` rather than a bare `<img>` for the reason
        it exists: an avatar URL is presigned for an hour, so a tab left open
        on a thread outlives it, and the browser's answer to that is a broken
        glyph beside somebody's message. The letter is what that becomes —
        which is also what somebody with no picture has always had.
      */}
      <Face
        src={message.author.avatarUrl}
        size={32}
        className="message-face"
        fallback={
          <span aria-hidden="true">
            {message.author.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
          </span>
        }
      />

      <div className="message-body">
        <div className="message-meta">
          <strong>{message.author.mine ? 'You' : message.author.name}</strong>{' '}
          <span>
            {ago(new Date(message.createdAt), new Date())}
            {message.edited && ' · edited'}
          </span>
          {message.author.mine && !editing && (
            <MessageMenu onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>

        {editing ? (
          <div className="message-edit">
            <textarea
              className="thread-field"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="row">
              <button className="small" onClick={() => onSave(body)}>
                Save
              </button>
              <button className="secondary small" onClick={onCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="message-text">{withMentions(message.body)}</p>
        )}

        {(message.reactions.length > 0 || canPost) && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className="reaction"
                aria-pressed={reaction.mine}
                disabled={!canPost}
                onClick={() => onReact(reaction.emoji)}
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
            {canPost && (
              <div className="picker" ref={pickerRef}>
                <button
                  className="reaction reaction-add"
                  aria-label={picking ? 'Close the reactions' : 'Add a reaction'}
                  aria-expanded={picking}
                  onClick={() => setPicking(!picking)}
                >
                  {picking ? '\u00d7' : '+'}
                </button>
                {picking &&
                  REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      className="reaction"
                      onClick={() => {
                        setPicking(false);
                        onReact(emoji);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The three dots at the end of your own message.
 *
 * Two links reading "Edit" and "Delete" sat on every message you had written,
 * which put a permanent invitation to delete beside every one of them — and on
 * a 360px column they competed with the name and the time for the same line.
 * One glyph says the same thing and only shows the dangerous half when asked.
 */
function MessageMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <Menu label="Options for your message">
      {(close) => (
        <>
          <button role="menuitem" onClick={() => { close(); onEdit(); }}>
            Edit
          </button>
          {/* The danger colour on the text, not the filled `.danger` treatment:
              a red slab in a two-item menu shouts, and this is still only a
              message. */}
          <button
            role="menuitem"
            className="menu-danger"
            onClick={() => { close(); onDelete(); }}
          >
            Delete
          </button>
        </>
      )}
    </Menu>
  );
}

/**
 * Draws `@name` as a mention and everything else as text.
 *
 * Deliberately not a link and deliberately not looked up. It marks what
 * somebody typed; it does not assert that the person exists, and it cannot be
 * made to render anything but a run of characters that were already going to
 * be shown — which is what keeps a message body from being a place to put
 * markup.
 */
function withMentions(body: string): React.ReactNode[] {
  return body.split(/(@[\p{L}\p{N}_-]+)/u).map((part, i) =>
    part.startsWith('@') && part.length > 1 ? (
      <span className="mention" key={i}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

async function explain(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; max?: number };
  switch (body.error) {
    case 'too_long':
      return `That is longer than ${body.max} characters.`;
    case 'sign_in_required':
      return 'Sign in to post.';
    case 'forbidden':
      return 'Only people who can add photos can post.';
    default:
      return 'Could not post that.';
  }
}
