'use client';

/**
 * A person, and the one thing you can do about them.
 *
 * The page is deliberately short. A handle, a name, a picture, where you two
 * stand, and the albums you are both in — which is everything the product
 * knows about somebody that it is willing to say to somebody else.
 *
 * The button is the reason the page exists. Finding a person leads to being
 * able to ask, and until now the asking happened on a search results row on
 * another screen, which meant the answer to "who is this" and the way to act
 * on it were never in the same place.
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

import type { Standing } from '@/people';

import { Face } from './Faces';

type Person = {
  actorId: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  standing: Standing;
  requestId: string | null;
};

type SharedAlbum = {
  id: string;
  name: string;
  caption: string | null;
  when: string;
  thumb: string | null;
};

export function PersonView({
  person,
  shared,
}: {
  person: Person;
  shared: SharedAlbum[];
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
      <section className="panel person">
        <Face
          src={person.avatar}
          size={72}
          className="person-face"
          fallback={<span aria-hidden="true">{name.replace('@', '').slice(0, 1).toUpperCase()}</span>}
        />
        <div className="person-who">
          <h1>{name}</h1>
          {/* The handle under the name, always — it is the durable one, and
              the name above it is whatever they last chose to show. */}
          <p className="muted">@{person.handle}</p>
        </div>

        <div className="person-act">
          {standing === 'self' && <span className="pip">This is you</span>}

          {standing === 'friends' && <span className="pip">Friends</span>}

          {standing === 'asked' && <span className="pip">Asked</span>}

          {standing === 'none' && (
            <button type="button" disabled={busy} onClick={ask}>
              Add friend
            </button>
          )}

          {standing === 'asking' && (
            <div className="row">
              <button type="button" disabled={busy} onClick={() => answer('accept')}>
                Accept
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => answer('decline')}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      </section>

      {error && (
        <section className="panel">
          <p className="panel-note">{error}</p>
        </section>
      )}

      {standing === 'asking' && (
        <section className="panel">
          <p className="muted">{name} asked to be friends.</p>
        </section>
      )}

      {/*
        Albums you are both in — the viewer's own list, filtered. Not a list of
        theirs: see `albumsWithBoth` for why the direction of that sentence is
        the whole safety property.
      */}
      {shared.length > 0 && (
        <section className="panel">
          <h2 className="hit-head">
            Both of you
            <span className="hit-head-note">
              {shared.length} {shared.length === 1 ? 'album' : 'albums'}
            </span>
          </h2>
          <ul className="hits">
            {shared.map((album) => (
              <li key={album.id}>
                <a href={`/event/${album.id}`} className="hit">
                  <Face
                    src={album.thumb}
                    size={38}
                    className="hit-thumb"
                    fallback={
                      <span aria-hidden="true">{album.name.slice(0, 1).toUpperCase()}</span>
                    }
                  />
                  <span className="hit-text">
                    <strong>{album.name}</strong>
                    <span className="muted">{album.caption ?? album.when}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Nothing else about them, and the page says so rather than ending in
        white space that reads as something still loading.
      */}
      {standing !== 'self' && shared.length === 0 && (
        <section className="panel">
          <p className="muted">
            No albums with both of you in them yet. What somebody has made is
            theirs to send you a link to — it is never listed here.
          </p>
        </section>
      )}
    </>
  );
}
