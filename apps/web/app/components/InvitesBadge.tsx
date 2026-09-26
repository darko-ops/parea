'use client';

/**
 * The mark beside Invites — a number, or a dot, or nothing.
 *
 * Fetched on the client rather than rendered with the rail, because the rail
 * is a server component on eight pages and a client one inside the account
 * view — a count passed as a prop would have to be computed in nine places and
 * would be missing from the tenth. One component that asks for itself works
 * the same everywhere and cannot be forgotten by a page that does not know it
 * exists.
 *
 * ## Why two shapes
 *
 * The number is things waiting on an answer, and each is a job: four
 * invitations is a different afternoon from one. Below that there is a second
 * thing worth saying and it is not a quantity — somebody commented on your
 * photograph, or tagged you in one, or added thirty to an album you were at.
 * Counting those would make the badge a measure of volume, and a number that
 * only goes down when you look is a number that stops meaning anything.
 *
 * So news that cannot be answered is a dot. It is the smaller claim on
 * purpose: *there is something in there*, which is all a badge over a list can
 * honestly promise. The number wins when there is one, because a job is the
 * more urgent of the two and two marks on one row is a row nobody reads.
 *
 * Renders nothing until it has an answer, and nothing when there is neither.
 * A badge that flashes "0" on every navigation is worse than a badge that
 * arrives a moment late, and an empty circle is a claim that something is
 * there.
 */

import { useEffect, useState } from 'react';

export function InvitesBadge() {
  const [waiting, setWaiting] = useState(0);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/invites')
      .then((r) => (r.ok ? r.json() : { waiting: 0, unread: false }))
      .then((body: { waiting?: number; unread?: boolean }) => {
        if (cancelled) return;
        setWaiting(body.waiting ?? 0);
        setUnread(body.unread ?? false);
      })
      // Silent. A badge is the least important thing on the page and a failed
      // count must not become an error somebody has to read.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (waiting > 0) {
    return (
      <span className="badge" aria-label={`${waiting} waiting`}>
        {/* Past this the number stops being readable at 18px and stops being
            actionable anyway — "a lot" is the same instruction as "99". */}
        {waiting > 99 ? '99+' : waiting}
      </span>
    );
  }

  if (!unread) return null;

  // No text in it, so the label is the whole of what it says.
  return <span className="badge badge-dot" aria-label="Something new" />;
}
