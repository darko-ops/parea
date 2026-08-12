'use client';

/**
 * Signing in on the web — design §3.
 *
 * The same three verbs the app uses, against the same endpoints: ask for a
 * code, present it, delete the account. Nothing here is web-specific except
 * how identity travels, and that is handled a layer down — the web gets a
 * cookie where native keeps a bearer token, and neither this page nor the
 * routes it calls have to know which.
 *
 * It exists at all because signing in has to be visibly worth something. On a
 * phone the payoff is obvious: a new phone is still you. In a browser it is
 * not, so this page is also the one place the web lists what someone is in —
 * §17 recorded that as deliberately unbuilt on the grounds that the web had
 * no persistent place to put it, and this is that place.
 */

import { useCallback, useEffect, useState } from 'react';

import { SignIn } from './SignIn';

type EventListing = {
  id: string;
  name: string;
  place: string | null;
  groupName: string | null;
  memberCount: number;
  photoCount: number;
};

/** Only 'loading' still matters here; the sign-in form owns its own steps. */
type Stage = 'loading' | 'email' | 'in';

export function AccountView() {
  const [stage, setStage] = useState<Stage>('loading');
  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [events, setEvents] = useState<EventListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [session, mine] = await Promise.all([
      fetch('/api/account/session').then((r) => r.json()).catch(() => ({ account: null })),
      fetch('/api/events').then((r) => r.json()).catch(() => ({ events: [] })),
    ]);
    setAccount(session.account ?? null);
    setEvents(mine.events ?? []);
    setStage(session.account ? 'in' : 'email');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const afterSignIn = useCallback(async () => {
    const next = new URLSearchParams(globalThis.location.search).get('next');
    // Same-origin paths only. `next` arrives in a URL anyone can hand over, and
    // an open redirect on the sign-in page is how a link that looks like ours
    // ends up delivering someone somewhere else.
    if (next?.startsWith('/') && !next.startsWith('//')) {
      globalThis.location.href = next;
      return;
    }
    await load();
  }, [load]);

  const remove = useCallback(
    async (alsoPhotos: boolean) => {
      const message = alsoPhotos
        ? 'Delete your account and remove every photo you have added? The photos cannot be brought back.'
        : 'Delete your account? Your email address is removed. The photos you added stay in their events, and stay yours to remove.';
      if (!confirm(message)) return;

      setBusy(true);
      try {
        await fetch(`/api/account${alsoPhotos ? '?photos=1' : ''}`, { method: 'DELETE' });
        setNote(null);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (stage === 'loading') return <main className="wrap" />;

  return (
    <main className="wrap">
      <h1>Your account</h1>

      {note && <p className="muted">{note}</p>}

      {stage !== 'in' ? (
        <SignIn why="Signing in keeps your events with you." onSignedIn={afterSignIn} />
      ) : (
        <section className="panel">
          <p>
            Signed in as <strong>{account?.email}</strong>
          </p>
          <p className="muted">
            Your events and groups follow you to another browser or a new
            phone. That is all an account does here.
          </p>
        </section>
      )}

      {events.length > 0 && (
        <section className="panel">
          <h2>What you are in</h2>
          <ul className="plain">
            {events.map((event) => (
              <li key={event.id}>
                <a href={`/event/${event.id}`}>{event.name}</a>
                <span className="muted">
                  {' · '}
                  {event.memberCount} {event.memberCount === 1 ? 'person' : 'people'}
                  {' · '}
                  {event.photoCount} {event.photoCount === 1 ? 'photo' : 'photos'}
                  {event.groupName && ` · ${event.groupName}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stage === 'in' && (
        <section className="panel">
          <h2>Delete your account</h2>
          {/*
            Two separate things, in front of someone rather than chosen for
            them. Folding the second into the first would take away other
            people's copies of an evening they were also at.
          */}
          <p className="muted">
            Removing your account removes your email address and the link
            between it and your devices. The photos you added stay in their
            events and stay yours to remove.
          </p>
          <div className="row">
            <button className="secondary" onClick={() => remove(false)} disabled={busy}>
              Delete account
            </button>
            <button className="danger" onClick={() => remove(true)} disabled={busy}>
              Delete account and all my photos
            </button>
          </div>
        </section>
      )}

      <p className="muted footer">
        <a href="/safety">Safety, reporting and contact</a>
      </p>
    </main>
  );
}
