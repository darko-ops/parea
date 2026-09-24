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
 * ## Below tablet the rows are a bar along the bottom
 *
 * Three shapes in three versions of this file. They were laid out sideways
 * first, which fitted at four rows and stopped at six — the bar scrolled, so
 * Profile hung half off the screen and Settings was past the edge with nothing
 * to say it was there. Then they went behind a hamburger, which made every
 * destination two taps and hid the one row that ever carries a number.
 *
 * Now they are where the app puts them: a capsule floating clear of the bottom
 * edge, glyph-only, with the page you are on seated in it. It is the shape a
 * thumb reaches without a menu in between, and it is the one piece of
 * navigation in this product that both clients can share.
 *
 * Still one set of markup. `.rail-nav` is a column on a laptop and that
 * capsule on a phone — the labels are hidden rather than deleted, so what a
 * screen reader announces is the same word in both, and `.rail-foot` becomes
 * `display: contents` so Settings joins the row rather than hanging under it.
 *
 * And it renders on the server again. The hamburger was the only state in
 * here and `'use client'` was the price of it; the count beside Activity owns
 * its own boundary, which is why it could be paid back.
 *
 * Reached through `Shell` rather than used directly — a rail without the flex
 * parent it expects renders as a full-width band above the content.
 */

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
  return (
    <nav className="rail" aria-label="Sections">
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
        making an event is not a place, and it is the reason anybody opened
        the app.

        Condensed to a pill because it shares a 375px bar with the wordmark
        and the menu: the word alone, at rail weight, left no room for either.
        The full-width one in the panel is hidden at this width — the same
        link twice is two tab stops and two things for a screen reader to
        announce, so only one of them exists at a time.
      */}
      <a href="/" className="rail-create" aria-label="Create an album">
        <span aria-hidden="true">+</span>
        <span>Create</span>
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
          <RailIcon glyph="settings" weight={current === 'settings' ? 2.5 : 2} />
          <span className="rail-label">Settings</span>
        </a>
        </div>
      </div>
    </nav>
  );
}
