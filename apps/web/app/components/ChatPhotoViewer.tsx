'use client';

/**
 * A photograph somebody sent into a chat, opened full — the web twin of the
 * app's `ChatPhotoView`.
 *
 * The roll's photo page without the roll's talk: whose it is at the top, the
 * picture, and what you can do with it — keep it (the star, when its roll is
 * open to you), send it on, make it a moment, save it. No reacting and no
 * comments: those belong to the roll, which is somewhere else.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Message } from '@/messages';

import { Face } from './Faces';
import { SendToChat } from './SendToChat';
import { Star } from './Star';
import { useImageFailure } from './useImageFailure';

type Sent = NonNullable<Message['photo']>;

export function ChatPhotoViewer({ photo, onClose }: { photo: Sent; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const shot = useImageFailure(photo.full ?? '');
  const [asking, setAsking] = useState(false);
  const [moment, setMoment] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over this one (sending it on) handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('.send-chat')) onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind does not scroll while the picture is up.
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = was;
    };
  }, [onClose]);

  const makeMoment = async () => {
    setBusy(true);
    setMoment(null);
    const res = await fetch('/api/moments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId: photo.id }),
    }).catch(() => null);
    setBusy(false);
    setAsking(false);
    setMoment(
      res?.ok
        ? { text: 'Shared as a moment. Your friends will see it for a day.', bad: false }
        : { text: res?.status === 404 ? 'This photo can’t be made a moment.' : 'Couldn’t share it. Try again.', bad: true },
    );
  };

  return createPortal(
    <div className="chat-photo" role="dialog" aria-modal="true" aria-label="Photo" tabIndex={-1} ref={box}>
      <header className="chat-photo-head">
        <button type="button" className="chat-photo-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {photo.by && (
          <span className="chat-photo-who">
            <Face
              src={photo.by.avatarUrl}
              size={28}
              className="photo-by-face"
              fallback={<span aria-hidden="true">{photo.by.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>}
            />
            <span>{photo.by.handle ? `@${photo.by.handle}` : photo.by.name}</span>
          </span>
        )}
        <span className="chat-photo-tools">
          <Star photoId={photo.id} favourite={photo.favourite} canKeep={photo.canKeep} />
        </span>
      </header>

      <div className="chat-photo-frame" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {photo.full && !shot.failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={shot.ref} src={photo.full} alt="" onError={shot.onError} />
        ) : (
          <p className="muted">This photo couldn’t be loaded.</p>
        )}
      </div>

      <footer className="chat-photo-foot">
        {moment && <span className={`chat-photo-said${moment.bad ? ' bad' : ''}`} role="status">{moment.text}</span>}
        {asking ? (
          <span className="chat-photo-ask">
            Share as a moment?
            <button type="button" className="small" disabled={busy} onClick={() => void makeMoment()}>
              {busy ? 'Sharing…' : 'Share'}
            </button>
            <button type="button" className="secondary small" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <span className="photo-verbs-do">
            <SendToChat sending={{ photoId: photo.id }} />
            <button
              type="button"
              className="photo-icon"
              onClick={() => {
                setMoment(null);
                setAsking(true);
              }}
              aria-label="Share this photo as a moment"
              title="Share as a moment"
            >
              {/* The app's ripple: a point and the rings going out from it. */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="5.4" />
                <circle cx="12" cy="12" r="9.2" strokeOpacity="0.6" />
              </svg>
            </button>
            {photo.original && (
              <a className="photo-icon" href={photo.original} download aria-label="Download this photo" title="Download">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3.5v11" />
                  <path d="M8.5 11 12 14.5 15.5 11" />
                  <path d="M4 15.5v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
                </svg>
              </a>
            )}
          </span>
        )}
      </footer>
    </div>,
    document.body,
  );
}
