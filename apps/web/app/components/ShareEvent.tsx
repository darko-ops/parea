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

import { ACCOUNT_REQUIRED, REQUEST_ACCESS } from '@parea/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * What happens to the person who receives this.
 *
 * Said in terms of them rather than of the setting, and said accurately: the
 * panel used to promise that anybody holding the link could open the album and
 * add photos, which is true of exactly one of the three policies. On a private
 * album it oversells, and on an approval one it promises something the host
 * has to grant by hand — to somebody about to paste the link into a group chat
 * on the strength of that sentence.
 *
 * `joinsOpen` is checked first because it overrides all three: with the link
 * switched off nobody new gets in however the album is set.
 */
export function promise(accessPolicy: string | undefined, joinsOpen: boolean): string {
  if (!joinsOpen) {
    return 'The link is off for this album — only the people you add can get in.';
  }
  if (accessPolicy === REQUEST_ACCESS) {
    return 'Whoever you send this to can ask to come in. You let them in, under Members.';
  }
  if (accessPolicy === ACCOUNT_REQUIRED) {
    return 'Whoever you send this to signs in and is straight in. Adding photos needs an account too.';
  }
  return 'Anybody with this can open the album and add their photos.';
}

export function ShareEvent({
  linkToken,
  code,
  accessPolicy,
  joinsOpen = true,
  onClose,
}: {
  linkToken: string;
  /** What the link does when it arrives. Decides the line under it. */
  accessPolicy?: string;
  /** False means the link admits nobody new, whatever the policy says. */
  joinsOpen?: boolean;
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
          {promise(accessPolicy, joinsOpen)}
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
