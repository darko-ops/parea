/**
 * The web shell — the places you can be, as a rail.
 *
 * The web had no home. You landed on the create form, and the only route back
 * to anything was a link somebody had sent you; an event you contributed to
 * last week was unreachable unless you still had the message. The native
 * client grew three tabs for this and the web never got the equivalent, which
 * made "two clients, one protocol" true of the API and false of the product.
 *
 * Four rows, where the app's tab bar still has three. Invites is the
 * difference, and it is here first because this is the client somebody arrives
 * at from a link they were sent — the one where "what came of that?" is a
 * question worth having a screen for.
 *
 * Below tablet it becomes a bar across the top, because a 212px column on a
 * phone-width browser is most of the screen.
 *
 * No directive either way, so it renders wherever it is used: on the server
 * for the pages that are server components, and in the client bundle for the
 * account view, which has to decide between this and the sign-in screen from
 * state only it has. The rail itself is links and an active state, and renders
 * the same either way; the one thing that has to run on the client — the
 * count beside Invites — is its own component and carries its own directive,
 * so it works identically whichever side the rail was drawn on.
 *
 * Reached through `Shell` rather than used directly — a rail without the flex
 * parent it expects renders as a full-width band above the content.
 */

import { InvitesBadge } from './InvitesBadge';
import { Mark } from './Mark';
import { RailIcon, type RailGlyph } from './RailIcon';

export type RailPage = 'events' | 'invites' | 'friends' | 'find' | 'you' | 'settings' | null;

const ROWS: {
  href: string;
  label: string;
  page: Exclude<RailPage, null>;
  glyph: RailGlyph;
}[] = [
  // The label is Home, the route is `/albums`, and the id stays `events`: the
  // id names the row for the code, and every table underneath still says
  // `event`.
  { href: '/albums', label: 'Home', page: 'events', glyph: 'home' },
  // Under Home because it is the same kind of thing — events you are in —
  // separated only by whose they are. Search is the odd one out: the only row
  // that goes looking for something you are not already part of.
  // Still `invites` as an id and still the envelope: what lands here is
  // mostly somebody asking you to something, and the rest is what came of it.
  { href: '/activity', label: 'Activity', page: 'invites', glyph: 'invites' },
  // No Friends row. The page is still there and still gets its `aria-current`
  // when you are on it — it is reached from the friend count under your name
  // on Profile, which is where somebody looks for their friends anyway. A rail
  // is the four places the product is, and friends is a thing about you.
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
      <div className="rail-mark">
        {/* Sized at the call site rather than by the default: this is the
            one lockup it appears in, and the number is a relationship to the
            wordmark beside it rather than a property of the mark. */}
        <Mark size={30} />
        <span className="wordmark">Parea</span>
      </div>

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
          <button type="button">Create Album</button>
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
    </nav>
  );
}
