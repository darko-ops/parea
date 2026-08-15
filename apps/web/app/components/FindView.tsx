'use client';

/**
 * One box, and three kinds of thing to point it at.
 *
 * Search used to be a group-name box with a by-place list under it, and
 * everything else you might want to find had its own screen or none at all.
 * This is the same page asked as one question — "type what you remember" —
 * with the results grouped by what they are.
 *
 * ## What the page says before you type
 *
 * People, Albums, Groups: the three namespaces, named on the page rather than
 * described in a paragraph. Each one is a scope you can press, and each one
 * shows something with nothing typed — people you may know, your albums, your
 * groups — so the page answers "what can I find here" by holding examples of
 * it instead of by explaining.
 *
 * The rules used to be the first thing on the screen, four lines of prose
 * about what is and is not looked up. They are true and worth having, and they
 * are not what somebody arriving here is trying to do; they now sit behind
 * "How search works", which is where a rule belongs once the page itself
 * demonstrates it.
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
type Suggestion = Person & { mutuals: number };
type Membership = { id: string; name: string; role: string };

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
/**
 * How many of your own albums to show before you have typed anything.
 *
 * Enough to demonstrate that albums are searchable here, few enough that the
 * page is not a second copy of the home screen — which is one tap away and is
 * where somebody browsing rather than looking should be.
 */
const IDLE_ALBUMS = 6;

/**
 * Which of the three the box is pointed at.
 *
 * A scope rather than a filter over one result set: pressing Albums means the
 * two lookups are not made at all, so narrowing the search also narrows what
 * the page asks the server about you.
 */
type Scope = 'all' | 'people' | 'albums' | 'groups';

const SCOPES = [
  ['all', 'All'],
  ['people', 'People'],
  ['albums', 'Albums'],
  ['groups', 'Groups'],
] as const;

