'use client';

/**
 * Who is in it, chosen while the event is being made.
 *
 * The same two lists the Members tab shows — your friends, and anybody by
 * handle — and the same rule: picking somebody writes an invitation, not a
 * membership. Nothing here puts a person into an event; they are asked, and
 * they answer in Activity. A host who could add people outright would be
 * writing their guest list into somebody else's account.
 *
 * It holds the choice rather than sending it. There is no event yet while this
 * is on screen, so the invitations go out in one call the moment there is one
 * — which also means backing out of the form invites nobody, where a picker
 * that sent as it went would leave a trail of asks for an event that was never
 * made.
 *
 * ## Two questions, one picker
 *
 * "Who is in it" and "who holds the camera" are asked on the same screen when
 * an album is set to `host`, and they are the same act of finding a person: the
 * same two lists, the same debounce, the same rule that picking somebody asks
 * them rather than adds them. So the words are arguments — `placeholder`,
 * `hint` — and the lists are not.
 *
 * `exclude` is what keeps the two from disagreeing. Somebody already named a
 * co-host must not also be offered under "add members": they are being asked
 * into the album either way, and a name in both places is one invitation that
 * looks like two decisions.
 */

import { useEffect, useState } from 'react';

import { Face } from './Faces';

export type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  /**
   * Presigned on the server for an hour, or null. Both endpoints behind this
   * picker send it; the storage key never crosses that boundary. Drawn through
   * `Face`, because a form left open outlives the signature.
   */
  avatar: string | null;
};

export function nameOf(person: Person): string {
  return person.displayName?.trim() || (person.handle ? `@${person.handle}` : 'Someone');
}

export function MemberPicker({
  picked,
  onChange,
  /** What the search box says it is for. */
  placeholder = 'Search friends, or anyone by handle',
  label = 'Search for people to add',
  /**
   * The line under an empty list, which is where this picker says what picking
   * somebody actually does. Two callers, two different promises.
   */
  hint = 'Your friends show up here. Search a handle to find anyone else — they get an invitation to accept, and the link works whether or not they do.',
  /** Actors this picker must not offer — see `exclude` in the header. */
  exclude,
}: {
  picked: Person[];
  onChange: (next: Person[]) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  exclude?: Set<string>;
}) {
  const [friends, setFriends] = useState<Person[]>([]);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void fetch('/api/friends')
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((body) => setFriends(body.friends ?? []))
      .catch(() => {});
  }, []);

  /*
   * Anybody, by handle. Debounced, because this fires per keystroke and what
   * is behind it walks the account table — the same endpoint and the same
   * delay as the Members tab, which is the other place this question is asked.
   */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
        setFound(res.ok ? ((await res.json()).people ?? []) : []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const chosen = new Set(picked.map((p) => p.actorId));
  // Friends until there is a query. One list rather than two stacked, because
  // two make "not found" ambiguous — nobody can tell which list was searched.
  //
  // Filtered after that choice rather than before it, so the empty state below
  // still reads off the same variable: a search that found one person who is
  // already a co-host says "nobody by that handle", which is the honest answer
  // to "can I add them" even though the reason is the other picker.
  const offered = (term.trim().length >= 2 ? found : friends).filter(
    (person) => !exclude?.has(person.actorId),
  );

  const toggle = (person: Person) =>
    onChange(
      chosen.has(person.actorId)
        ? picked.filter((p) => p.actorId !== person.actorId)
        : [...picked, person],
    );

  return (
    <div className="members">
      {/* A plain input, deliberately. `.search-field` is the home screen's
          collapsing search — it is 0px wide until a wrapper says otherwise,
          which is exactly what it did here. */}
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />

      {picked.length > 0 && (
        <ul className="member-chips">
          {picked.map((person) => (
            <li key={person.actorId}>
              <button type="button" onClick={() => toggle(person)}>
                {nameOf(person)}
                <span aria-hidden="true"> ×</span>
                <span className="visually-hidden">, remove</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {offered.length > 0 ? (
        <ul className="people">
          {offered.map((person) => (
            <li key={person.actorId}>
              {/*
                A face, and the letter only when there is none. This list is
                the answer to "who is this album for", and a column of
                identical letter-tiles is one that has to be read rather than
                recognised — which is the whole reason the endpoints send a
                picture now.
              */}
              <Face
                src={person.avatar}
                size={34}
                className="member-face"
                fallback={
                  <span aria-hidden="true">
                    {nameOf(person).replace(/^@/, '').slice(0, 1).toUpperCase()}
                  </span>
                }
              />
              <div>
                <strong>{nameOf(person)}</strong>
                {person.handle && <p className="muted">@{person.handle}</p>}
              </div>
              <button
                type="button"
                className={chosen.has(person.actorId) ? 'secondary small' : 'small'}
                onClick={() => toggle(person)}
              >
                {chosen.has(person.actorId) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-help">
          {searching
            ? 'Looking…'
            : term.trim().length >= 2
              ? 'Nobody by that handle.'
              : hint}
        </p>
      )}
    </div>
  );
}
