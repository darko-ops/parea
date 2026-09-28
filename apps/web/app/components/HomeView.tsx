'use client';

/**
 * Home: your people, then your events.
 *
 * The page used to be the word "Home" over a grid. It was accurate and it was
 * nobody's — the design's first complaint was that returning to it did not
 * feel like returning to your people, and the answer is that the people are
 * now the first thing on it. A row of faces above the events, and pressing one
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

import { Children, isValidElement, useState } from 'react';

import { matches } from '@/search';

import { Face } from './Faces';
import { RailIcon } from './RailIcon';
import { SearchControl } from './SearchControl';

export type RowPerson = {
  actorId: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  /** The viewer's events this person is in. */
  eventIds: string[];
};

export function HomeView({
  haystacks,
  /** "Evening, Nadia" — worded on the server. Null for somebody with no name. */
  greeting,
  people,
  children,
}: {
  haystacks: Record<string, string>;
  greeting: string | null;
  people: RowPerson[];
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const searching = query.trim() !== '';
  const person = people.find((p) => p.actorId === selected) ?? null;

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
          {/*
            The greeting *is* the heading now.

            It was two lines: "Afternoon, Nadia" in 13px grey over the page's
            name in 28px bold. Both said something and only one of them said
            anything the reader did not already know — somebody on this page
            got here by pressing the row in the rail that names it, and the
            rail is still on the screen with that row marked. A page that
            opens by announcing which page it is, to somebody who just chose
            it, is furniture.

            So the name goes and the greeting takes the slot, at the name's
            own size: it is the one line here addressed to the person reading
            rather than describing what they are looking at.

            The page's name is the fallback rather than the rule, for the two
            cases the greeting has nothing to say in — no account, or an
            account with no display name. A heading is what a reader and a
            screen reader both navigate by, and a header that empties itself
            is a page that starts with nothing.
          */}
          <h1 className="home-title">{greeting ?? 'Your Parea'}</h1>
        </div>

        <div className="home-actions">
          {/*
            Create, on a laptop.

            It was at the foot of the rail, under five destinations — a column
            of places to go with one thing to *do* at the bottom of it, which
            is the last place the eye arrives. Here it is in the corner the
            phone already puts it in, beside the other control this page has,
            so the two things you can do to your own albums sit together and
            the rail is only places.

            Only on this page, and the rail's copy is gone rather than kept:
            two links to the same place is two tab stops and two things for a
            screen reader to announce. What it costs is creating an album from
            Chat or Notifications, which is now a click through Albums
            first — the trade taken knowingly, because a create button in six
            different corners is the thing that made the rail's one invisible.
          */}
          <a href="/" className="round home-create" aria-label="Create a roll">
            <RailIcon glyph="plus" />
          </a>

          {/*
            A button that reveals a field, not a label for one — and the same
            one the Chat page's head wears, so the shape, the focus handling
            and the way Escape behaves cannot drift into two search controls
            in one product. See `SearchControl`.
          */}
          <SearchControl
            label="Search your rolls"
            query={query}
            onQuery={setQuery}
            open={open}
            onOpen={setOpen}
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
            people you already share events with, so the way to add to it is to
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
              Showing rolls with <b>{first(person.name)}</b> ·{' '}
              <button type="button" className="link-button" onClick={() => setSelected(null)}>
                clear
              </button>
            </span>
          )}
        </div>
      )}

      <div className="cards">{shown}</div>

      {/*
        A line and the one stroke that answers it, where a card used to be.

        The last cell of the grid was a `Create Album` panel — a bordered box
        with a heading and two sentences in it, always rendered because it was
        "the affordance, not a result". With nothing else in the grid it was
        the whole page: an empty screen whose one object was an advertisement
        for the product you are already inside.

        The app answers the same absence with a sentence and a `+`, and the
        note beside it makes the argument this borrows — a panel on a page
        whose every other row is a photograph draws more attention empty than
        the cards draw full. Both clients now say the same seven words.

        Not repeated when there *are* albums: making one is a control in the
        head on both clients, and a second button for it at the foot of a
        scrolling grid is furniture rather than affordance.
      */}
      {!searching && !person && shown.length === 0 && (
        <div className="blank">
          <p className="blank-note">No Rolls Yet. Create One Now.</p>
          <a className="blank-do" href="/" aria-label="Create a roll">
            <span aria-hidden="true">+</span>
          </a>
        </div>
      )}

      {/*
        Said, rather than left as an empty grid. An empty grid with a create
        cell in it looks identical to having no events at all, and would send
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
