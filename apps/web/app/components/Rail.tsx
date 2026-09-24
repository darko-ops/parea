/**
 * The web shell — the places you can be, as a rail.
 *
 * The web had no home. You landed on the create form, and the only route back
 * to anything was a link somebody had sent you; an event you contributed to
 * last week was unreachable unless you still had the message. The native
 * client grew three tabs for this and the web never got the equivalent, which
 * made "two clients, one protocol" true of the API and false of the product.
 *
 * Five rows, where the app's tab bar has four. Notifications is the
 * difference, and it is near the top because this is the client somebody
 * arrives at from a link they were sent — the one where "what came of that?"
 * is a question worth having a screen for.
 *
 * The four they share say the app's words over the app's drawings: Albums,
 * Groupchats, Find, You. See `ROWS` for what they used to say and why the app
 * wins every case where the two disagreed.
 *
 * ## The head is the name, centred
 *
 * The app's is, and this had the mark and the word as a lockup at the leading
 * edge. Two things went: the mark, because the top of a screen says whose
 * product this is and the wordmark already says it in letters — and the
 * colour, which on a page whose subject is somebody else's photographs is the
 * one thing up there competing with them. Below tablet the bar is three
 * tracks, so the name sits in the middle of the screen rather than in the
 * middle of what the controls leave.
 *
 * ## Below tablet the rows go behind a button in the leading corner
 *
 * Four shapes in four versions of this file, and the last two are worth
 * keeping straight. They were laid out sideways first, which fitted at four
 * rows and stopped at six — the bar scrolled, so Profile hung half off the
 * screen and Settings was past the edge with nothing to say it was there.
 * Then behind a hamburger in the trailing corner. Then as a capsule floating
 * at the foot, the shape the app's tab bar has.
 *
 * The capsule is gone and the button is back, in the *leading* corner this
 * time. The rail is six destinations and the app's bar is four: six glyphs in
 * a capsule is a row nobody reads, and the two that would have to go are the
 * two the web has and the app does not. A menu holds six without asking
 * anybody to recognise a picture of Settings.
 *
 * Create is the one control that does not go behind it — see the `+` below.
 *
 * Leading rather than trailing, which is where it was: it is the first thing
 * on the row and the first thing a reader meets, and a control that opens
 * everything else belongs before the everything else rather than after it.
 *
 * Still one set of markup. `.rail-nav` is a column on a laptop and a panel
 * under the bar on a phone — the same list in the same order, drawn as the
 * column it already is, rather than a phone copy of it.
 *
 * `'use client'` for that one piece of state. A `<details>` would have avoided
 * it and cannot, because the same element has to be a dropdown on a phone and
 * an always-open column on a laptop, and CSS cannot force a closed disclosure
 * back open.
 *
 * Reached through `Shell` rather than used directly — a rail without the flex
 * parent it expects renders as a full-width band above the content.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { InvitesBadge } from './InvitesBadge';
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
  /*
   * The app's words and the app's pictures, for the places both clients have.
   *
   * They had drifted into two products. The bar on a phone said Albums,
   * Chats, Find, You over a photo stack, two bubbles, a magnifier and a head;
   * the rail said Home, Activity, Groups, Search, Profile over a house, an
   * envelope and two people. Somebody who uses both was being asked to learn
   * one product twice, and the second reading of it disagreed with the first
   * about what the thing they make is even called.
   *
   * The app wins every case where they differed, for the simple reason that it
   * is the client that had to fit the word under a glyph in 365 points and
   * chose these. `label` is what the row says; `page` is what the code calls
   * it and has not moved, because the ids are what `aria-current` is matched
   * on and what every route underneath is still named.
   */
  // Albums, not Home. The route is `/events` and the tables still say `event`:
  // the id names the row for the code, the label names it for a reader, and
  // the thing this product makes is an album.
  { href: '/events', label: 'Albums', page: 'events', glyph: 'photos' },
  /*
   * Notifications, on a tray. It was Activity, on an envelope.
   *
   * The envelope was chosen when the page was invitations and nothing else,
   * and it kept saying "somebody has asked you to something" long after the
   * page had become a friend request, a reply, a photograph added to an album
   * of yours. A tray is the general case — things arrived — which is what the
   * row has actually been for a while, and it is the drawing the app already
   * uses for the same idea.
   *
   * Near the top because this is the client somebody arrives at from a link
   * they were sent: "what came of that?" is the question this screen exists
   * for.
   */
  { href: '/activity', label: 'Notifications', page: 'invites', glyph: 'tray' },
  /*
   * Groupchats, on two bubbles. It was Groups, on two people.
   *
   * The two-people drawing is what the product uses for *members*, and it is
   * still doing that job one screen in, on a group's own People tab. Using it
   * for the room as well meant the same picture said "the room" and "who is
   * in the room" on two consecutive screens. Two bubbles say the thing a
   * group is for, which is people going back and forth — and it is the glyph
   * the app's own Chats tab carries.
   *
   * Above Search and below Notifications, because that is the order these are
   * true in: what has already happened to you, then the rooms you are already
   * in, then the one row that goes looking for something you are not part of
   * yet.
   */
  { href: '/groups', label: 'Groupchats', page: 'groups', glyph: 'bubbles' },
  // No Friends row. The page is still there and still gets its `aria-current`
  // when you are on it — it is reached from the friend count under your name
  // on Profile, which is where somebody looks for their friends anyway. A rail
  // is the places the product is, and friends is a thing about you.
  { href: '/find', label: 'Find', page: 'find', glyph: 'search' },
  { href: '/account', label: 'You', page: 'you', glyph: 'profile' },
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
      {/*
        Only on a phone, and only there: on a wide screen the rows are already
        the page's left-hand edge, and a button that hides visible navigation
        adds a step to everything.

        In the leading corner, before the name — it opens everything else, so
        it belongs ahead of the everything else rather than after it. The
        unread count rides on the closed button, because what it hides
        includes the one row that ever carries a number, and a menu that
        conceals it is a menu somebody opens to find out there was nothing to
        find.
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

      {/*
        The name, and only the name.

        It was the mark and the word as a lockup — three coloured circles with
        `parea` beside them. The app's own head has never had the mark in it:
        the top of a screen says whose product this is, and the mark says that
        in a picture the wordmark is already saying in letters. Two marks
        stacked at the top of every page is the brand asserted twice, and the
        one carrying colour into a page whose subject is somebody else's
        photographs is the one to drop.

        It is still the icon on a home screen, the face of the sign-in card
        and the figure over an empty thread — places with nothing else in them
        to say what this is.
      */}
      <div className="rail-mark">
        <span className="wordmark">Parea</span>
      </div>

      {/*
        Create, in the bar, on a phone only.

        The rows go behind the button beside this one and that is right for
        destinations — but it was right for the create button too, which put
        the one thing this product makes two taps away and at the far end of a
        panel as tall as the screen. A menu is for the places you might go;
        making an album is not a place, and it is the reason anybody opened
        the app.

        A `+` and nothing else. It was a blue pill reading `+ Create`, which
        made the loudest thing on every page a piece of chrome — on a screen
        whose subject is somebody else's photographs, the accent belongs to
        the photographs. The app has answered this already: a disc in the card
        colour with a hairline round it and the glyph at full strength, used
        for its own `+` and every corner control it has. The word survives as
        the accessible name, which is the same trade the app's tab bar makes.

        The full-width one in the panel is hidden at this width — the same
        link twice is two tab stops and two things for a screen reader to
        announce, so only one of them exists at a time.
      */}
      <a href="/" className="round rail-create" aria-label="Create an album">
        <RailIcon glyph="plus" />
      </a>

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
          <RailIcon glyph={row.glyph} weight={current === row.page ? 2.5 : 2} />
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
        {/*
          No create button here any more, and that is the change.

          It was a full-width blue slab saying Create, then the `+` disc that
          replaced it, and both had the same trouble: a column of five places
          to *go*, with the one thing to *do* at the bottom of it — the last
          corner on the screen the eye arrives at. On a laptop it is in Home's
          own head now, beside the search, which is the corner a phone already
          puts it in. This column is places and nothing else.

          The bar's copy above is untouched: on a phone the rows are behind a
          menu and the page heads are narrow, so the bar is where it fits.
        */}
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
          <RailIcon glyph="settings" weight={current === 'settings' ? 2.5 : 2} />
          <span className="rail-label">Settings</span>
        </a>
        </div>
      </div>
    </nav>
  );
}
