'use client';

/**
 * Share a roll's photograph as a moment — the app's ripple, on the photo page.
 *
 * Asked first, in the same dialog the paper plane beside it opens: a moment
 * goes to everyone you share moments with for a day, which is more than a tap
 * on a small round button should do on its own. The server reads the picture
 * from its full size (see `/api/moments`), so nothing is uploaded from here.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ShareAsMoment({ photoId }: { photoId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="photo-icon"
        onClick={() => setOpen(true)}
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
      {open && <Ask photoId={photoId} onClose={() => setOpen(false)} />}
    </>
  );
}

function Ask({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const share = async () => {
    setBusy(true);
    setSaid(null);
    const res = await fetch('/api/moments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId }),
    }).catch(() => null);
    setBusy(false);
    setSaid(
      res?.ok
        ? { text: 'Shared as a moment. Your friends will see it for a day.', bad: false }
        : {
            text: res?.status === 404 ? 'This photo can’t be made a moment.' : 'Couldn’t share it. Try again.',
            bad: true,
          },
    );
  };

  const done = said != null && !said.bad;

  return createPortal(
    <div
      className="dialog-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="Share as a moment"
        tabIndex={-1}
        ref={card}
      >
        <h2>Share as a moment?</h2>
        <p className="muted">Everyone you share moments with will see this photo for a day.</p>
        {said && (
          <p className={`send-chat-said${said.bad ? ' bad' : ''}`} role="status">
            {said.text}
          </p>
        )}
        <div className="row">
          {done ? (
            <button type="button" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => void share()}>
                {busy ? 'Sharing…' : 'Share'}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
