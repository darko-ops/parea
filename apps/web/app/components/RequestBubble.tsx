'use client';

/**
 * One bubble at the top of Activity: how many people are waiting on you.
 *
 * Collapsed to a count, because the count is the whole message. Three
 * invitations, two people asking into an album and a friend request used to be
 * three separate panels stacked down the page, each with a heading and a line
 * of explanation, and the thing somebody actually wants to know — is there
 * anything for me to do — could only be answered by reading all of them.
 *
 * It expands rather than links away. Every one of these is answerable in two
 * clicks and none of them needs a page of its own, so sending somebody
 * somewhere to press Accept would be a navigation that exists only because the
 * list was in the wrong place.
 *
 * Closed by default. The number is the news; the list is the detail behind it,
 * and a panel that opens itself has decided on somebody's behalf that they were
 * going to read it.
 *
 * Optimistic in one direction only, the same rule as everywhere else here: the
 * row goes as soon as the answer is sent, because whichever way it was answered
 * the question is dealt with. A failure puts it back and says so, rather than
 * leaving somebody looking at a list that has quietly not changed.
 */

import { useCallback, useState } from 'react';

import type { PendingRequest, PendingRequestKind } from '@/requests';

/** Where an answer goes, and what the two answers are called there. */
const ANSWERS: Record<
  PendingRequestKind,
  { yes: string; no: string; yesLabel: string; noLabel: string }
> = {
  invite: { yes: 'accept', no: 'decline', yesLabel: 'Accept', noLabel: 'Decline' },
  friend: { yes: 'accept', no: 'decline', yesLabel: 'Accept', noLabel: 'Decline' },
  // Not "Accept": this one is a door being opened onto photographs of an
  // evening, and the word for that is not the word for agreeing to something.
  join: { yes: 'approve', no: 'decline', yesLabel: 'Let in', noLabel: 'Not now' },
};

function endpoint(request: PendingRequest): { url: string; body: Record<string, string> } {
  switch (request.kind) {
    case 'invite':
      return { url: `/api/invites/${request.id}`, body: {} };
    case 'friend':
      return { url: '/api/friends', body: { requestId: request.id } };
    case 'join':
      return {
        url: `/api/events/${request.eventId}/access-requests`,
        body: { requestId: request.id },
      };
  }
}

export function RequestBubble({ requests }: { requests: PendingRequest[] }) {
  const [open, setOpen] = useState(requests);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = useCallback(
    async (request: PendingRequest, yes: boolean) => {
      setBusy(request.key);
      setError(null);
      const before = open;
      setOpen((list) => list.filter((r) => r.key !== request.key));
      try {
        const { url, body } = endpoint(request);
        const action = yes ? ANSWERS[request.kind].yes : ANSWERS[request.kind].no;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, action }),
        });
        if (!res.ok) throw new Error('Could not answer that.');
        // Accepting an invitation is the only answer that changes what is
        // reachable, so it is the only one that needs the page rebuilt — and
        // the place to rebuild it is the album that just opened.
        if (yes && request.kind === 'invite') {
          window.location.href = `/event/${request.eventId}`;
        }
      } catch (err) {
        setOpen(before);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [open],
  );

  // Nothing waiting is not a state worth drawing. An empty bubble saying zero
  // is a permanent reminder of an absence.
  if (open.length === 0) return null;

  const n = open.length;

  return (
    <section className={`requests${expanded ? ' requests-open' : ''}`}>
      <button
        type="button"
        className="requests-bubble"
        aria-expanded={expanded}
        aria-controls="requests-list"
        onClick={() => setExpanded((was) => !was)}
      >
        <span className="requests-count">{n}</span>
        <span className="requests-label">
          {n === 1 ? 'request waiting on you' : 'requests waiting on you'}
        </span>
        <span className="requests-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="requests-body" id="requests-list">
          {error && <p className="panel-note requests-error">{error}</p>}
          <ul className="requests-list">
            {open.map((request) => (
              <li key={request.key}>
                <div className="requests-what">
                  <strong>{request.title}</strong>
                  <p className="muted">{request.detail}</p>
                </div>
                <div className="row">
                  <button
                    className="small"
                    disabled={busy === request.key}
                    onClick={() => answer(request, true)}
                  >
                    {ANSWERS[request.kind].yesLabel}
                  </button>
                  <button
                    className="secondary small"
                    disabled={busy === request.key}
                    onClick={() => answer(request, false)}
                  >
                    {ANSWERS[request.kind].noLabel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
