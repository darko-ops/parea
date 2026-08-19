'use client';

/**
 * A person, laid out the way your own profile is.
 *
 * Deliberately the same page with two things taken out and one put in: no
 * Edit, because it is not yours to edit, and the albums are the ones you can
 * both see rather than everything they have. Where Edit sits, the one thing
 * you can do about somebody sits instead — ask to be friends, or answer their
 * asking.
 *
 * Same shape on purpose. Somebody arriving here from a search result has seen
 * their own profile already, and a second layout for the same kind of object
 * means reading the screen before reading the person.
 *
 * ## The albums, and the two ways of having none
 *
 * The list is the viewer's own, filtered to the ones this person is also in —
 * see `albumsWithBoth`, where the direction of that sentence is the whole
 * safety property. So an empty list means two quite different things, and it
 * says which:
 *
 *   - **a friend with nothing shared** gets "No Albums Available Yet", which
 *     is about the two of you and is likely to change;
 *   - **anybody else** gets "Account Private", which is the honest answer to
 *     "why can I not see anything": not that they have nothing, but that what
 *     somebody has made is theirs to send you a link to.
 *
 * Neither says how much is behind the door. "Account Private" over four
 * hundred albums and over none reads identically, which is the point.
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
  albums,
}: {
  person: Person;
  /** Albums the viewer can see that this person is also in. */
  albums: CardEvent[];
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
            albums this person is also in. Their totals are not on this page —
            a profile that said "41 albums" would make search a way to measure
            strangers.
          */}
          {albums.length > 0 && (
            <p className="you-counts">
              <span>
                {albums.length} {albums.length === 1 ? 'album' : 'albums'} with you
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

      <section className="you-events">
        <div className="you-events-head">
          <h2>Albums</h2>
        </div>

        {albums.length > 0 ? (
          <div className="cards">
            {albums.map((album) => (
              <EventCard key={album.id} event={album} />
            ))}
          </div>
        ) : (
          /*
            The two empty states, and they are different sentences rather than
            one sentence with a word swapped. Being told there is nothing *yet*
            is a fact about the two of you; being told the account is private
            is a fact about how this product works, and it is the true answer
            to "why is this page empty" for somebody who is not a friend.
          */
          <p className="muted person-empty">
            {standing === 'friends' ? 'No Albums Available Yet' : 'Account Private'}
          </p>
        )}
      </section>
    </>
  );
}
