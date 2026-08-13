'use client';

/**
 * "This one is private. Ask the host."
 *
 * Three states and they are genuinely different answers, so none of them is a
 * spinner or a shrug: you have not asked, you have asked and nobody has
 * answered, or they said no. The last one is the reason this does not just
 * retry — a declined request stays declined, and a button that looks pressable
 * would be inviting someone to ask again in a way the host does not see.
 */

import { useCallback, useState } from 'react';

import { SignIn, useSession } from './SignIn';
import { SiteFooter } from './SiteFooter';

type Status = 'open' | 'approved' | 'declined' | null;

export function AskToJoin({
  eventId,
  eventName,
  signedIn,
  initialStatus,
}: {
  eventId: string;
  eventName: string;
  signedIn: boolean;
  initialStatus: Status;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSession();

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/access-requests`, { method: 'POST' });
      if (!res.ok) throw new Error('That did not go through. Try again in a moment.');
      const body = (await res.json()) as { status?: Status };
      setStatus(body.status ?? 'open');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  return (
    <>
      <section className="panel">
        <h1>{eventName}</h1>

        {status === 'open' && (
          <>
            <p className="muted">
              Asked. Whoever made this event decides who comes in, and you will
              be able to open this link once they have.
            </p>
            {/*
              Somewhere to go, rather than "come back to the link" — which was
              the only answer before Invites existed and asked someone to keep
              a URL and their own patience in the same place.
            */}
            <p className="field-help">
              Nothing arrives by email. It sits under{' '}
              <a href="/invites?tab=asked">Invites</a> until they answer.
            </p>
          </>
        )}

        {status === 'declined' && (
          // Said plainly and once. A softer word here would leave someone
          // refreshing a page that is never going to change.
          <p className="muted">
            This one was not opened up to you. If that is a mistake, the person
            who made the event is the one to ask.
          </p>
        )}

        {status === null && (
          <>
            <p className="muted">
              This event is private. You have the link, which is the first half —
              the person who made it lets people in one at a time.
            </p>

            {/*
              Signing in is the step in front of asking rather than after it:
              the host is being asked to make a decision about a person, and an
              account is what makes the request name one. Shown here rather
              than behind a link to /account, so the answer lands back on this
              page instead of the You page.
            */}
            {!signedIn && !session.account && (
              <SignIn
                why="Asking needs an account, so the host knows who is asking."
                onSignedIn={() => globalThis.location.reload()}
              />
            )}

            {(signedIn || session.account) && (
              <div className="row" style={{ marginTop: 16 }}>
                <button onClick={ask} disabled={busy}>
                  {busy ? 'Asking…' : 'Ask to join'}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className="muted">{error}</p>}
      </section>

      <SiteFooter />
    </>
  );
}
