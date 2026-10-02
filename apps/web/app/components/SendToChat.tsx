'use client';

/**
 * Sending a photograph or a moment into one of your chats, from the web.
 *
 * The app's paper plane, here as an icon beside Download. It opens your chats
 * — one-to-one and groups, most recently active first — with an optional line
 * to go with it; choosing a chat sends and says where it went.
 *
 * The server decides whether it may go (see `/api/groups/[id]/messages`): a
 * photograph from a private roll only by whoever took it, somebody else's
 * moment only where everyone could already see it. Its refusal is said here.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageFailure } from './useImageFailure';

type Chat = {
  id: string;
  title: string;
  name: string | null;
  kind: 'named' | 'direct' | 'unnamed';
  memberCount: number;
  photoUrl: string | null;
  deck: { name: string; avatarUrl: string | null }[];
  lastActiveAt: string | null;
};

export type Sending = { photoId: string } | { momentId: string };

export function SendToChat({ sending }: { sending: Sending }) {
  const [open, setOpen] = useState(false);
  const what = 'momentId' in sending ? 'moment' : 'photo';
  return (
    <>
      <button
        type="button"
        className="photo-icon"
        onClick={() => setOpen(true)}
        aria-label={`Send this ${what} to a chat`}
        title="Send to a chat"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.5 3.5 3.5 10.5l7 3 3 7 7-17Z" />
          <path d="M20.5 3.5 10.5 13.5" />
        </svg>
      </button>
      {open && <Picker sending={sending} what={what} onClose={() => setOpen(false)} />}
    </>
  );
}

function Picker({ sending, what, onClose }: { sending: Sending; what: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    fetch('/api/groups?detail=1')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { groups: Chat[] }) => {
        if (!live) return;
        setChats([...body.groups].sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '')));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const send = async (chat: Chat) => {
    if (busy) return;
    setBusy(chat.id);
    setSaid(null);
    const res = await fetch(`/api/groups/${chat.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: note.trim(), ...sending }),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setSaid({ text: `Sent to ${chat.title}`, bad: false });
      setTimeout(onClose, 900);
      return;
    }
    const error = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
    setSaid({ text: refusal(error, what), bad: true });
  };

  return createPortal(
    <div
      className="dialog-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-card send-chat" role="dialog" aria-modal="true" aria-label={`Send this ${what}`} tabIndex={-1} ref={card}>
        <h2>Send this {what}</h2>
        <input
          className="thread-field send-chat-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a message (optional)"
          maxLength={2000}
        />
        {said && (
          <p className={`send-chat-said${said.bad ? ' bad' : ''}`} role="status">
            {said.text}
          </p>
        )}
        {failed ? (
          <p className="muted">Your chats could not be loaded. Try again in a moment.</p>
        ) : chats === null ? (
          <p className="muted">Loading your chats…</p>
        ) : chats.length === 0 ? (
          <p className="muted">You are not in any chats yet.</p>
        ) : (
          <ul className="send-chat-list">
            {chats.map((chat) => {
              const face = chat.photoUrl ?? chat.deck[0]?.avatarUrl ?? null;
              return (
                <li key={chat.id}>
                  <button type="button" onClick={() => void send(chat)} disabled={busy !== null}>
                    <ChatFace src={face} title={chat.title} />
                    <span className="send-chat-who">
                      <span className="send-chat-title">{chat.title}</span>
                      <span className="muted">{chat.kind === 'direct' ? 'Chat' : `Group · ${chat.memberCount} people`}</span>
                    </span>
                    <span className="send-chat-go">{busy === chat.id ? 'Sending…' : 'Send'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A chat's picture, or its initial when it has none or the picture will not load. */
function ChatFace({ src, title }: { src: string | null; title: string }) {
  const shot = useImageFailure(src ?? '');
  return (
    <span className="send-chat-face" aria-hidden="true">
      {src && !shot.failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={shot.ref} src={src} alt="" onError={shot.onError} />
      ) : (
        title.replace(/^@/, '').slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** The server's refusal, in a sentence. */
function refusal(error: string | undefined, what: string): string {
  switch (error) {
    case 'private_roll':
      return 'This photo is in a private roll. Only the person who took it can send it on.';
    case 'not_shareable':
      return 'Not everyone in that chat can see this moment, so it can’t go there.';
    case 'photo_not_found':
      return 'This photo isn’t available to send any more.';
    case 'moment_not_found':
      return 'This moment has ended.';
    case 'sign_in_required':
      return 'Sign in to send it to a chat.';
  }
  return `Couldn’t send the ${what}. Try again in a moment.`;
}
