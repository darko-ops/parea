/**
 * The web shell — the places you can be, as a rail.
 *
 * The web had no home. You landed on the create form, and the only route back
 * to anything was a link somebody had sent you; an event you contributed to
 * last week was unreachable unless you still had the message. The native
 * client grew three tabs for this and the web never got the equivalent, which
 * made "two clients, one protocol" true of the API and false of the product.
 *
 * Five rows, where the app's tab bar still has three. Activity is one of the
 * differences, and it is near the top because this is the client somebody
 * arrives at from a link they were sent — the one where "what came of that?"
 * is a question worth having a screen for. Groups is the other, and it is a
 * row because the product treats a group as persistent identity while the web
 * gave it no address of its own.
 *
 * ## Below tablet it is a wordmark and a hamburger
 *
 * It was the same rows laid out sideways, which fitted while there were four
 * of them and stopped at six: the bar scrolled horizontally, so Profile hung
 * half off the screen and Settings and Create Event were past the edge with
 * nothing to say they were there. A row of destinations you cannot see is not
 * navigation.
 *
 * So the rows go behind a button, in the corner a thumb reaches. The panel is
 * the same list in the same order, drawn as the column it already is on a wide
 * screen — one set of markup rather than a phone copy of it.
 *
 * `'use client'` for that one piece of state, which is a change: this used to
 * render on whichever side it was used from. A `<details>` would have avoided
 * it and cannot, because the same element has to be a dropdown on a phone and
 * an always-open column on a laptop, and CSS cannot force a closed disclosure
 * back open. The cost is a few hundred bytes on a component that was already
 * on every page.
 *
 * Reached through `Shell` rather than used directly — a rail without the flex
 * parent it expects renders as a full-width band above the content.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { InvitesBadge } from './InvitesBadge';
import { Mark } from './Mark';
import { RailIcon, type RailGlyph } from './RailIcon';

export type RailPage =
  | 'events'
  | 'invites'
  | 'groups'
  | 'friends'
  | 'find'
  | 'you'
  | 'settings'
  | null;

const ROWS: {
  href: string;
  label: string;
  page: Exclude<RailPage, null>;
  glyph: RailGlyph;
}[] = [
  // The label is Home, the route is `/events`, and the id stays `events`: the
  // id names the row for the code, and every table underneath still says
  // `event`.
  { href: '/events', label: 'Home', page: 'events', glyph: 'home' },
  // Under Home because it is the same kind of thing — events you are in —
  // separated only by whose they are. Search is the odd one out: the only row
  // that goes looking for something you are not already part of.
  // Still `invites` as an id and still the envelope: what lands here is
  // mostly somebody asking you to something, and the rest is what came of it.
  { href: '/activity', label: 'Activity', page: 'invites', glyph: 'invites' },
  /*
   * Above Search, and below Activity, because that is the order these are
   * true in. Home and Activity are what has already happened to you; Groups is
   * the rooms you are already in; Search is the only row that goes looking for
   * something you are not part of yet. Putting Groups under Search would file
   * the places you belong under the heading for finding places you do not.
   *
   * Groups had no page at all until now — you reached one from a chip on
   * Search, from an event that belonged to it, or from a link somebody sent.
   * That is fine for something you visit occasionally and wrong for the thing
   * the product treats as persistent identity.
   */
  { href: '/groups', label: 'Groups', page: 'groups', glyph: 'groups' },
  // No Friends row. The page is still there and still gets its `aria-current`
  // when you are on it — it is reached from the friend count under your name
  // on Profile, which is where somebody looks for their friends anyway. A rail
  // is the places the product is, and friends is a thing about you.
  //
  // The labels say what the rows do; the ids still say where they go. `find`
  // and `you` name the routes, which have not moved — renaming those would
  // break every link anybody has already sent, and every bookmark.
  { href: '/find', label: 'Search', page: 'find', glyph: 'search' },
  { href: '/account', label: 'Profile', page: 'you', glyph: 'profile' },
];

export function Rail({ current }: { current: RailPage }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useRef<HTMLElement>(null);

  /*
   * Closes on a tap away and on Escape — the two rules `Menu` applies to its
   * panel, for the same reason: a panel whose only exit is choosing something
   * makes you navigate to be rid of it.
   *
   * `mousedown` rather than `click`, again as `Menu` does. Listening for the
   * later event closes the panel between a link being pressed and the
   * navigation starting, so the link never fires.
   */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);

  return (
    <nav
      className={`rail${open ? ' rail-open' : ''}`}
      aria-label="Sections"
      ref={ref}
    >
      <div className="rail-mark">
        {/* Sized at the call site rather than by the default: this is the
            one lockup it appears in, and the number is a relationship to the
            wordmark beside it rather than a property of the mark. */}
        <Mark size={30} />
        <span className="wordmark">Parea</span>
      </div>

      {/*
        Only on a phone, and only there: on a wide screen the rows are already
        the page's left-hand edge, and a button that hides visible navigation
        adds a step to everything.

        The unread count rides on the closed button, because what it hides
        includes the one row that ever carries a number — a menu that conceals
        it is a menu somebody opens to find out there was nothing to find.
      */}
      <button
        type="button"
        className="rail-burger"
        aria-expanded={open}
        aria-controls="rail-nav"
        aria-label={open ? 'Close the menu' : 'Menu'}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="rail-burger-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {!open && current !== 'invites' && <InvitesBadge />}
      </button>

      <div className="rail-nav" id="rail-nav">

      {ROWS.map((row) => (
        <a
          key={row.page}
          href={row.href}
          className="rail-row"
          // `aria-current` rather than a class: it is what a screen reader
          // announces, and the styling can hang off the same attribute
          // instead of the two going out of step.
          aria-current={current === row.page ? 'page' : undefined}
        >
          {/* The glyph, then the word. Both, because a rail of five icons is a
              puzzle and a rail of five words is a list you have to read. */}
          <RailIcon glyph={row.glyph} />
          <span className="rail-label">{row.label}</span>
          {/*
            Only on the row it belongs to, and only when the page is not the
            one you are looking at: arriving on Activity is what clears it, so
            a number still sitting there while you read the list is a number
            describing a moment that has passed.
          */}
          {row.page === 'invites' && current !== 'invites' && <InvitesBadge />}
        </a>
      ))}

      <div className="rail-foot">
        <a href="/">
          {/*
            Just "Create". The rail is a column of one-word destinations and
            this was the only two-word label in it; the noun was carrying no
            information a person standing on Home needed, because the thing
            this product creates is the only thing it creates.
          */}
          <button type="button">Create</button>
        </a>
        {/*
          Settings, under the thing people actually come here to press.

          It was a button on the profile beside "Edit profile", which put two
          different jobs on one row — one changes how you appear, the other
          holds the account itself and the way to delete it. In the rail it is
          where settings usually are, and the profile is left to be a profile.
        */}
        <a
          href="/account?view=settings"
          className="rail-row rail-settings"
          aria-current={current === 'settings' ? 'page' : undefined}
        >
          <RailIcon glyph="settings" />
          <span className="rail-label">Settings</span>
        </a>
        </div>
      </div>
    </nav>
  );
}
