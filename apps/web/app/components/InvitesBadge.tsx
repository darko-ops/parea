'use client';

/**
 * The marks in the rail — a number, a dot, or nothing.
 *
 * Fetched on the client rather than rendered with the rail, because the rail
 * is a server component on eight pages and a client one inside the account
 * view — a count passed as a prop would have to be computed in nine places and
 * would be missing from the tenth. One component that asks for itself works
 * the same everywhere and cannot be forgotten by a page that does not know it
 * exists.
 *
 * ## Two rows, three shapes
 *
 * On **Notifications** the number is things waiting on an answer, and each is
 * a job: four invitations is a different afternoon from one. Below that there
 * is a second thing worth saying and it is not a quantity — somebody commented
 * on your photograph, reacted to one, tagged you in one, added thirty to an
 * album you were at. Counting those would make the badge a measure of volume,
 * and a number that only goes down when you look is a number that stops
 * meaning anything. So news that cannot be answered is a dot, and the number
 * wins when there is one: a job is the more urgent of the two, and two marks
 * on one row is a row nobody reads.
 *
 * On **Chat** there is only ever the dot. The page is a list of rooms, each
 * carrying its own unread count, and a total across them answers a question
 * nobody asked — what the rail has to say is *there is something in there*.
 *
 * Renders nothing until it has an answer, and nothing when there is nothing.
 * A badge that flashes "0" on every navigation is worse than a badge that
 * arrives a moment late, and an empty circle is a claim that something is
 * there.
 */

import { useEffect, useState } from 'react';

type Marks = { waiting: number; unread: boolean; chats: boolean };

const NOTHING: Marks = { waiting: 0, unread: false, chats: false };

/**
 * One request for however many of these are on the page.
 *
 * The rail draws three: the burger's, the Notifications row's and the Chat
 * row's. Left alone that is three fetches of one endpoint on every navigation,
 * and that endpoint is not cheap — it reads the whole activity feed to decide
 * whether anything in it is new.
 *
 * Shared only while a request is actually in flight, and dropped the moment it
 * settles. A cache with a lifetime would need a rule about when it goes stale
 * and something to invalidate it; this needs neither, because the only thing
 * it collapses is *simultaneous* asks — which is exactly what three components
 * mounting in one render are.
 */
let inFlight: Promise<Marks> | null = null;

function marks(): Promise<Marks> {
  if (inFlight) return inFlight;
  inFlight = fetch('/api/invites')
    .then((r) => (r.ok ? r.json() : NOTHING))
    .then((body: Partial<Marks>) => ({
      waiting: body.waiting ?? 0,
      unread: body.unread ?? false,
      chats: body.chats ?? false,
    }))
    // Silent. A badge is the least important thing on the page and a failed
    // count must not become an error somebody has to read.
    .catch(() => NOTHING)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function InvitesBadge({
  /**
   * Which row this is on. `waiting` is the Notifications row and the burger
   * that stands in for the whole rail below tablet; `chats` is the Chat row.
   */
  mark = 'waiting',
}: {
  mark?: 'waiting' | 'chats';
}) {
  const [state, setState] = useState<Marks>(NOTHING);

  useEffect(() => {
    let cancelled = false;
    void marks().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mark === 'chats') {
    if (!state.chats) return null;
    return <span className="badge badge-dot" aria-label="Unread messages" />;
  }

  if (state.waiting > 0) {
    return (
      <span className="badge" aria-label={`${state.waiting} waiting`}>
        {/* Past this the number stops being readable at 18px and stops being
            actionable anyway — "a lot" is the same instruction as "99". */}
        {state.waiting > 99 ? '99+' : state.waiting}
      </span>
    );
  }

  if (!state.unread) return null;

  // No text in it, so the label is the whole of what it says.
  return <span className="badge badge-dot" aria-label="Something new" />;
}
