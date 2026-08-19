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

import { ago, albumDate, CARD_FACES, isLive } from '@parea/cards';
import { useCallback, useEffect, useState } from 'react';

import { Avatar } from './Avatar';
import { EditProfile } from './EditProfile';
import { CreateCard } from './CreateCard';
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
  caption: string | null;
  memberCount: number;
  /** People who put something in, which is how many lenses the card draws. */
  contributorCount: number;
  /** Uploaded and not yet through the deriver. */
  arrivingCount: number;
  photoCount: number;
  mosaic: string[];
  /** ISO. Becomes the "added 2 days ago" line on the card. */
  lastActiveAt: string;
  /** The album's own day, for the card's date. Any of the three may be absent. */
  eventDate: string | null;
  startsAt: string | null;
  firstPhotoAt: string | null;
  /** Host first, presigned by the route. The card draws three of them. */
  faces: { actorId: string; name: string; avatarUrl: string | null }[];
  /** Whether this person made it, decided by the server. Drives the filter. */
  mine: boolean;
  /** Whose album it is. The URL is presigned by the route; null is normal. */
  creator: { handle: string | null; avatarUrl: string | null };
};

/** Only 'loading' still matters here; the sign-in form owns its own steps. */
type Stage = 'loading' | 'email' | 'in';

