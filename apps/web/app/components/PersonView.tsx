'use client';

/**
 * A person, laid out the way your own profile is.
 *
 * Deliberately the same page with two things taken out and one put in: no
 * Edit, because it is not yours to edit, and the events are the ones you can
 * both see rather than everything they have. Where Edit sits, the one thing
 * you can do about somebody sits instead — ask to be friends, or answer their
 * asking.
 *
 * Same shape on purpose. Somebody arriving here from a search result has seen
 * their own profile already, and a second layout for the same kind of object
 * means reading the screen before reading the person.
 *
 * ## Their albums, and the door on the locked ones
 *
 * Under the shared events, everything this person has made. A public one is a
 * card that opens; a private one the viewer is not in is a name, a date and
 * "Ask to join" — no cover, because a cover is a photograph out of the album
 * and usually the best one.
 *
 * This is the profile's part of what private means. The other way in is a link
 * somebody sent you; this is the way that works when nobody sent you anything,
 * and it is why the album has to be listed at all. What it does *not* do is
 * say how big it is, who is in it, or when anybody last added to it.
 *
 * ## The events, and the two ways of having none
 *
 * The list is the viewer's own, filtered to the ones this person is also in —
 * see `eventsWithBoth`, where the direction of that sentence is the whole
 * safety property. So an empty list means two quite different things, and it
 * says which:
 *
 *   - **a friend with nothing shared** gets "No albums to show yet", which
 *     is about the two of you and is likely to change;
 *   - **anybody else** gets "Account Private", which is the honest answer to
 *     "why can I not see anything": not that they have nothing, but that what
 *     somebody has made is theirs to send you a link to.
 *
 * Neither says how much is behind the door. "Account Private" over four
 * hundred events and over none reads identically, which is the point.
 *
 * ## Why "Asked" is what a refusal says too
 *
 * `/api/friends` answers a repeat ask with the status it already holds, and a
 * declined one stays declined — "no" is said once rather than becoming
 * something to press past. This screen shows that as "Asked", the same as an
 * open one. Telling somebody they were refused is the refuser's to do; a
 * button that read "Declined" would make the product do it for them, over and
 * over, every time they visited the page.
 */

import { useCallback, useState } from 'react';

import type { CardEvent } from '@/cards';
import type { Standing } from '@/people';

import { Avatar } from './Avatar';
import { EventCard } from './EventCard';
import { Face } from './Faces';
import { ShareProfile } from './ShareProfile';

export type ProfileAlbumCard = {
  id: string;
  name: string;
  /** Private, and this viewer is not in it. */
  locked: boolean;
  cover: string | null;
  /** Null on a locked album. */
  photoCount: number | null;
  date: string | null;
};

type Person = {
  actorId: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  standing: Standing;
  requestId: string | null;
  /** Their own three totals — see `ProfileCounts`. */
  counts: { albums: number; photos: number; friends: number };
};

