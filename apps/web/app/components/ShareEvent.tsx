'use client';

/**
 * The link to an event, in front of everything.
 *
 * It began as a panel in the flow at the foot of the page, which put it under
 * a grid of two hundred photographs — so choosing "Share this event" from a
 * menu in the sticky head appeared to do nothing at all, and the thing you
 * asked for was three screens down.
 *
 * Portalled to `<body>` for the same reason the thread's sheet is: the control
 * that opens this lives in `.event-head`, and the head has `backdrop-filter`
 * on it, which makes it the containing block for `position: fixed` children. A
 * scrim rendered inside it covers the header and nothing else.
 *
 * Dismissed three ways — the scrim, Escape, and the button — and focus goes
 * back where it came from, because a dialog that drops focus on `<body>` makes
 * the next Tab start again from the top of the page.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ShareEvent({
  linkToken,
  code,
  onClose,
}: {
  linkToken: string;
  /** The spoken code, when one is assigned. Null once it is released. */
  code: string | null;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  /*
   * The site's own origin, read after mount.
   *
   * Not `APP_URL`: the link somebody copies has to be the host they are
   * actually on, or a preview deployment hands out production URLs — and a
   * link built on the server would have to be re-signed for every host this
   * is ever served from.
   */
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setMounted(true);
    setOrigin(window.location.origin);
  }, []);

  /*
   * Focus once the portal exists, not before.
   *
   * Keyed on `mounted` because the first render returns null — `document` is
   * not there during the server pass — so on the run where this would
   * otherwise have fired, `card.current` was still null. The dialog opened
   * without taking focus, which leaves a keyboard user on whatever is behind
   * it and makes Escape the only thing that works, by accident.
   */
  useEffect(() => {
    if (mounted) card.current?.focus();
  }, [mounted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  const url = `${origin}/e/${linkToken}`;

  return createPortal(
    <div
      className="share-scrim"
      // Only a press that both starts and ends on the scrim is a dismissal.
      // Checking the target rather than stopping propagation inside means a
      // drag that begins on the card and releases outside does not close it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="share-card"
        role="dialog"
        aria-modal="true"
        aria-label="Share this event"
        tabIndex={-1}
        ref={card}
      >
        <h2>Share this event</h2>

        <div className="aside-row">
          <span className="aside-link">{url}</span>
          <button
            className="as-text"
            onClick={() => {
              // `clipboard` is undefined outside a secure context, and the
              // whole row is still useful without it — the URL is on screen
              // and selectable, which is what somebody does anyway when a
              // copy button silently fails.
              navigator.clipboard
                ?.writeText(url)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {code && <p className="muted">Or say: {code}</p>}

        <p className="muted">
          Anybody with this can open the event and add their photos.
        </p>

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
