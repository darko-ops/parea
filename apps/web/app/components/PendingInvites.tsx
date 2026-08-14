'use client';

/**
 * Invitations waiting on you, and the two answers.
 *
 * This is the screen that makes the new invitation model honest. A host adding
 * somebody by handle used to write straight into their account; now it writes
 * an offer, and nothing happens until the offer is answered here.
 *
 * Both answers are the same weight. "Accept" is the filled button because it
 * is the one somebody usually means, but declining is a button beside it and
 * not a small grey word off to one side — being able to say no easily is the
 * whole reason the offer exists.
 *
 * Optimistic, and only in one direction: the row goes as soon as the request
 * is sent, because whichever answer was given the invitation is dealt with.
 * A failure puts it back and says so, rather than leaving somebody looking at
 * a list that has silently not changed.
 */

import { useCallback, useState } from 'react';

export type PendingInvite = {
  id: string;
  eventId: string;
  eventName: string;
  caption: string | null;
  from: string;
};

export function PendingInvites({ invites }: { invites: PendingInvite[] }) {
  const [open, setOpen] = useState(invites);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = useCallback(
    async (invite: PendingInvite, action: 'accept' | 'decline') => {
      setBusy(invite.id);
      setError(null);
      const before = open;
      setOpen((list) => list.filter((i) => i.id !== invite.id));
      try {
        const res = await fetch(`/api/invites/${invite.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error('Could not answer that.');
        // Accepting is the only one that changes what is reachable, so it is
        // the only one that needs the page rebuilt.
        if (action === 'accept') window.location.href = `/event/${invite.eventId}`;
      } catch (err) {
        setOpen(before);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [open],
  );

  if (open.length === 0) return null;

  return (
    <section className="panel">
      <h2>Waiting on you</h2>
      <p className="panel-note">
        Somebody has asked you into these. Nothing is shared with you until you
        say yes.
      </p>

      {error && <p className="panel-note">{error}</p>}

      <ul className="people">
        {open.map((invite) => (
          <li key={invite.id}>
            <div>
              <strong>{invite.eventName}</strong>
              <p className="muted">
                {invite.from} asked you
                {invite.caption ? ` · ${invite.caption}` : ''}
              </p>
            </div>
            <div className="row">
              <button
                className="small"
                disabled={busy === invite.id}
                onClick={() => answer(invite, 'accept')}
              >
                Accept
              </button>
              <button
                className="secondary small"
                disabled={busy === invite.id}
                onClick={() => answer(invite, 'decline')}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