export function PersonView({
  person,
  events,
  albums,
}: {
  person: Person;
  /** Events the viewer can see that this person is also in. */
  events: CardEvent[];
  /** Everything this person made, minus the ones already drawn above. */
  albums: ProfileAlbumCard[];
}) {
  const [standing, setStanding] = useState<Standing>(person.standing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Their name, or their handle standing in for one.
   *
   * A name is bare and a handle wears its `@`: the sigil is not decoration on
   * a person, it is what marks the string as the thing you can type at a
   * search box. The app says the same thing in `nameOf`.
   */
  const name = person.displayName?.trim() || `@${person.handle}`;

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      if (!res.ok) throw new Error('Could not send that.');
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      // Accepted happens when they had already asked you and this crossed with
      // it — the endpoint answers the open request rather than opening a second
      // one, and the page should say what is now true.
      setStanding(body.status === 'accepted' ? 'friends' : 'asked');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [person.actorId]);

  /**
   * Taking the ask back.
   *
   * The same button that reports the state, because that is the only reading
   * of a pressable control that reports one — and because withdrawing is the
   * one thing left in the viewer's gift once they have asked. `DELETE` clears
   * the friendship and both open requests between the two actors, so nothing
   * is left behind for the next ask to collide with.
   */
  const unask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/friends?actorId=${encodeURIComponent(person.actorId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Could not take that back.');
      setStanding('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [person.actorId]);

  const answer = useCallback(
    async (action: 'accept' | 'decline') => {
      if (!person.requestId) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/friends', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: person.requestId, action }),
        });
        if (!res.ok) throw new Error('Could not answer that.');
        setStanding(action === 'accept' ? 'friends' : 'none');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [person.requestId],
  );

  return (
    <>
      <header className="you-head">
        {/*
          The picture, hanging from the bar on a phone and standing beside the
          name on a laptop — the same ribbon your own profile has, because it
          is the same page about a different person. See `.you-ribbon`, and
          `AccountView` for what the shape is borrowed from.
        */}
        <div className="you-ribbon">
          {/* A letter until there is a picture, and again if one will not load.
              Never a silhouette: a generic avatar is a photograph of nobody. */}
          <Avatar
            url={person.avatar}
            initial={name.replace('@', '').slice(0, 1).toUpperCase()}
          />
        </div>

        <div className="you-id">
          <h1 className="you-name">{name}</h1>
          {/* Always, and not only when there is a display name above it: the
              handle is the durable one and the thing this page is reached by. */}
          <p className="muted you-handle">@{person.handle}</p>
          {person.bio && <p className="you-bio">{person.bio}</p>}
          {/*
            The three their own profile prints, in the same order and the same
            words — counted once by `profileFor` so the app's version of this
            screen cannot disagree with it.

            It used to be one number, counting the *viewer's* shelf, on the
            argument that their own totals would make search a way to measure
            strangers. The albums below undid that argument: every one they
            made is already listed by name, locked included, so the count says
            nothing the page has not.
          */}
          <p className="you-counts">
            <span>
              {person.counts.albums} {person.counts.albums === 1 ? 'album' : 'albums'}
            </span>
            <span>
              {person.counts.photos} {person.counts.photos === 1 ? 'photo' : 'photos'}
            </span>
            <span>
              {person.counts.friends} {person.counts.friends === 1 ? 'friend' : 'friends'}
            </span>
          </p>
        </div>

        {/* Where Edit and Share sit on your own. The quiet states are worn as a
            label; the ones that are somebody's to answer are buttons. */}
        <div className="you-act">
          {/*
            Handing somebody this person's page.

            The app deliberately has one control here — "the only thing you can
            do about somebody" — and that argument is about the friend decision
            not being crowded, which it still is not: sharing is not a thing
            you do *to* a person. A browser also makes the case the phone
            cannot, because the address is already in the bar above: a button
            that copies it is the page agreeing with what somebody was about to
            do by hand.

            First and quiet, so the control that is a decision is the last
            thing read on the row and the one with a verb about a person on it.
          */}
          <ShareProfile handle={person.handle} />
          {standing === 'friends' && <span className="pip">Friends</span>}
          {/*
            "Requested", and pressing it withdraws.

            It was a flat `pip` reading "Asked" — a state worn rather than
            offered — which left the one thing the viewer could still do about
            an open request with nowhere to be done from: the only way out was
            for the other person to answer. The word went with it. "Asked" is
            the past tense of what you did; "Requested" is the state it left
            you in, which is what a control standing for a state should say.

            A declined ask still reads the same as an open one, and still
            should: `/api/friends` answers a repeat with the status it holds,
            and telling somebody they were refused is the refuser's to do.
            Pressing this on a declined one clears the row, which is the same
            thing withdrawing does and no more than the page already implies.
          */}
          {standing === 'asked' && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={unask}
              aria-label="Requested. Press to take your request back"
            >
              Requested
            </button>
          )}
          {standing === 'none' && (
            <button type="button" className="small" disabled={busy} onClick={ask}>
              Add friend
            </button>
          )}
          {standing === 'asking' && (
            <div className="row">
              <button
                type="button"
                className="small"
                disabled={busy}
                onClick={() => answer('accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={busy}
                onClick={() => answer('decline')}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      </header>

      {error && <p className="panel-note">{error}</p>}

      {events.length > 0 && (
        <section className="you-events">
          <div className="you-events-head">
            <h2>Albums</h2>
          </div>
          <div className="cards">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="you-events">
          <div className="you-events-head">
            <h2>{events.length > 0 ? 'Their other albums' : 'Albums'}</h2>
          </div>
          {/*
            What the padlocks are for, said once above them rather than per
            row. A list of shut doors is a page that reads as a refusal; the
            sentence is what turns it into a queue. Only while there is
            something shut and a way to open it — a friend reading this would
            be told to do a thing they have already done.
          */}
          {standing !== 'friends' && albums.some((album) => album.locked) && (
            <p className="muted person-locked-note">
              Become friends to see what&rsquo;s inside.
            </p>
          )}
          <ul className="album-list">
            {albums.map((album) => (
              <li key={album.id} className="album-row">
                {/*
                  A locked album goes to its door rather than to itself. Both
                  hrefs are plain links: the page on the other end decides, and
                  a button that POSTed from here would be a second copy of that
                  decision in a place that cannot see the block.
                */}
                <a
                  className={album.locked ? 'album-card album-locked' : 'album-card'}
                  href={album.locked ? `/event/${album.id}/request` : `/event/${album.id}`}
                >
                  {/*
                    `Face` rather than a bare `<img>`, for the reason it exists
                    everywhere else on this page: a cover is presigned for an
                    hour, so a tab left open long enough is holding a URL that
                    has expired, and the browser's answer to that is the
                    broken-image glyph. The empty frame stands in — which is
                    also exactly what a locked album draws, since it has no
                    cover to sign.
                  */}
                  <Face
                    src={album.cover}
                    size={52}
                    className="album-cover"
                    fallback={
                      /*
                        A padlock in the empty frame on a locked one, and a
                        bare frame on an unlocked album that simply has no
                        cover yet: the same glyph an album's own header wears
                        to mean private, so the thing that means "shut" means
                        it in one shape across both clients.
                      */
                      <span className="album-cover-empty" aria-hidden="true">
                        {album.locked && (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            focusable="false"
                          >
                            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                          </svg>
                        )}
                      </span>
                    }
                  />
                  <span className="album-what">
                    <span className="album-name">{album.name}</span>
                    <span className="album-detail">
                      {album.locked
                        ? 'Private · ask to join'
                        : [
                            album.date,
                            album.photoCount === null
                              ? null
                              : `${album.photoCount} ${
                                  album.photoCount === 1 ? 'photo' : 'photos'
                                }`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length === 0 && albums.length === 0 && (
        /*
          One empty state now, where there were two.

          "Account Private" was the honest answer when a profile listed nothing
          a stranger was not already in: not that they have nothing, but that
          what somebody has made is theirs to send you a link to. Albums are
          listed now, so that sentence would be a lie — the page has just shown
          you everything they made, and there was none of it.
        */
        <section className="you-events">
          <p className="muted person-empty">
            {standing === 'friends' ? 'No albums to show yet' : 'Nothing here yet'}
          </p>
        </section>
      )}
    </>
  );
}
