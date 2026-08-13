'use client';

/**
 * Friends — who they are, who is waiting, and how to find somebody.
 *
 * Three things on one screen rather than three screens, because they are one
 * errand: you came here to add somebody, to answer somebody, or to check who
 * you already have. Search is at the top because it is the thing you cannot do
 * anywhere else.
 *
 * A handle is the only way to find a person, and searching is deliberately
 * dull: no suggestions, no mutuals, no counts. What comes back is a handle and
 * whatever name they chose to show, which is exactly what the host of a
 * private event already sees when somebody knocks.
 */

import { useCallback, useEffect, useState } from 'react';

import { SiteFooter } from './SiteFooter';

type Person = { actorId: string; handle: string | null; displayName: string | null };
type Request = Person & { id: string; askedAt: string };

/** What we call somebody. The handle is the durable one; the name is theirs. */
function name(person: Person): string {
  return person.displayName || (person.handle ? `@${person.handle}` : 'Someone');
}

export function FriendsView() {
  const [friends, setFriends] = useState<Person[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[] | null>(null);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/friends');
    if (!res.ok) return;
    const body = (await res.json()) as { friends: Person[]; requests: Request[] };
    setFriends(body.friends ?? []);
    setRequests(body.requests ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Searched as you type, after a pause.
   *
   * The pause is not for the network — it is the rate limit. Sixty searches an
   * hour is generous for a person and nothing at all for a keystroke, so a
   * request per character would spend the budget on the way to typing one
   * handle and answer 429 to the search that mattered.
   */
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/people?q=${encodeURIComponent(term)}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const body = (await res.json()) as { people: Person[] };
      setResults(body.people ?? []);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const ask = useCallback(async (person: Person) => {
    setBusy(person.actorId);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      // The same word whatever happened, including the answers that mean "no":
      // a declined ask reads as sent, because telling someone they were refused
      // is the refuser's to do, not this screen's.
      setAsked((a) => ({ ...a, [person.actorId]: body.status === 'accepted' ? 'Friends' : 'Asked' }));
    } finally {
      setBusy(null);
    }
  }, []);

  const answer = useCallback(
    async (request: Request, action: 'accept' | 'decline') => {
      setBusy(request.id);
      try {
        await fetch('/api/friends', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: request.id, action }),
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (person: Person) => {
      if (!confirm(`Remove ${name(person)}? You can ask again later.`)) return;
      setBusy(person.actorId);
      try {
        await fetch(`/api/friends?actorId=${encodeURIComponent(person.actorId)}`, {
          method: 'DELETE',
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const known = new Set(friends.map((f) => f.actorId));

  return (
    <main className="main">
      <div className="main-head">
        <h1>Friends</h1>
      </div>

      <section className="panel">
        <label htmlFor="find-person">Add somebody</label>
        <input
          id="find-person"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Their handle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="field-help">
          By handle, and only by handle. Nobody is listed and there are no
          suggestions — you have to be told who somebody is before you can find
          them.
        </p>

        {results !== null && (
          results.length === 0 ? (
            <p className="muted">
              {query.trim().length < 2 ? '' : 'No handle starts with that.'}
            </p>
          ) : (
            <ul className="people">
              {results.map((person) => (
                <li key={person.actorId}>
                  <div>
                    <strong>{name(person)}</strong>
                    {person.displayName && person.handle && (
                      <p className="muted">@{person.handle}</p>
                    )}
                  </div>
                  {known.has(person.actorId) ? (
                    <span className="pip pip-declined">Friends</span>
                  ) : asked[person.actorId] ? (
                    <span className="pip pip-open">{asked[person.actorId]}</span>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() => ask(person)}
                      disabled={busy === person.actorId}
                    >
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </section>

      {requests.length > 0 && (
        <section className="panel">
          <h2>Waiting on you ({requests.length})</h2>
          <ul className="people">
            {requests.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{name(request)}</strong>
                  {request.displayName && request.handle && (
                    <p className="muted">@{request.handle}</p>
                  )}
                </div>
                <div className="row">
                  <button
                    onClick={() => answer(request, 'accept')}
                    disabled={busy === request.id}
                  >
                    Accept
                  </button>
                  <button
                    className="secondary"
                    onClick={() => answer(request, 'decline')}
                    disabled={busy === request.id}
                  >
                    Not now
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Your friends{friends.length > 0 && ` (${friends.length})`}</h2>
        {friends.length === 0 ? (
          <p className="muted">
            Nobody yet. A friend is someone you can put straight into an event
            instead of sending them a link.
          </p>
        ) : (
          <ul className="people">
            {friends.map((person) => (
              <li key={person.actorId}>
                <div>
                  <strong>{name(person)}</strong>
                  {person.displayName && person.handle && (
                    <p className="muted">@{person.handle}</p>
                  )}
                </div>
                <button
                  className="secondary"
                  onClick={() => remove(person)}
                  disabled={busy === person.actorId}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
