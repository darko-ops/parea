'use client';

/**
 * A disc that becomes a field, and the one copy of it.
 *
 * Home had this and the Chat page did not; writing it a second time would have
 * meant two copies of the focus handling below, and the notes on those are all
 * bug reports. So it is a component, and the two pages differ only in what
 * they label it and how wide the field runs.
 *
 * ## Why a button that opens rather than a field that is always there
 *
 * The app's note on the same control is the argument: the field used to sit
 * under the head on every visit, a bordered box mostly empty, taking a line
 * above the thing the screen is actually for. Searching your conversations is
 * something people do sometimes and reading them is what they came for, and a
 * permanent control for the first pushes the second down the page.
 *
 * ## Width, not `display`
 *
 * The input stays in the DOM so it can be focused the moment the button is
 * pressed, and it animates so the pair reads as one object growing rather than
 * as two controls swapping places. `tabIndex` takes it out of the tab order
 * while it is a sliver — a focus stop on something with no width is a keyboard
 * user tabbing into nothing.
 */

import { useCallback, useEffect, useRef } from 'react';

import { SearchIcon } from './SearchIcon';

export function SearchControl({
  label,
  query,
  onQuery,
  open,
  onOpen,
  wide = false,
}: {
  /** The placeholder and the accessible name, which are the same sentence. */
  label: string;
  query: string;
  onQuery: (next: string) => void;
  /**
   * Held by the caller, not here.
   *
   * The Chat page's head gives up its heading while this is open — the field
   * runs the width of the row, the way the app spends its wordmark on the same
   * gesture — so the row above has to know. Home keeps its own state and
   * passes it straight back down.
   */
  open: boolean;
  onOpen: (next: boolean) => void;
  /** The open field takes the row rather than a fixed width. See `.search-wide`. */
  wide?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';

  /*
   * Focus follows the state, not the click.
   *
   * This was a `requestAnimationFrame` in the button's handler, which fires
   * before React has committed — so the field grew to its full width and focus
   * stayed on the button behind it. An effect runs after the commit, when the
   * input is its real width and its `tabIndex` is 0.
   */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /*
   * Collapse when focus leaves the whole control, not merely the field —
   * `onBlur` alone fired when focus moved to the button beside it — and only
   * when it is empty, because collapsing a field with a live query in it hides
   * the reason the list underneath is short.
   */
  const collapse = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && wrapRef.current?.contains(next)) return;
      if (query.trim() === '') onOpen(false);
    },
    [query, onOpen],
  );

  return (
    <div
      ref={wrapRef}
      className={`search${open ? ' search-open' : ''}${wide ? ' search-wide' : ''}`}
    >
      <button
        type="button"
        className="round search-go"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          // Pressing it again on an empty field puts the row back. With a
          // query in it the press is a no-op rather than a way to lose one.
          if (open && query.trim() === '') onOpen(false);
          else onOpen(true);
        }}
      >
        <SearchIcon />
      </button>
      <input
        ref={inputRef}
        type="search"
        className="search-field"
        value={query}
        placeholder={label}
        aria-label={label}
        tabIndex={open ? 0 : -1}
        onChange={(e) => onQuery(e.target.value)}
        onBlur={collapse}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // Clear first, close second — so Escape never loses a query and a
          // field in one press.
          if (searching) onQuery('');
          else {
            onOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
    </div>
  );
}
