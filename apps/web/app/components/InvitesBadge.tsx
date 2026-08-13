'use client';

/**
 * The number beside Invites.
 *
 * Fetched on the client rather than rendered with the rail, because the rail
 * is a server component on eight pages and a client one inside the account
 * view — a count passed as a prop would have to be computed in nine places and
 * would be missing from the tenth. One component that asks for itself works
 * the same everywhere and cannot be forgotten by a page that does not know it
 * exists.
 *
 * Renders nothing until it has an answer, and nothing when the answer is zero.
 * A badge that flashes "0" on every navigation is worse than a badge that
 * arrives a moment late, and an empty circle is a claim that something is
 * there.
 */

import { useEffect, useState } from 'react';

export function InvitesBadge() {
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/invites')
      .then((r) => (r.ok ? r.json() : { waiting: 0 }))
      .then((body: { waiting?: number }) => {
        if (!cancelled) setWaiting(body.waiting ?? 0);
      })
      // Silent. A badge is the least important thing on the page and a failed
      // count must not become an error somebody has to read.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (waiting === 0) return null;

  return (
    <span className="badge" aria-label={`${waiting} waiting`}>
      {/* Past this the number stops being readable at 18px and stops being
          actionable anyway — "a lot" is the same instruction as "99". */}
      {waiting > 99 ? '99+' : waiting}
    </span>
  );
}
