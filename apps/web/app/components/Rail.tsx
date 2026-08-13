/**
 * The web shell — the three places, as a rail.
 *
 * The web had no home. You landed on the create form, and the only route back
 * to anything was a link somebody had sent you; an event you contributed to
 * last week was unreachable unless you still had the message. The native
 * client grew three tabs for this and the web never got the equivalent, which
 * made "two clients, one protocol" true of the API and false of the product.
 *
 * Same three destinations, same order, same words as the app's tab bar:
 * Events, Find, You. Below tablet it becomes a bar across the top, because a
 * 212px column on a phone-width browser is most of the screen.
 *
 * No directive either way, so it renders wherever it is used: on the server
 * for the pages that are server components, and in the client bundle for the
 * account view, which has to decide between this and the sign-in screen from
 * state only it has. Nothing in here is a hook or an effect, so both are the
 * same render.
 *
 * Reached through `Shell` rather than used directly — a rail without the flex
 * parent it expects renders as a full-width band above the content.
 */

import { Mark } from './Mark';

export type RailPage = 'events' | 'find' | 'you' | null;

const ROWS: { href: string; label: string; page: Exclude<RailPage, null> }[] = [
  { href: '/events', label: 'Events', page: 'events' },
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
        </a>
      ))}

      <div className="rail-foot">
        <a href="/">
          <button type="button">Start an event</button>
        </a>
        <p className="rail-note">
          Events you are sent show up here once you open them.
        </p>
      </div>
    </nav>
  );
}
