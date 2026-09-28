'use client';

/**
 * The `+`, and what it makes: a roll, a group, or a moment.
 *
 * It was a link straight to the roll form. With three things to make it opens
 * a sheet instead — the app's own, in the same words — each choice with the
 * one line that says which is which. It creates nothing itself except the
 * moment, which has no form to go to: a moment is one picture, so choosing it
 * *is* choosing the picture.
 *
 * Worn by Home's head and by the bar at phone width, which are never drawn
 * together; the `className` is what tells them apart.
 */

import { useEffect, useRef, useState } from 'react';

import { RailIcon } from './RailIcon';

export function CreateMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy]);

  async function share(file: File) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/moments', { method: 'POST', body: file }).catch(() => null);
    if (res?.ok) {
      // Home, where it is now the first square in the row.
      location.assign('/events');
      return;
    }
    setBusy(false);
    setError(
      res?.status === 413
        ? 'That photo is too large.'
        : res?.status === 415
          ? 'That is not a photo we can read.'
          : 'Could not share it. Try again.',
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="New roll, group or moment"
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <RailIcon glyph="plus" />
      </button>

      {open && (
        <div className="new-sheet-back" onClick={() => !busy && setOpen(false)}>
          <div
            className="new-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="new-sheet-title" className="new-sheet-title">
              New
            </h2>

            <a ref={first} className="new-choice" href="/">
              <span className="new-choice-name">Roll</span>
              <span className="new-choice-why">A shared place for photos with your people.</span>
            </a>

            <a className="new-choice" href="/groups?new=1">
              <span className="new-choice-name">Group</span>
              <span className="new-choice-why">Your people, together for whatever comes next.</span>
            </a>

            <button
              type="button"
              className="new-choice"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <span className="new-choice-name">{busy ? 'Sharing…' : 'Moment'}</span>
              <span className="new-choice-why">Put one photo front and center for your people.</span>
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void share(file);
              }}
            />

            {error && <p className="new-sheet-error">{error}</p>}

            <button
              type="button"
              className="new-sheet-cancel"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
