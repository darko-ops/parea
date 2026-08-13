/**
 * The web shell — the three places, as a rail.
 *
 * The web had no home. You landed on the create form, and the only route back
 * to anything was a link somebody had sent you; an event you contributed to
 * last week was unreachable unless you still had the message. The native
 * client grew three tabs for this and the web never got the equivalent, which
 * made "two clients, one protocol" true of the API and false of the product.
 *
 * The app's tab bar is Events, Find, You; the web has a fourth, Invites,
 * because it is the client where somebody arrives from a link somebody else
 * sent and needs to know what came of it. Below tablet it becomes a bar across the top, because a
 * 212px column on a phone-width browser is most of the screen.
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

export type RailPage = 'events' | 'invites' | 'friends' | 'find' | 'you' | null;

const ROWS: { href: string; label: string; page: Exclude<RailPage, null> }[] = [
  { href: '/events', label: 'Events', page: 'events' },
  // Between Events and Find because it is the same kind of thing as Events —
  // events you are in — separated only by whose they are. Find is the odd one
  // out: it is the only row that goes looking for something you are not in.
  { href: '/invites', label: 'Invites', page: 'invites' },
  { href: '/friends', label: 'Friends', page: 'friends' },
  { href: '/find', label: 'Find', page: 'find' },
  { href: '/account', label: 'You', page: 'you' },
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
          {row.label}
          {/*
            Only on the row it belongs to, and only when the page is not the
            one you are looking at: arriving on Invites is what clears it, so a
            number still sitting there while you read the list is a number
            describing a moment that has passed.
          */}
          {row.page === 'invites' && current !== 'invites' && <InvitesBadge />}
        </a>
      ))}

      <div className="rail-foot">
        <a href="/">
          <button type="button">Create Event</button>
        </a>
        <p className="rail-note">
          Events you are sent show up here once you open them.
        </p>
      </div>
    </nav>
  );
}
