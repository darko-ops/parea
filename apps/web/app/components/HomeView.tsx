'use client';

/**
 * Home: your people, then your albums.
 *
 * The page used to be the word "Home" over a grid. It was accurate and it was
 * nobody's — the design's first complaint was that returning to it did not
 * feel like returning to your people, and the answer is that the people are
 * now the first thing on it. A row of faces above the albums, and pressing one
 * narrows the grid to the evenings that person was at.
 *
 * ## Everything here narrows; nothing here fetches
 *
 * Both controls — the search field and the people row — filter a list the
 * server has already sent. No `?q=`, no round trip per keystroke, no request
 * when a face is pressed. That is the same reasoning the search field has
 * always had, and it is what makes the face filter worth having at all: it is
 * one click to ask "which of these was Priya at", and one to put it back.
 *
 * The cards stay server-rendered. They arrive as `children` and are filtered
 * by the id on each wrapper rather than rebuilt from data here — importing
 * `EventCard` into this file would pull the covers, the faces and the URL
 * signing into the browser bundle to implement two filters.
 *
 * ## Why the greeting
 *
 * "Evening, Nadia" over "Your Parea". It is the one line on the screen that is
 * addressed to the person reading it rather than describing what they are
 * looking at, and it costs a clock read. The time of day comes from the
 * server's own clock, passed down already worded — the browser's would
 * disagree during hydration and React would throw the tree away.
 */

import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react';

import { matches } from '@/search';

import { Face } from './Faces';
import { SearchIcon } from './SearchIcon';

export type RowPerson = {
  actorId: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  /** The viewer's albums this person is in. */
  eventIds: string[];
};

export function HomeView({
  haystacks,
  /** "Evening, Nadia" — worded on the server. Null for somebody with no name. */
  greeting,
  people,
  footer,
  children,
}: {
  haystacks: Record<string, string>;
  greeting: string | null;
  people: RowPerson[];
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const searching = query.trim() !== '';
  const person = people.find((p) => p.actorId === selected) ?? null;

  /*
   * Focus follows the state, not the click.
   *
   * This was a `requestAnimationFrame` in the button's handler, which fires
   * before React has committed — so the field grew to 220px and focus stayed
   * on the button behind it. An effect runs after the commit, when the input
   * is its real width and its `tabIndex` is 0.
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
      if (query.trim() === '') setOpen(false);
    },
    [query],
  );

  const inFilter = person ? new Set(person.eventIds) : null;

  const shown = Children.toArray(children).filter((child) => {
    if (!isValidElement(child)) return true;
    const id = (child.props as { 'data-event'?: string })['data-event'];
    // Not a card, so not the filters' business.
    if (!id) return true;
    if (inFilter && !inFilter.has(id)) return false;
    if (!searching) return true;
    return matches(haystacks[id] ?? '', query);
  });

  return (
    <>
      <div className="home-head">
        <div>
          {greeting && <div className="home-greeting">{greeting}</div>}
          <h1 className="home-title">Your Parea</h1>
        </div>

        <div ref={wrapRef} className={`search${open ? ' search-open' : ''}`}>
          {/*
            A button that reveals a field, not a label for one. While collapsed
            the input has no width and is out of the tab order, so the button
            owns the expanding and the field takes focus once there is
            something there to take it.
          */}
          <button
            type="button"
            className="search-go"
            aria-expanded={open}
            aria-label="Search your albums"
            onClick={() => {
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
            placeholder="Search your albums"
            aria-label="Search your albums"
            tabIndex={open ? 0 : -1}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={collapse}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // Clear first, close second — so Escape never loses a query and
              // a field in one press.
              if (searching) setQuery('');
              else {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
          />
        </div>
      </div>

      {people.length > 0 && (
        <div className="people-row">
          {people.map((p) => {
            const on = p.actorId === selected;
            return (
              <button
                key={p.actorId}
                type="button"
                className={`person${on ? ' person-on' : ''}`}
                aria-pressed={on}
                // The whole button is the label: a circle and a first name,
                // where the circle is often a picture and the name is the only
                // text. Pressing again clears, which is what pressing a
                // selected thing does everywhere else here.
                onClick={() => setSelected(on ? null : p.actorId)}
              >
                <Face
                  src={p.avatar}
                  size={56}
                  className="person-face"
                  fallback={
                    <span aria-hidden="true">
                      {(p.name.replace('@', '').trim() || '?').slice(0, 1).toUpperCase()}
                    </span>
                  }
                />
                <span className="person-name">{first(p.name)}</span>
              </button>
            );
          })}

          {/*
            The last slot, and it is a door rather than a face: the row is the
            people you already share albums with, so the way to add to it is to
            share one — which is what the friends screen is for.
          */}
          <a className="person person-invite" href="/friends">
            <span className="person-face person-plus" aria-hidden="true">
              ＋
            </span>
            <span className="person-name">Invite</span>
          </a>

          {person && (
            <span className="people-filter">
              Showing albums with <b>{first(person.name)}</b> ·{' '}
              <button type="button" className="link-button" onClick={() => setSelected(null)}>
                clear
              </button>
            </span>
          )}
        </div>
      )}

      <div className="cards">
        {shown}
        {/* Always rendered: it is the affordance, not a result. Except under a
            person filter, where "create an album" is not an album Priya was
            at, and the grid is answering that question. */}
        {!person && footer}
      </div>

      {/*
        Said, rather than left as an empty grid. An empty grid with a create
        cell in it looks identical to having no albums at all, and would send
        somebody off to make a second copy of the one they were looking for.
      */}
      {searching && shown.length === 0 && (
        <p className="muted empty">Nothing here matches “{query.trim()}”.</p>
      )}
      {!searching && person && shown.length === 0 && (
        <p className="muted empty">Nothing here with {first(person.name)} in it.</p>
      )}
    </>
  );
}

/**
 * The name under a face: the first word of it.
 *
 * A row of 76px columns cannot hold "Priya Raghunathan", and the alternative
 * to shortening is ellipsising every second name into a stub. First names are
 * what people call each other, and the full one is a click away on their page.
 */
function first(name: string): string {
  return name.replace('@', '').trim().split(/\s+/)[0] ?? name;
}
