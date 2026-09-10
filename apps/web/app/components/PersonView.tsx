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
 *   - **a friend with nothing shared** gets "No Events Available Yet", which
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
        {/* A letter until there is a picture, and again if one will not load.
            Never a silhouette: a generic avatar is a photograph of nobody. */}
        <Avatar url={person.avatar} initial={name.replace('@', '').slice(0, 1).toUpperCase()} />

        <div className="you-id">
          <h1 className="you-name">{name}</h1>
          {/* Always, and not only when there is a display name above it: the
              handle is the durable one and the thing this page is reached by. */}
          <p className="muted you-handle">@{person.handle}</p>
          {person.bio && <p className="you-bio">{person.bio}</p>}
          {/*
            One number, and it counts the viewer's own shelf: how many of your
            events this person is also in. Their totals are not on this page —
            a profile that said "41 events" would make search a way to measure
            strangers.
          */}
          {events.length > 0 && (
            <p className="you-counts">
              <span>
                {events.length} {events.length === 1 ? 'event' : 'events'} with you
              </span>
            </p>
          )}
        </div>

        {/* Where Edit sits on your own. The quiet states are worn as a label;
            the ones that are somebody's to answer are buttons. */}
        <div className="you-act">
          {standing === 'friends' && <span className="pip">Friends</span>}
          {standing === 'asked' && <span className="pip">Asked</span>}
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
            <h2>Events</h2>
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
                    fallback={<span className="album-cover-empty" aria-hidden="true" />}
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
            {standing === 'friends' ? 'No Events Available Yet' : 'Nothing here yet'}
          </p>
        </section>
      )}
    </>
  );
}