export function FindView({
  albums,
  friends,
  suggested,
  groups: mine,
}: {
  albums: AlbumHit[];
  friends: Person[];
  /** Friends of your friends. Shown when nothing is typed. */
  suggested: Suggestion[];
  /** The groups this person is in, for the same reason. */
  groups: Membership[];
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [doors, setDoors] = useState<Door[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against an early request landing after a later one and overwriting
  // newer results with staler ones.
  const latest = useRef(0);

  const term = query.trim().toLowerCase();
  const asking = term.length >= MIN;

  const wantsPeople = scope === 'all' || scope === 'people';
  const wantsAlbums = scope === 'all' || scope === 'albums';
  const wantsGroups = scope === 'all' || scope === 'groups';

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

  const search = useCallback(
    async (q: string, within: Scope) => {
      const mineNow = ++latest.current;
      if (q.trim().length < MIN) {
        setDoors([]);
        setPeople([]);
        setSearching(false);
        return;
      }
      const askPeople = within === 'all' || within === 'people';
      const askGroups = within === 'all' || within === 'groups';
      if (!askPeople && !askGroups) {
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
          askGroups
            ? fetch(`/api/groups/search?q=${encodeURIComponent(q)}`)
                .then((r) => (r.ok ? r.json() : { groups: [] }))
                .catch(() => ({ groups: [] }))
            : Promise.resolve({ groups: [] }),
          askPeople
            ? fetch(`/api/people?q=${encodeURIComponent(q)}`)
                .then((r) => (r.ok ? r.json() : { people: [] }))
                .catch(() => ({ people: [] }))
            : Promise.resolve({ people: [] }),
        ]);
        if (mineNow !== latest.current) return;
        setDoors(groups.groups ?? []);
        setPeople(accounts.people ?? []);
      } finally {
        if (mineNow === latest.current) setSearching(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => void search(query, scope), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, scope, search]);

  // Somebody already on the friends list is not a stranger to be asked about.
  const friendIds = new Set(friends.map((f) => f.actorId));
  const strangers = people.filter((person) => !friendIds.has(person.actorId));
  const nothing =
    asking &&
    !searching &&
    (!wantsPeople || (foundFriends.length === 0 && strangers.length === 0)) &&
    (!wantsAlbums || foundAlbums.length === 0) &&
    (!wantsGroups || doors.length === 0);

  return (
    <>
      <section className="panel find-box">
        <label htmlFor="q" className="visually-hidden">
          Search people, albums and groups
        </label>
        <input
          id="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A person, an album, a group"
          autoComplete="off"
          autoFocus
        />

        {/*
          The three namespaces, said on the page rather than in a paragraph.
          "All" first because it is the state somebody arrives in, and pressing
          one of the others is narrowing rather than choosing.
        */}
        <div className="pills find-scopes">
          {SCOPES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="pill small"
              aria-pressed={scope === id}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/*
          The rules, one click away. They are true and somebody will want them
          — after they have typed something and wondered why an album they
          were told about is not here — which is a different moment from
          arriving.
        */}
        <details className="how">
          <summary>How search works</summary>
          <p className="field-help">
            Your albums and your friends are matched here on this page, over
            what you can already see — nothing is looked up. Handles are
            searched by prefix, so somebody is findable enough to be asked and
            no further, and groups return a name and a member count and never
            what is inside. Photos are never searched, and the only way into
            somebody else’s album is a link they sent you.
          </p>
        </details>
      </section>

      {wantsPeople && foundFriends.length > 0 && (
        <Group title="Friends">
          {foundFriends.map((person) => (
            <PersonRow key={person.actorId} person={person} />
          ))}
        </Group>
      )}

      {wantsPeople && strangers.length > 0 && (
        <Group title="People">
          {strangers.map((person) => (
            <PersonRow key={person.actorId} person={person} />
          ))}
        </Group>
      )}

      {wantsAlbums && foundAlbums.length > 0 && (
        <Group title="Albums">
          {foundAlbums.map((album) => (
            <AlbumRow key={album.id} album={album} />
          ))}
        </Group>
      )}

      {wantsGroups && doors.length > 0 && (
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
        With nothing typed, the three headings hold something rather than
        sitting empty: this is the page saying what it can find by finding it.
      */}
      {!asking && wantsPeople && suggested.length > 0 && (
        <Group title="People you may know">
          {/*
            Friends of your friends, and only them: somebody you could already
            reach by asking the friend you have in common, so the suggestion
            saves a message rather than disclosing a relationship you had no
            route to. The count of mutuals, never their names — see
            `suggestionsFor`.
          */}
          {suggested.map((person) => (
            <PersonRow
              key={person.actorId}
              person={person}
              note={`${person.mutuals} ${person.mutuals === 1 ? 'mutual friend' : 'mutual friends'}`}
            />
          ))}
        </Group>
      )}

      {!asking && wantsAlbums && albums.length > 0 && (
        <Group
          title="Your albums"
          // Not all of them. The home screen is the list; this is a reminder
          // that the box above will find one by name.
          note={albums.length > IDLE_ALBUMS ? `${albums.length} in all` : undefined}
        >
          {albums.slice(0, IDLE_ALBUMS).map((album) => (
            <AlbumRow key={album.id} album={album} />
          ))}
        </Group>
      )}

      {!asking && wantsGroups && mine.length > 0 && (
        <Group title="Your groups">
          {mine.map((group) => (
            <li key={group.id}>
              <a href={`/group/${group.id}`} className="hit">
                <span className="hit-thumb" aria-hidden="true">
                  {group.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hit-text">
                  <strong>{group.name}</strong>
                  <span className="muted">{group.role === 'admin' ? 'Admin' : 'Member'}</span>
                </span>
              </a>
            </li>
          ))}
        </Group>
      )}

      {/*
        A scope with nothing behind it yet says so, rather than showing the
        heading and no rows — which reads as something that failed to load.
      */}
      {!asking && scope === 'groups' && mine.length === 0 && (
        <section className="panel">
          <p className="muted">
            You are not in any groups yet. Type a name to look one up — a group
            can be findable, and what you get back is a door rather than what
            is behind it.
          </p>
        </section>
      )}

      {!asking && scope === 'albums' && albums.length === 0 && (
        <section className="panel">
          <p className="muted">
            No albums yet. Make one, or open a link somebody sent you, and it
            will be findable here by name or by place.
          </p>
        </section>
      )}

      {!asking && scope === 'people' && suggested.length === 0 && (
        <section className="panel">
          <p className="muted">
            Nobody to suggest yet — suggestions are friends of your friends.
            Type a handle to find somebody directly.
          </p>
        </section>
      )}
    </>
  );
}

/** One kind of answer, under its own heading. */
function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <h2 className="hit-head">
        {title}
        {note && <span className="hit-head-note">{note}</span>}
      </h2>
      <ul className="hits">{children}</ul>
    </section>
  );
}

/** An album, whether it was typed for or is just one of yours. */
function AlbumRow({ album }: { album: AlbumHit }) {
  return (
    <li>
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
function PersonRow({ person, note }: { person: Person; note?: string }) {
  const name = person.displayName?.trim() || (person.handle ? `@${person.handle}` : 'Someone');
  return (
    <li>
      <a href="/friends" className="hit">
        <span className="hit-thumb" aria-hidden="true">
          {name.replace('@', '').slice(0, 1).toUpperCase()}
        </span>
        <span className="hit-text">
          <strong>{name}</strong>
          {/* The handle, unless there is something more useful to say — two
              grey lines under one name is a row that has stopped being read. */}
          <span className="muted">{note ?? (person.handle ? `@${person.handle}` : '')}</span>
        </span>
      </a>
    </li>
  );
}
