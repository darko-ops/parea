'use client';

/**
 * One box, four kinds of answer.
 *
 * Search used to be a group-name box with a by-place list under it, and
 * everything else you might want to find had its own screen or none at all.
 * This is the same page asked as one question — "type what you remember" —
 * with the results grouped by what they are.
 *
 * ## The three of them are not the same search, and must not be
 *
 * **Your albums** are matched here, in the browser, over a list the server
 * already decided this person may see. Nothing is discovered: every row was
 * on the home screen a second ago. That is why matching anywhere inside the
 * string is safe here and is not safe below.
 *
 * **Your friends** are the same shape — a list this person already has.
 *
 * **Anybody, by handle** goes to `/api/people`, which is prefix-only, accounts
 * only, ten results, and returns a handle and a name and nothing else. A
 * substring match there would be enumeration wearing a search box; §3's rule
 * is that a person is findable enough to be *asked*, and no further.
 *
 * **Groups** go to `/api/groups/search`, which returns a door: a name and a
 * member count, never what is inside. Kept because this is the only surface in
 * the product where a findable group can be found at all.
 *
 * Albums and photos are never searched beyond the viewer's own. That is the
 * line the whole product is built on: possession of the link is the access
 * model, and a global album search would turn it into "type a word and see
 * whose wedding comes up".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { matches } from '@/search';

import { Face } from './Faces';

type Door = { id: string; name: string; memberCount: number };
type Person = { actorId: string; handle: string | null; displayName: string | null };
type Place = { place: string; events: { id: string; name: string }[] };

export type AlbumHit = {
  id: string;
  name: string;
  place: string | null;
  caption: string | null;
  /** Signed thumbnail, or null for an album with nothing in it yet. */
  thumb: string | null;
  /** Name and place, lowercased on the server. See `search.ts`. */
  haystack: string;
};

/** Long enough that typing a word is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;
/** Below this a query is a prefix of everything. Matches the people search. */
const MIN = 2;

