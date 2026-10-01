'use client';

/**
 * Home: your people's moments, then your rolls.
 *
 * The page used to be the word "Home" over a grid. It was accurate and it was
 * nobody's — the design's first complaint was that returning to it did not
 * feel like returning to your people, and the answer is that the people are
 * now the first thing on it: one way into their moments above the rolls,
 * saying how many are new and nothing about whose they are.
 *
 * The row was a filter once: the same faces, and pressing one narrowed the
 * grid to the evenings that person was at. The shape was right and the verb
 * was not. A face at the top of Home reads as "something from them", and what
 * it did was hide things — so the shape stayed and the verb became the picture
 * they chose to put in front of you.
 *
 * ## Search narrows; nothing here fetches
 *
 * The search field filters a list the server has already sent. No `?q=`, no
 * round trip per keystroke.
 *
 * The cards stay server-rendered. They arrive as `children` and are filtered
 * by the id on each wrapper rather than rebuilt from data here — importing
 * `EventCard` into this file would pull the covers, the faces and the URL
 * signing into the browser bundle to implement a filter.
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

import type { WireMoment } from '@/moments';

import { CreateMenu } from './CreateMenu';
import { MomentsBar } from './MomentsBar';
import { PageMark } from './PageMark';
import { SearchControl } from './SearchControl';



export function HomeView({
  haystacks,
  /** "Evening, Nadia" — worded on the server. Null for somebody with no name. */
  greeting,
  moments,
  momentsAt,
  children,
}: {
  haystacks: Record<string, string>;
  greeting: string | null;
  moments: WireMoment[];
  momentsAt: string;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const searching = query.trim() !== '';

  const shown = Children.toArray(children).filter((child) => {
    if (!isValidElement(child)) return true;
    const id = (child.props as { 'data-event'?: string })['data-event'];
    // Not a card, so not the filter's business.
    if (!id) return true;
    if (!searching) return true;
    return matches(haystacks[id] ?? '', query);
  });

  return (
    <>
      <div className="home-head">
        <div className="page-greet">
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

        <PageMark />

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
          <CreateMenu className="round home-create" />

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

        {/*
          One way into everybody's moments, with nobody's name on it — see
          `MomentsBar`. The tiles are inside the viewer now, as its map.

          Inside the head rather than under it, so a phone can put it where
          the greeting is, beside search: on a 375px screen the greeting is a
          line of grey saying the time of day, and the bar is the one thing at
          the top worth a tap. On a laptop it takes the row under the head, as
          before. Absent when there are no moments, and the greeting is back.
        */}
        <MomentsBar moments={moments} at={momentsAt} />
      </div>

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
      {!searching && shown.length === 0 && (
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
    </>
  );
}