export function AccountView() {
  const [stage, setStage] = useState<Stage>('loading');
  const [account, setAccount] = useState<{
    email: string;
    displayName: string | null;
    bio: string | null;
    handle: string | null;
    avatarUrl: string | null;
    phoneLast2: string | null;
  } | null>(null);
  /** Which of the three faces of this page is showing. */
  const [view, setView] = useState<'you' | 'profile' | 'settings'>('you');

  /*
   * Settings is reached from the rail now, so it arrives as `?view=settings`
   * rather than as a button press. Read after mount for the usual reason —
   * touching `location` during render makes the server's HTML and the
   * client's disagree.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'settings') {
      setView('settings');
    }
  }, []);
  const [events, setEvents] = useState<EventListing[]>([]);
  /*
   * Which albums to show. Client state rather than a URL: it is a way of
   * looking at one list, not a second page, and somebody sending their profile
   * to themselves should not be sending a filter with it.
   */
  const [lens, setLens] = useState<'all' | 'mine' | 'joined'>('all');
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

  /*
   * Signing out is a full page load, not a re-render.
   *
   * Everything server-rendered on this site is rendered *for* the actor in the
   * cookie — the rail's badge, the albums, the thread. Clearing the cookie and
   * calling `load()` would leave every one of those still on screen, correct
   * for somebody who is no longer here. Sending the browser to the front page
   * is the only way to be sure nothing of theirs is still drawn.
   */
  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/account/session', { method: 'DELETE' });
    } finally {
      window.location.href = '/';
    }
  }, []);

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

  /*
   * The two halves, and the one on screen.
   *
   * Split here rather than in the render so the counts and the list cannot
   * disagree — they are the same predicate, applied once.
   */
  const mine = events.filter((event) => event.mine);
  const joined = events.filter((event) => !event.mine);
  const shown = lens === 'mine' ? mine : lens === 'joined' ? joined : events;

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
    <Shell current={view === 'settings' ? 'settings' : 'you'}>
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
        {/*
          Sign out sits with the address it signs out of, rather than in the
          panel about deleting the account. They are next to each other and one
          of them is permanent; the sentence under the button is what keeps
          somebody from reading them as two strengths of the same thing.
        */}
        <section className="panel">
          <h2>Settings</h2>
          <p className="muted">Signed in as {account?.email}.</p>
          <div className="row settings-out">
            <button className="secondary" onClick={signOut} disabled={busy}>
              Sign out
            </button>
            <p className="muted">
              This browser forgets you and the albums you opened by link.
              Nothing is deleted, and the same address signs back in.
            </p>
          </div>
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
          {/* What somebody wrote about themselves, under the handle and above
              the counts the page worked out. */}
          {account?.bio && <p className="you-bio">{account.bio}</p>}
          {/*
            A count that goes somewhere. Null until the answer arrives rather
            than 0, because "0 friends" flashing on the profile of somebody
            with eleven of them is a worse first frame than nothing at all.
          */}
          {/*
            Two counts on one line: what you have made, and who you know. The
            albums number is not a link — you are looking at the list of them,
            three inches below.
          */}
          <p className="you-counts">
            <span>
              {events.length} {events.length === 1 ? 'album' : 'albums'}
            </span>
            {friends !== null && (
              <a className="you-friends" href="/friends">
                {friends} {friends === 1 ? 'friend' : 'friends'}
              </a>
            )}
          </p>
        </div>

        {/*
          Inside the header and above the rule, rather than a bordered button
          on its own row below it — it belongs to the name and picture it
          changes, and a slab under the divider read as the page's main action
          when the page's main action is the albums underneath.
        */}
        <button className="you-edit" onClick={() => setView('profile')}>
          Edit
        </button>
      </header>

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
        anything and needs them too. `ago` is pure and shared with native, so
        "2 days ago" rounds the same way on every surface rather than three
        times, differently.
      */}
      <section className="you-events">
        {/*
          "Albums" here and "event" everywhere else, which is a second word for
          one thing — the model note in `events.ts` records that the product
          deliberately stopped doing that. Asked for, so it is here, but it is
          the only place it says it.
        */}
        <div className="you-events-head">
          <h2>Your Albums</h2>
          {/*
            Three ways of reading one list. The counts are on the buttons
            because the difference between them is the answer somebody wants —
            "how many of these did I actually make" — and a filter that has to
            be pressed to find out is a filter you press three times.

            Only when there is a mix. With every album made by the same person
            these are three buttons, two of which empty the screen.
          */}
          {mine.length > 0 && joined.length > 0 && (
            <div className="pills">
              {(
                [
                  ['all', 'All', events.length],
                  ['mine', 'Created', mine.length],
                  ['joined', 'Joined', joined.length],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  className="pill small"
                  aria-pressed={lens === id}
                  onClick={() => setLens(id)}
                >
                  {label} <span className="pill-count">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="cards">
          {shown.map((event) => (
            <EventCard
              key={event.id}
              event={{
                id: event.id,
                name: event.name,
                photoCount: event.photoCount,
                mosaic: event.mosaic,
                caption: event.caption,
                contributorCount: event.contributorCount,
                memberCount: event.memberCount,
                arrivingCount: event.arrivingCount,
                lastActiveAt: event.lastActiveAt,
                // Every card says when it was last added to now, rather than
                // the first one saying it and the rest saying where they were.
                added: ago(new Date(event.lastActiveAt), new Date()),
                /*
                 * The same three facts the server computes for Home, computed
                 * here because this list arrives from `/api/events` rather
                 * than from `toCards`. The functions are shared — a date that
                 * formatted differently on two screens of one product is the
                 * failure a second copy produces.
                 */
                date: albumDate(event.eventDate ?? event.startsAt ?? event.firstPhotoAt ?? null),
                live: isLive(event.lastActiveAt, new Date()),
                faces: (event.faces ?? [])
                  .slice(0, CARD_FACES)
                  .map((face) => ({ name: face.name, avatar: face.avatarUrl })),
                moreFaces: Math.max(0, event.memberCount - CARD_FACES),
                creatorAvatar: event.creator?.avatarUrl ?? null,
                creatorHandle: event.creator?.handle ?? null,
              }}
            />
          ))}

          {/*
            The affordance is the empty state, exactly as on Events — and the
            same component, because it was the same eight lines twice and the
            copy here had already fallen a version behind once.

            Only under All and Created. Under Joined it would be offering to
            make an album on the screen that is deliberately showing the ones
            somebody else made.
          */}
          {lens !== 'joined' && <CreateCard />}
          {lens === 'joined' && shown.length === 0 && (
            <p className="field-help">
              Nothing yet. Albums other people ask you into show up here.
            </p>
          )}
        </div>
      </section>

      <SiteFooter />
    </>,
  );
}