export function FindView({
  albums,
  friends,
  places,
  unplaced,
}: {
  albums: AlbumHit[];
  friends: Person[];
  places: Place[];
  unplaced: number;
}) {
  const [query, setQuery] = useState('');
  const [doors, setDoors] = useState<Door[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against an early request landing after a later one and overwriting
  // newer results with staler ones.
  const latest = useRef(0);

  const term = query.trim().toLowerCase();
  const asking = term.length >= MIN;

  /*
   * The two local lists, matched without asking anybody.
   *
   * `matches` is the home screen's, not a second copy: every term has to
   * appear somewhere in any order, so "roast anchor" finds the Sunday roast at
   * The Anchor. Two implementations of that would drift on the first bug, and
   * the drift would be one screen finding an album the other could not.
   */
  const foundAlbums = asking ? albums.filter((a) => matches(a.haystack, term)) : [];
  const foundFriends = asking
    ? friends.filter((f) =>
        matches(`${f.displayName ?? ''} ${f.handle ?? ''}`.toLowerCase(), term),
      )
    : [];

  const search = useCallback(async (q: string) => {
    const mine = ++latest.current;
    if (q.trim().length < MIN) {
      setDoors([]);
      setPeople([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      // Both at once. They are different endpoints with different rules, and
      // waiting for one to answer before asking the other would make the
      // slower of them the speed of the page.
      const [groups, accounts] = await Promise.all([
        fetch(`/api/groups/search?q=${encodeURIComponent(q)}`)
          .then((r) => (r.ok ? r.json() : { groups: [] }))
          .catch(() => ({ groups: [] })),
        fetch(`/api/people?q=${encodeURIComponent(q)}`)
          .then((r) => (r.ok ? r.json() : { people: [] }))
          .catch(() => ({ people: [] })),
      ]);
      if (mine !== latest.current) return;
      setDoors(groups.groups ?? []);
      setPeople(accounts.people ?? []);
    } finally {
      if (mine === latest.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void search(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  // Somebody already on the friends list is not a stranger to be asked about.
  const friendIds = new Set(friends.map((f) => f.actorId));
  const strangers = people.filter((person) => !friendIds.has(person.actorId));
  const nothing =
    asking &&
    !searching &&
    foundAlbums.length === 0 &&
    foundFriends.length === 0 &&
    strangers.length === 0 &&
    doors.length === 0;

  return (
    <>
      <section className="panel">
        <label htmlFor="q" className="visually-hidden">
          Search albums, friends and handles
        </label>
        <input
          id="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="An album, a friend, a handle"
          autoComplete="off"
          autoFocus
        />
        <p className="field-help" style={{ marginTop: 8 }}>
          Your albums and your friends are matched here on this page. Handles
          and findable groups are looked up — photos never are, and the only way
          into an album is a link somebody sent you.
        </p>
      </section>

      {foundAlbums.length > 0 && (
        <Group title="Albums">
          {foundAlbums.map((album) => (
            <li key={album.id}>
              <a href={`/event/${album.id}`} className="hit">
                <Face
                  src={album.thumb}
                  size={38}
                  className="hit-thumb"
                  fallback={<span aria-hidden="true">{album.name.slice(0, 1).toUpperCase()}</span>}
                />
                <span className="hit-text">
                  <strong>{album.name}</strong>
                  {(album.place || album.caption) && (
                    <span className="muted">{album.place ?? album.caption}</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </Group>
      )}

      {foundFriends.length > 0 && (
        <Group title="Friends">
          {foundFriends.map((person) => (
            <PersonRow key={person.actorId} person={person} />
          ))}
        </Group>
      )}

      {strangers.length > 0 && (
        <Group title="People">
          {strangers.map((person) => (
            <PersonRow key={person.actorId} person={person} />
          ))}
        </Group>
      )}

      {doors.length > 0 && (
        <Group title="Groups">
          {doors.map((door) => (
            <li key={door.id}>
              <a href={`/group/${door.id}`} className="hit">
                <span className="hit-thumb" aria-hidden="true">
                  {door.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hit-text">
                  <strong>{door.name}</strong>
                  <span className="muted">
                    {door.memberCount} {door.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </Group>
      )}

      {nothing && (
        <section className="panel">
          <p className="muted">
            Nothing by that name. Albums are only yours to find — if somebody
            has not sent you the link, there is nothing here to type at.
          </p>
        </section>
      )}

      {/*
        Browsing, for when there is nothing typed. It answers "the Greece one"
        for somebody who remembers where before they remember what — and it
        only ever arranges albums they are already in, so nothing is discovered
        by it either.
      */}
      {!asking && (
        <section className="panel">
          <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Your albums by place</h2>
          {places.length === 0 ? (
            <p className="muted">
              None of your albums has a place yet. Add one when you start the
              next — it is typed by whoever creates it, never taken from a photo.
            </p>
          ) : (
            <ul className="plain">
              {places.map(({ place, events }) => (
                <li key={place}>
                  <strong>{place}</strong>{' '}
                  <span className="muted">
                    ·{' '}
                    {events.map((event, i) => (
                      <span key={event.id}>
                        {i > 0 && ', '}
                        <a href={`/event/${event.id}`}>{event.name}</a>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unplaced > 0 && (
            <p className="muted" style={{ marginTop: 10 }}>
              {unplaced} {unplaced === 1 ? 'album has' : 'albums have'} no place set.
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** One kind of answer, under its own heading. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="hit-head">{title}</h2>
      <ul className="hits">{children}</ul>
    </section>
  );
}

/**
 * A person, whether they are a friend or a stranger.
 *
 * The same row for both on purpose: what is known about somebody found by
 * handle is a handle and a name, and that is all a friend's row shows either.
 * A friend's row with more on it would be a reason to go looking for people
 * whose rows are fuller.
 */
function PersonRow({ person }: { person: Person }) {
  const name = person.displayName?.trim() || (person.handle ? `@${person.handle}` : 'Someone');
  return (
    <li>
      <a href="/friends" className="hit">
        <span className="hit-thumb" aria-hidden="true">
          {name.replace('@', '').slice(0, 1).toUpperCase()}
        </span>
        <span className="hit-text">
          <strong>{name}</strong>
          {person.handle && <span className="muted">@{person.handle}</span>}
        </span>
      </a>
    </li>
  );
}
