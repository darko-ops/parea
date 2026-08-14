'use client';

/**
 * The search field on Home, and the filtering it does.
 *
 * Collapsed to its own icon until it is asked for. A permanently open field is
 * a question the page asks on every visit, and most visits are somebody
 * arriving to look at the top card — the events are already in front of them,
 * ordered by what is happening. It opens when pressed and stays open while it
 * has something in it.
 *
 * Filtering happens here rather than on the server. The whole list is already
 * on the page — one person's own events, fetched in one query — so a round
 * trip per keystroke would buy nothing, and a `?q=` in the URL would make
 * every letter a navigation. Nothing is fetched and nothing is revealed: this
 * narrows what the server already sent.
 *
 * The cards stay server-rendered. They arrive as `children` and are filtered
 * by an id on each wrapper rather than rebuilt from data on the client, which
 * is what importing `EventCard` here would have meant — the mosaic, the bleed
 * and the URL signing all pulled into the browser bundle to implement a text
 * box. Only `MosaicTile` runs on the client, exactly as before.
 *
 * It owns the heading row and the hero as well as the grid, because both
 * change when a search is running: the field belongs beside the title, and the
 * hero steps aside. A hero is an argument about what is happening now, and
 * leaving it above the results of a search for something else is the page
 * answering a question nobody asked, in the largest type on the screen.
 */

import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react';

import { matches } from '@/search';

import { SearchIcon } from './SearchIcon';

export function SearchEvents({
  /** Searchable text per event id, built server-side by `searchable()`. */
  haystacks,
  /** The `<h1>`. Rendered here so the field can sit on the same row. */
  heading,
  /** The live event's panel, or null. Hidden while a search is running. */
  hero,
  /**
   * The event the hero is drawing. Its card is in `children` too — so that a
   * search can find it — and is dropped from the grid whenever the hero is up,
   * which would otherwise show it twice.
   */
  heroId,
  /** The create cell. Always rendered: it is the affordance, not a result. */
  footer,
  children,
}: {
  haystacks: Record<string, string>;
  heading: React.ReactNode;
  hero?: React.ReactNode;
  heroId?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const searching = query.trim() !== '';

  /*
   * Focus follows the state, not the click.
   *
   * This was a `requestAnimationFrame` in the button's handler, which fires
   * before React has committed — so the field grew to 220px and focus stayed
   * on the button behind it. Pressing the icon opened a field you then had to
   * click a second time to type into, which is worse than not opening it. An
   * effect runs after the commit, when the input is its real width and its
   * `tabIndex` is 0.
   */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /*
   * Collapse when focus leaves the whole control, not merely the field.
   *
   * `onBlur` alone was wrong twice over. It fired when focus moved from the
   * field to the button beside it — still inside the same control, still very
   * much in use — and shut the thing a moment after it opened. `relatedTarget`
   * is where focus went, so this asks the question that was meant: has the
   * person left, or are they still in here?
   *
   * And only when it is empty. Collapsing a field with a live query in it
   * would hide the reason the list underneath is short.
   */
  const collapse = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current?.contains(next)) return;
    if (query.trim() === '') setOpen(false);
  }, [query]);

  const shown = Children.toArray(children).filter((child) => {
    if (!isValidElement(child)) return true;
    const id = (child.props as { 'data-event'?: string })['data-event'];
    // Not a card, so not the search's business.
    if (!id) return true;
    if (!searching) return id !== heroId;
    return matches(haystacks[id] ?? '', query);
  });

  return (
    <>
      <div className="main-head">
        {heading}
        <div ref={wrapRef} className={`search${open ? ' search-open' : ''}`}>
          {/*
            A button that reveals a field, not a label for one. A label would
            be the honest markup if the input were merely small, but while
            collapsed it has no width and is out of the tab order — so the
            button owns the expanding, and the field takes focus once there is
            something there to take it.
          */}
          <button
            type="button"
            className="search-go"
            aria-expanded={open}
            aria-label="Search your events"
            onClick={() => {
              // A toggle, because with the blur rule above there is otherwise
              // no way back: pressing the icon is how it opens and it should
              // be how it closes. A query in the field is left alone — that
              // is `collapse`'s rule, and one control should not have two.
              if (open && query.trim() === '') setOpen(false);
              else setOpen(true);
            }}
          >
            <SearchIcon />
          </button>
          <input
            ref={inputRef}
            type="search"
            className="search-field"
            value={query}
            placeholder="Search your events"
            aria-label="Search your events"
            tabIndex={open ? 0 : -1}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={collapse}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // Clear first, close second — the two-step every search field
              // has, so Escape never loses a query and a field in one press.
              if (searching) setQuery('');
              else {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
          />
        </div>
      </div>

      {!searching && hero}

      <div className="cards">
        {shown}
        {footer}
      </div>

      {/*
        Said, rather than left as an empty grid with a create cell in it. That
        looks identical to having no events at all, and would send somebody off
        to make a second copy of the one they were looking for.
      */}
      {searching && shown.length === 0 && (
        <p className="muted empty">Nothing here matches “{query.trim()}”.</p>
      )}
    </>
  );
}
