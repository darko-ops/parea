'use client';

/**
 * The `+`, and what it makes: a roll, a group, or a moment.
 *
 * It was a link straight to the roll form. With three things to make it opens
 * a sheet instead — the app's own, in the same words — each choice with the
 * one line that says which is which. It creates nothing itself: each choice is
 * a link to the page that makes that thing.
 *
 * Worn by Home's head and by the bar at phone width, which are never drawn
 * together; the `className` is what tells them apart.
 */

import { useEffect, useRef, useState } from 'react';

import { RailIcon } from './RailIcon';

export function CreateMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="New roll, group or moment"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <RailIcon glyph="plus" />
      </button>

      {open && (
        <div className="new-sheet-back" onClick={() => setOpen(false)}>
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
              <span className="new-choice-icon">
                <RailIcon glyph="photos" />
              </span>
              <span className="new-choice-text">
                <span className="new-choice-name">Roll</span>
                <span className="new-choice-why">A shared place for photos with your people.</span>
              </span>
            </a>

            <a className="new-choice" href="/groups?new=1">
              <span className="new-choice-icon">
                <RailIcon glyph="groups" />
              </span>
              <span className="new-choice-text">
                <span className="new-choice-name">Group</span>
                <span className="new-choice-why">Your people, together for whatever comes next.</span>
              </span>
            </a>

            <a className="new-choice" href="/moments/new">
              <span className="new-choice-icon">
                <RailIcon glyph="ripple" />
              </span>
              <span className="new-choice-text">
                <span className="new-choice-name">Moment</span>
                <span className="new-choice-why">Put one photo front and center for your people.</span>
              </span>
            </a>

            <button
              type="button"
              className="new-sheet-cancel"
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
