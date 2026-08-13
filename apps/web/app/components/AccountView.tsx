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

import { metaFor } from '@parea/cards';
import { useCallback, useEffect, useState } from 'react';

import { Avatar } from './Avatar';
import { EditProfile } from './EditProfile';
import { EventCard } from './EventCard';
import { LoginScreen } from './LoginScreen';
import { Shell } from './Shell';
import { SignIn } from './SignIn';
import { SiteFooter } from './SiteFooter';

/**
 * What `/api/events` hands back, narrowed to what a card needs.
 *
 * `mosaic` arrives already signed — the URLs are signed against the event's
 * `cap_epoch`, so rotating a link stops its thumbnails resolving, and nothing
 * on this side could sign one anyway.
 */
type EventListing = {
  id: string;
  name: string;
  place: string | null;
  memberCount: number;
  photoCount: number;
  mosaic: string[];
  /** ISO. Feeds the relative "added to …" half of the meta line. */
  lastActiveAt: string;
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
  /** Which of the three faces of this page is showing. */
  const [view, setView] = useState<'you' | 'profile' | 'settings'>('you');
  const [events, setEvents] = useState<EventListing[]>([]);
  const [friends, setFriends] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [session, mine, mates] = await Promise.all([
      fetch('/api/account/session').then((r) => r.json()).catch(() => ({ account: null })),
      fetch('/api/events').then((r) => r.json()).catch(() => ({ events: [] })),
      fetch('/api/friends').then((r) => r.json()).catch(() => ({ friends: [] })),
    ]);
    setAccount(session.account ?? null);
    setEvents(mine.events ?? []);
    setFriends(mates.friends?.length ?? 0);
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

  const initial = (account?.displayName?.trim() || account?.email || '?')
    .slice(0, 1)
    .toUpperCase();

  /**
   * Everything below here is signed in, so it gets the rail.
   *
   * Below rather than around: the sign-in screen returns above this, and it is
   * a white page with one card in the middle and no way out that is not
   * signing in. A navigation rail beside it offers three destinations that all
   * lead back here. The loading state has none either — a rail that appears
   * and then vanishes as the session resolves is worse than one that arrives
   * late.
   */
  const page = (children: React.ReactNode) => (
    <Shell current="you">
      <main className="wrap you">{children}</main>
    </Shell>
  );

  if (view === 'profile' && account) {
    return page(
      <EditProfile profile={account} onSaved={load} onDone={() => setView('you')} />,
    );
  }

  if (view === 'settings') {
    return page(
      <>
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
      </>,
    );
  }

  return page(
    <>
      <header className="you-head">
        {/*
          A letter until there is a picture, and again if one will not load.
          Not a silhouette: a generic avatar is a photograph of nobody, and
          this at least belongs to the person looking at it.
        */}
        <Avatar url={account?.avatarUrl ?? null} initial={initial} />

        {/*
          Read, not write. Both of these are edited one button away, and a
          field that saves on blur sitting next to a button labelled "Edit
          profile" is two answers to the same question — the one that looks
          like a heading wins by accident, and the other stops being where
          changes are made.
        */}
        <div className="you-id">
          <h1 className="you-name">{account?.displayName || account?.email}</h1>
          {/* No handle, no line. There is nothing to say here that "Edit
              profile" does not already say, and a prompt in this spot would be
              the third place to change one. */}
          {account?.handle && <p className="muted you-handle">@{account.handle}</p>}
          {/*
            A count that goes somewhere. Null until the answer arrives rather
            than 0, because "0 friends" flashing on the profile of somebody
            with eleven of them is a worse first frame than nothing at all.
          */}
          {friends !== null && (
            <a className="you-friends" href="/friends">
              {friends} {friends === 1 ? 'friend' : 'friends'}
            </a>
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

      {/*
        The same cards as Events, from the same data.

        This was a bulleted list of names with a dot-separated tail, which is
        the thing the card design exists to replace: a name is a poor way to
        recognise a night out and the photographs are a good one. Two ways of
        drawing one object is also two things to keep in step, and the list was
        already a version behind — it never grew the relative "added to" line.

        Built here rather than fetched differently: `/api/events` already
        returns signed mosaic URLs, because the native client cannot sign
        anything and needs them too. `metaFor` is pure and shared with native,
        so the sentence under the name is the same sentence on all three
        surfaces rather than a third rounding of "2 days ago".
      */}
      <section className="you-events">
        <h2>Your events</h2>
        <div className="cards">
          {events.map((event, index) => (
            <EventCard
              key={event.id}
              event={{
                id: event.id,
                name: event.name,
                photoCount: event.photoCount,
                mosaic: event.mosaic,
                // `newest` only for the first, matching Events: the top card
                // says when it was last added to, the rest say where they were.
                meta: metaFor(event, { newest: index === 0, now: new Date() }),
              }}
            />
          ))}

          {/*
            The affordance is the empty state, exactly as on Events. With no
            events this is the only cell and it says what the product does
            instead of apologising for having nothing to show.
          */}
          <a href="/" className="card-new">
            <strong>Create Event</strong>
            <span>
              Name it, say when it was, send the link. Nothing to sign up for
              at the other end to look.
            </span>
          </a>
        </div>
      </section>

      <SiteFooter />
    </>,
  );
}
