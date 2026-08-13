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

import { Avatar } from './Avatar';
import { EditProfile } from './EditProfile';
import { LoginScreen } from './LoginScreen';
import { SignIn } from './SignIn';
import { SiteFooter } from './SiteFooter';

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
  const [account, setAccount] = useState<{
    email: string;
    displayName: string | null;
    handle: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [name, setName] = useState('');
  /** Which of the three faces of this page is showing. */
  const [view, setView] = useState<'you' | 'profile' | 'settings'>('you');
  const [events, setEvents] = useState<EventListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [session, mine] = await Promise.all([
      fetch('/api/account/session').then((r) => r.json()).catch(() => ({ account: null })),
      fetch('/api/events').then((r) => r.json()).catch(() => ({ events: [] })),
    ]);
    setAccount(session.account ?? null);
    setName(session.account?.displayName ?? '');
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

  /**
   * Saved on blur rather than behind a button.
   *
   * One optional field with no validation and nothing depending on it: a Save
   * button would be a second thing to press for a change that cannot fail, and
   * the failure it guards against — leaving without saving — is the one it
   * causes.
   */
  const saveName = useCallback(async () => {
    const next = name.trim();
    if (next === (account?.displayName ?? '')) return;
    await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: next }),
    }).catch(() => {});
    setAccount((a) => (a ? { ...a, displayName: next || null } : a));
  }, [account, name]);

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

  if (stage !== 'in') {
    return (
      <LoginScreen>
        <SignIn
          title="Sign in"
          why="Create an event, or add your photos to one."
          onSignedIn={afterSignIn}
        />
      </LoginScreen>
    );
  }

  const initial = (name.trim() || account?.email || '?').slice(0, 1).toUpperCase();

  if (view === 'profile' && account) {
    return (
      <main className="wrap you">
        <EditProfile
          profile={account}
          onSaved={load}
          onDone={() => setView('you')}
        />
      </main>
    );
  }

  if (view === 'settings') {
    return (
      <main className="wrap you">
        <section className="panel">
          <h2>Settings</h2>
          <p className="muted">Signed in as {account?.email}.</p>
        </section>

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

        <div className="row">
          <button onClick={() => setView('you')}>Done</button>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap you">
      <header className="you-head">
        {/*
          A letter until there is a picture, and again if one will not load.
          Not a silhouette: a generic avatar is a photograph of nobody, and
          this at least belongs to the person looking at it.
        */}
        <Avatar url={account?.avatarUrl ?? null} initial={initial} />

        <div className="you-id">
          <input
            className="you-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            placeholder="Your name"
            maxLength={80}
            aria-label="The name shown beside your photos"
          />
          {account?.handle ? (
            <p className="muted you-handle">@{account.handle}</p>
          ) : (
            <p className="muted you-handle">
              <button className="link" onClick={() => setView('profile')}>
                Pick a handle
              </button>
            </p>
          )}
        </div>
      </header>

      <div className="row you-actions">
        <button className="secondary" onClick={() => setView('profile')}>
          Edit profile
        </button>
        <button className="secondary" onClick={() => setView('settings')}>
          Settings
        </button>
      </div>

      {note && <p className="muted">{note}</p>}

      <section className="you-events">
        <h2>Your events</h2>
        {events.length === 0 ? (
          <p className="muted">
            Nothing yet. <a href="/">Start an event</a>, or open a link somebody
            sent you.
          </p>
        ) : (
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
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
