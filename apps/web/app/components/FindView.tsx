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
 * The state this page is in nearly all of the time is the one before anybody
 * has typed, and it used to be four stacked bordered panels: the box, then
 * three lists of identical 38px rows. Three things were wrong with that. The
 * box you type in had the same visual weight as the rules link under it; an
 * event, a person and a group were indistinguishable at a glance; and "Your
 * events" was a worse copy of the home screen, one tap away.
 *
 * The argument survives — *each heading holds an example of what the page
 * finds, rather than a paragraph explaining it* — and what is held has
 * changed. "Your events" is gone, and in its place is **Groups you could
 * join**: findable groups a friend of yours is already in.
 *
 * ## Why a group may be offered and an event may never be
 *
 * There is exactly one thing in this product that may be recommended, and it
 * is a findable group. An event must never be suggested, ranked or surfaced to
 * somebody who does not already have it — possession of the link *is* the
 * access model, and a recommended event is a door nobody sent you. That is why
 * the foot of this page says so out loud: without that sentence the missing
 * event list reads as a gap rather than as a policy.
 *
 * A group is only barely an exception, and the sub-line is what keeps it
 * honest: what comes back is a name and a member count and nothing from
 * inside, and you would still be asking to be let in. The mutual friends named
 * on each card are the rest of the honesty — the group was reachable by asking
 * one of them anyway, so naming them says where the suggestion came from
 * instead of presenting it as something the product knows about you.
 *
 * ## The three of them are not the same search, and must not be
 *
 * **Your events** are matched here, in the browser, over a list the server
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
 * Events and photos are never searched beyond the viewer's own. That is the
 * line the whole product is built on: possession of the link is the access
 * model, and a global event search would turn it into "type a word and see
 * whose wedding comes up".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Cluster } from '@/groups';
import { matches } from '@/search';

import { CreateGroupCard, type ClusterPerson } from './CreateGroupCard';
import { Face } from './Faces';
import { SearchIcon } from './SearchIcon';

type Door = { id: string; name: string; memberCount: number };
type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  /**
   * Presigned on the server and short-lived — see `Face`, which is why this is
   * never a bare `<img>`. Null for somebody who has not added one, and for
   * anybody whose row predates `/api/people` sending it.
   */
  avatar: string | null;
  /**
   * Where you and they stand, so a row can offer the right thing.
   *
   * Sent by `/api/people` and absent from the two local lists this page also
   * draws — your own friends are friends by definition, which is what the
   * default below says. It is a fact about the reader rather than about the
   * person found: whether *they* asked, were asked, or are already friends.
   */
  standing?: Standing;
};
type Standing = 'friends' | 'asked' | 'asking' | 'none';
type Suggestion = Person & { mutuals: number };
type Membership = { id: string; name: string; role: string };

/** A friend of yours who is in a group you are not in. */
type Mutual = {
  id: string;
  name: string | null;
  handle: string | null;
  /** Presigned on the server, and short-lived — see `Face`. */
  avatar: string | null;
};

export type SuggestedGroup = {
  id: string;
  name: string;
  memberCount: number;
  /** At most two of them; `mutualCount` is how many there really are. */
  mutuals: Mutual[];
  mutualCount: number;
  /** Already asked, and waiting on an admin. */
  asked: boolean;
};

export type EventHit = {
  id: string;
  name: string;
  place: string | null;
  caption: string | null;
  /** Signed thumbnail, or null for an event with nothing in it yet. */
  thumb: string | null;
  /** Name and place, lowercased on the server. See `search.ts`. */
  haystack: string;
};

/**
 * The last few searches, kept on their own machine.
 *
 * Ten, and never anywhere else. A search term is a sentence about who somebody
 * was looking for, and this product does not keep one: there is no table, no
 * request, and nothing about it reaches the server — the box is the same box
 * it was, and this is a list of what was done with it, held by the browser
 * that did it.
 *
 * Which is also why "Clear" is beside the heading rather than in a settings
 * page. A shared laptop is the ordinary case for wanting it gone, and the
 * place somebody looks for that is the list itself.
 *
 * ## Two kinds of entry, because there were two kinds of search
 *
 * A search that ended on a person is remembered as **that person**, not as
 * what was typed to reach them. The two are not the same thing to the reader:
 * "wr" is what they had got as far as typing, and Wren Halliday is who they
 * were looking for. Pressing it goes straight to the profile rather than
 * refilling the box with a prefix and making them find the row again.
 *
 * A search that ended anywhere else — Enter pressed, a group opened, an album
 * opened — is remembered as **the term**, because that is all it was. Pressing
 * one of those puts it back in the box and runs it again.
 *
 * A person is stored as a handle and a name and nothing else. Not the picture:
 * every avatar in this product is presigned for an hour, so a URL kept here is
 * a broken image by tomorrow — the letter on their lens is the same fallback
 * every other face in the product falls back to, and it never expires.
 */
const RECENT_KEY = 'parea.find.recent';
const RECENT_MAX = 10;

type Recent =
  | { kind: 'person'; handle: string; name: string }
  | { kind: 'term'; term: string };

/** What two entries have to differ in to both be kept. */
const idOf = (entry: Recent) =>
  entry.kind === 'person' ? `p:${entry.handle.toLowerCase()}` : `t:${entry.term.toLowerCase()}`;

/**
 * Read, tolerating every shape the key could be in.
 *
 * `localStorage` throws in a Safari private window rather than returning
 * null, and the value could be anything a previous version or another tab
 * wrote. A search page that fails to render because of its own convenience
 * list is worse than one with no list, so every failure is an empty one.
 *
 * A bare string is what the first version of this wrote, and it is read as the
 * term it was rather than dropped: somebody's list should not empty itself
 * because the page learned to remember people.
 */
function readRecent(): Recent[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept: Recent[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        kept.push({ kind: 'term', term: item });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.kind === 'person' && typeof row.handle === 'string' && row.handle) {
        kept.push({
          kind: 'person',
          handle: row.handle,
          name: typeof row.name === 'string' && row.name ? row.name : row.handle,
        });
      } else if (row.kind === 'term' && typeof row.term === 'string' && row.term.trim()) {
        kept.push({ kind: 'term', term: row.term });
      }
    }
    return kept.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(entries: Recent[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
  } catch {
    // Out of quota, or a browser that refuses storage. The list is a
    // convenience and its failure is not the page's problem to report.
  }
}

/** Long enough that typing a word is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;
/** Below this a query is a prefix of everything. Matches the people search. */
const MIN = 2;

/**
 * The mark's colours, each with a darker relative of itself to write on.
 *
 * A group has no cover and never borrows one from inside it — that would leak
 * a photograph out of a room nobody has been let into — so a tile is a letter
 * on a colour. Assigned by a hash of the id rather than by position, so a
 * group keeps its colour as the list around it changes.
 */
const TINTS = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

function tintFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

/** The first letter of a name, for a tile with no picture in it. */
function initial(name: string): string {
  return name.trim().replace('@', '').slice(0, 1).toUpperCase() || '?';
}

/**
 * Which of the three the box is pointed at.
 *
 * A scope rather than a filter over one result set: pressing Events means the
 * two lookups are not made at all, so narrowing the search also narrows what
 * the page asks the server about you.
 */
type Scope = 'all' | 'people' | 'events' | 'groups';

const SCOPES = [
  ['all', 'All'],
  ['people', 'People'],
  ['events', 'Albums'],
  ['groups', 'Groups'],
] as const;

export function FindView({
  greeting,
  events,
  friends,
  suggested,
  suggestedGroups,
  groups: mine,
  clusters,
  also,
}: {
  /** "Evening, Nadia", or nothing for a browser that has not signed in. */
  greeting: string | null;
  /**
   * Still a prop, and no longer a list.
   *
   * These are matched when somebody types, which is the only thing they were
   * ever safe to be used for on this page. What went is the idle "Your events"
   * heading — a second copy of the home screen, and a shape the next ticket
   * would have been tempted to fill with somebody else's.
   */
  events: EventHit[];
  friends: Person[];
  /** Friends of your friends. Shown when nothing is typed. */
  suggested: Suggestion[];
  /** Findable groups those friends are in. Shown for the same reason. */
  suggestedGroups: SuggestedGroup[];
  /** The groups this person is in. */
  groups: Membership[];
  /**
   * Sets of people this person keeps ending up in the same albums as, offered
   * as groups they could make.
   *
   * These were on Chat, above the list when it was empty and demoted below it
   * when it was not — so the page whose whole subject is conversations was two
   * thirds a groups directory and the conversations were the part you scrolled
   * past. Making a group belongs where groups are found, which is here and is
   * where the app puts it.
   */
  clusters: Cluster[];
  /** Who else could be added: people shared with once, not in any cluster. */
  also: ClusterPerson[];
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [doors, setDoors] = useState<Door[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  /*
   * Empty on the first render, filled after mount.
   *
   * `localStorage` does not exist while this is being rendered on the server,
   * and a list that differs between the server's HTML and the browser's first
   * pass is a hydration mismatch. So the first frame is the page without it
   * and the second is the page with it — which is what it looked like a
   * moment ago anyway.
   */
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => setRecent(readRecent()), []);

  /**
   * Put an entry at the front, most recent first, without repeating it.
   *
   * Case-folded for the comparison and kept as it was written: "Wren" and
   * "wren" are the same search and the list should hold one of them, and the
   * one to hold is the one somebody last wrote. The same holds for a person —
   * a handle is unique by case-insensitive index, so one row per person.
   */
  const keep = useCallback((entry: Recent) => {
    const id = idOf(entry);
    setRecent((was) => {
      const next = [entry, ...was.filter((e) => idOf(e) !== id)].slice(0, RECENT_MAX);
      writeRecent(next);
      return next;
    });
  }, []);

  /** A search that ended on nobody in particular: what was typed. */
  const rememberTerm = useCallback(
    (raw: string) => {
      const term = raw.trim();
      if (term.length < MIN) return;
      keep({ kind: 'term', term });
    },
    [keep],
  );

  /**
   * A search that ended on a person: the person.
   *
   * Not the term as well. Two rows for one search — "wr" beside Wren — is the
   * list reporting the reader's typing back to them alongside the answer they
   * already found.
   */
  const rememberPerson = useCallback(
    (person: Person) => {
      if (!person.handle) return;
      keep({
        kind: 'person',
        handle: person.handle,
        name: person.displayName?.trim() || person.handle,
      });
    },
    [keep],
  );

  const forgetAll = useCallback(() => {
    setRecent([]);
    writeRecent([]);
  }, []);
  // Guards against an early request landing after a later one and overwriting
  // newer results with staler ones.
  const latest = useRef(0);

  const term = query.trim().toLowerCase();
  const asking = term.length >= MIN;

  const wantsPeople = scope === 'all' || scope === 'people';
  const wantsEvents = scope === 'all' || scope === 'events';
  const wantsGroups = scope === 'all' || scope === 'groups';

  /*
   * The two local lists, matched without asking anybody.
   *
   * `matches` is the home screen's, not a second copy: every term has to
   * appear somewhere in any order, so "roast anchor" finds the Sunday roast at
   * The Anchor. Two implementations of that would drift on the first bug, and
   * the drift would be one screen finding an event the other could not.
   */
  const foundEvents = asking ? events.filter((a) => matches(a.haystack, term)) : [];
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
    (!wantsEvents || foundEvents.length === 0) &&
    (!wantsGroups || doors.length === 0);

  /*
   * Which of the idle sections have anything in them.
   *
   * Named rather than repeated inline because the empty sentences are decided
   * by them: a heading with nothing under it reads as something that failed to
   * load, and a page with neither a heading nor a sentence reads the same way.
   */
  const showsDoors = !asking && wantsGroups && suggestedGroups.length > 0;
  const showsPeople = !asking && wantsPeople && suggested.length > 0;
  const showsMine = !asking && wantsGroups && mine.length > 0;
  const bare = !asking && !showsDoors && !showsPeople && !showsMine;

  return (
    <>
      {/*
        The greeting is the heading, and the page's name is the fallback for a
        reader it cannot name — see `HomeView`.

        "Find" rather than "Search", which is what the rail still calls it: the
        rail is naming a place to go and this is naming what you get. It also
        matches the route.
      */}
      <h1 className="find-title">{greeting ?? 'Find'}</h1>

      {/*
        The box, given the weight of the thing the page is for. It used to be
        an input inside a panel alongside the scopes and the rules link, all
        three drawn the same — so the field somebody came here to type in
        looked like one of three controls rather than like the page.
      */}
      <div className="find-box">
        <SearchIcon size={20} />
        <label htmlFor="q" className="visually-hidden">
          Search people, albums and groups
        </label>
        {/*
          Two moments are worth remembering and neither of them is a keystroke.

          Typing is not searching here — the box asks on a 250ms debounce, so
          every prefix of a name would go in the list and "w", "wr", "wre" is
          not a history of anything. What means "this was the search" is
          pressing Enter, or opening one of the answers; both are below.
        */}
        <input
          id="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rememberTerm(query);
          }}
          placeholder="A person, an album, a group"
          autoComplete="off"
          autoFocus
        />
      </div>

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
        What was typed here before, when nothing is typed now.

        Above the suggestions rather than below them: this is the only thing on
        the idle page that came from the reader, and a list of their own
        searches under two lists of the product's guesses reads as another
        guess. It is gone the moment somebody types, because then the page is
        answering rather than offering.

        Held in this browser and nowhere else — see `RECENT_KEY`. "Clear" is
        beside the heading because a shared laptop is the ordinary reason to
        want it gone, and the place people look for that is the list.
      */}
      {!asking && recent.length > 0 && (
        <section className="find-section">
          <h2 className="hit-head">
            Recent
            <button type="button" className="link hit-head-note" onClick={forgetAll}>
              Clear
            </button>
          </h2>
          <div className="pills find-recent">
            {recent.map((entry) =>
              entry.kind === 'person' ? (
                /*
                  A person goes to the person.

                  This row was the end of a search, so pressing it should end
                  the same way rather than putting the two letters that reached
                  them back in the box. A letter on their own lens rather than
                  their picture: an avatar URL is presigned for an hour, so one
                  kept here would be a broken image by tomorrow — and the lens
                  is keyed on the handle, so it is the colour they have
                  everywhere else in the product.
                */
                <a
                  key={idOf(entry)}
                  href={`/u/${encodeURIComponent(entry.handle)}`}
                  className="pill small recent-person"
                >
                  <span
                    className="recent-face"
                    style={{
                      background: tintFor(entry.handle).fill,
                      color: tintFor(entry.handle).ink,
                    }}
                    aria-hidden="true"
                  >
                    {initial(entry.name)}
                  </span>
                  {entry.name}
                </a>
              ) : (
                <button
                  key={idOf(entry)}
                  type="button"
                  className="pill small"
                  onClick={() => {
                    setQuery(entry.term);
                    rememberTerm(entry.term);
                  }}
                >
                  {entry.term}
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {wantsPeople && foundFriends.length > 0 && (
        <Answers title="Friends">
          {foundFriends.map((person) => (
            <PersonRow
              key={person.actorId}
              person={person}
              onOpen={() => rememberPerson(person)}
            />
          ))}
        </Answers>
      )}

      {wantsPeople && strangers.length > 0 && (
        <Answers title="People">
          {strangers.map((person) => (
            <PersonRow
              key={person.actorId}
              person={person}
              onOpen={() => rememberPerson(person)}
            />
          ))}
        </Answers>
      )}

      {wantsEvents && foundEvents.length > 0 && (
        <Answers title="Albums">
          {foundEvents.map((event) => (
            <EventRow key={event.id} event={event} onOpen={() => rememberTerm(query)} />
          ))}
        </Answers>
      )}

      {wantsGroups && doors.length > 0 && (
        <Answers title="Groups">
          {doors.map((door) => (
            <li key={door.id}>
              <a
                href={`/group/${door.id}`}
                className="hit"
                onClick={() => rememberTerm(query)}
              >
                <span className="hit-thumb" aria-hidden="true">
                  {initial(door.name)}
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
        </Answers>
      )}

      {nothing && (
        <p className="find-empty">
          Nothing by that name. Albums are only yours to find — if somebody
          has not sent you the link, there is nothing here to type at.
        </p>
      )}

      {/*
        With nothing typed the headings hold something rather than sitting
        empty: this is the page saying what it can find by finding it.
      */}
      {/*
        Groups this person could make, above the ones they could ask into.

        Above, because a cluster is people the product has already watched turn
        up together and a door is a room full of strangers: one is a thing to
        confirm and the other a thing to request. It is also the only section
        here that *makes* something, and the app puts making a group on this
        screen for the same reason — this is where the groups are.

        An observation and never a claim: `recurringClusters` answers sets of
        people who have shared several albums, and pressing the button still
        writes nothing until the form is submitted. A cluster whose people are
        already gathered in a group is dropped upstream, which is what lets
        this sit here without needing a way to dismiss it.
      */}
      {!asking && wantsGroups && clusters.length > 0 && (
        <section className="find-section">
          <h2 className="find-head">The same people keep turning up</h2>
          <p className="find-sub">
            You have shared several albums with these people. Keep everyone
            together for next time — the next album includes all of them
            without a single invite.
          </p>
          <div className="cluster-list">
            {clusters.map((cluster, i) => (
              <CreateGroupCard
                key={cluster.key}
                cluster={cluster}
                people={cluster.people}
                also={also}
                primary={i === 0}
              />
            ))}
          </div>
        </section>
      )}

      {!asking && wantsGroups && suggestedGroups.length > 0 && (
        <section className="find-section">
          <h2 className="find-head">Groups you could join</h2>
          {/*
            Load-bearing, and not a caption. A group in this list is a door,
            and the second sentence is what stops the first from reading as
            "here is somewhere you are in".
          */}
          <p className="find-sub">
            Findable groups your friends are in. You would still be asking to be
            let in.
          </p>
          <div className="doors">
            {suggestedGroups.map((group) => (
              <DoorCard key={group.id} group={group} />
            ))}
          </div>
        </section>
      )}

      {!asking && wantsPeople && suggested.length > 0 && (
        <section className="find-section">
          <h2 className="find-head">
            People you may know
            <span className="find-head-note">friends of your friends</span>
          </h2>
          {/*
            Friends of your friends, and only them: somebody you could already
            reach by asking the friend you have in common, so the suggestion
            saves a message rather than disclosing a relationship you had no
            route to. The count of mutuals, never their names — see
            `suggestionsFor`.
          */}
          <div className="faces-row">
            {suggested.map((person) => (
              <PersonCard key={person.actorId} person={person} />
            ))}
          </div>
        </section>
      )}

      {!asking && wantsGroups && mine.length > 0 && (
        <section className="find-section">
          <h2 className="find-head">Your groups</h2>
          {/*
            Chips rather than rows. These are places this person already goes;
            drawn at the same size as a suggestion they have never heard of,
            they were the loudest thing on a page about finding something else.
          */}
          <div className="group-chips">
            {mine.map((group) => (
              <a key={group.id} href={`/group/${group.id}`} className="group-chip">
                <span className="group-chip-mark" aria-hidden="true">
                  {initial(group.name)}
                </span>
                <span className="group-chip-name">{group.name}</span>
                <span className="group-chip-note">
                  {group.role === 'admin' ? 'Admin' : 'Member'}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/*
        A scope with nothing behind it yet says so, rather than showing the
        heading and no rows — which reads as something that failed to load.
      */}
      {!asking &&
        ((scope === 'all' && bare) ||
          (scope === 'groups' && !showsDoors && !showsMine)) && (
        <p className="find-empty">
          {mine.length === 0
            ? 'You are not in any groups yet. Type a name to look one up — a group can be findable, and what you get back is a door rather than what is behind it.'
            : 'No groups to suggest yet — these are findable groups your friends are in. Type a name to look one up.'}
        </p>
      )}

      {/*
        Events have no idle list any more, so this scope is the box and this
        sentence. The second wording is new and has to exist: without it,
        pressing Events shows a page with nothing on it, which reads as a
        failure rather than as "these are matched, not browsed".
      */}
      {!asking && scope === 'events' && (
        <p className="find-empty">
          {events.length === 0
            ? 'No albums yet. Make one, or open a link somebody sent you, and it will be findable here by name or by place.'
            : 'Albums are matched here rather than listed — the home screen is where they all are. Type a name or a place and the ones that match come back.'}
        </p>
      )}

      {!asking && scope === 'people' && suggested.length === 0 && (
        <p className="find-empty">
          Nobody to suggest yet — suggestions are friends of your friends. Type
          a handle to find somebody directly.
        </p>
      )}

      {/*
        The rules, one click away, and beside them the one rule that has to be
        visible without being asked for.

        The absence of an event list is a decision, and an absence cannot say
        so by itself: a page that used to have "Your events" on it and now does
        not reads as something broken unless the reason is written down where
        the list was.
      */}
      <div className="find-foot">
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
        <span className="find-foot-note">
          Albums are never recommended — only ones you have the link to are here
          at all.
        </span>
      </div>
    </>
  );
}

/**
 * A findable group, and the friends who are the reason it is on the screen.
 *
 * Its own component for the state: asking is per card, and a single busy flag
 * on the page would grey out three cards because somebody pressed one.
 */
function DoorCard({ group }: { group: SuggestedGroup }) {
  const [asked, setAsked] = useState(group.asked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tint = tintFor(group.id);

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    // Optimistic in one direction only, and restored on failure. Everything
    // else in the product answers this way: the press is believed, and a line
    // appears if it turns out it should not have been.
    setAsked(true);
    try {
      const res = await fetch(`/api/groups/${group.id}/requests`, { method: 'POST' });
      if (!res.ok) throw new Error('That did not go through. Try again in a moment.');
    } catch (err) {
      setAsked(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id]);

  return (
    <div className="door">
      <div className="door-head">
        {/*
          Never a photograph. A group has no cover, and borrowing one from an
          event inside it would put a picture from a room on a card offered to
          somebody who has not been let into the room.
        */}
        <span
          className="door-mark"
          style={{ background: tint.fill, color: tint.ink }}
          aria-hidden="true"
        >
          {initial(group.name)}
        </span>
        <span className="door-text">
          <a className="door-name" href={`/group/${group.id}`}>
            {group.name}
          </a>
          <span className="door-count">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
      </div>

      <div className="door-foot">
        <span className="door-faces" aria-hidden="true">
          {group.mutuals.map((person) => (
            <Face
              key={person.id}
              src={person.avatar}
              size={22}
              className="door-face"
              fallback={
                // A lens rather than an initial. A row of letters beside
                // "Priya and Dee are in this" says the two names twice.
                <span
                  className="door-face-lens"
                  style={{ background: tintFor(person.id).fill }}
                />
              }
            />
          ))}
        </span>
        <span className="door-why">{mutualLine(group)}</span>
        {asked ? (
          // Not a disabled button. Asking again is not a thing that can be
          // done — there is one open request per person per group — so what is
          // left is a statement of where it got to.
          <span className="door-asked">Asked</span>
        ) : (
          <button type="button" className="door-ask" onClick={ask} disabled={busy}>
            Ask to join
          </button>
        )}
      </div>
      {error && <p className="door-error">{error}</p>}
    </div>
  );
}

/**
 * "Priya and Dee are in this."
 *
 * Two names and then a number, which is how somebody says it out loud. The
 * third name is where a sentence turns into a membership list, and the list is
 * not this card's to publish — these are the reader's own friends, and nobody
 * else in the group is named at all.
 */
function mutualLine(group: SuggestedGroup): string {
  const names = group.mutuals.map(
    (person) => person.name?.trim() || (person.handle ? `@${person.handle}` : 'A friend'),
  );
  if (names.length === 0) return 'Somebody you know is in this';
  const rest = group.mutualCount - names.length;
  const who =
    names.length === 1
      ? names[0]!
      : rest > 0
        ? `${names.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`
        : `${names[0]} and ${names[1]}`;
  const verb = names.length === 1 && rest === 0 ? 'is' : 'are';
  return `${who} ${verb} in this`;
}

/**
 * Somebody you may know, as a card rather than a row.
 *
 * A face, a name and how many friends you have in common — the count only,
 * never which ones. Naming them tells the reader which of *their own* friends
 * knows this person, which is a fact about those two that neither was asked
 * about.
 */
function PersonCard({ person }: { person: Suggestion }) {
  /* Bare, like the row below and like the top of the page this leads to. The
     `@` marks a string as the thing you can type at a search box; in the slot
     where a card says who somebody is, it is punctuation in front of a name. */
  const name = person.displayName?.trim() || person.handle || 'Someone';
  const href = person.handle ? `/u/${encodeURIComponent(person.handle)}` : '/friends';
  const tint = tintFor(person.actorId);
  return (
    <a href={href} className="face-card">
      {/*
        The picture where there is one, and the tinted letter where there is
        not — a suggestion is a stranger, so being able to recognise the face
        is most of what makes it answerable. The tint stays as the fallback
        rather than being replaced by a grey circle: it is assigned from the
        id, so a person keeps the same colour as this list changes around them.
      */}
      <Face
        src={person.avatar}
        // 48, matching `.face-card-mark`: `Face` writes the size inline, so a
        // different number here would quietly win over the stylesheet.
        size={48}
        className="face-card-mark"
        fallback={
          <span
            className="face-card-letter"
            style={{ background: tint.fill, color: tint.ink }}
            aria-hidden="true"
          >
            {initial(name)}
          </span>
        }
      />
      <span className="face-card-name">{name}</span>
      <span className="face-card-note">
        {person.mutuals} {person.mutuals === 1 ? 'mutual friend' : 'mutual friends'}
      </span>
    </a>
  );
}

/** One kind of answer, under its own heading. */
function Answers({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="find-section">
      <h2 className="hit-head">{title}</h2>
      <ul className="hits">{children}</ul>
    </section>
  );
}

/** An event somebody typed for. */
function EventRow({ event, onOpen }: { event: EventHit; onOpen?: () => void }) {
  return (
    <li>
      <a href={`/event/${event.id}`} className="hit" onClick={onOpen}>
        <Face
          src={event.thumb}
          size={38}
          className="hit-thumb"
          fallback={<span aria-hidden="true">{initial(event.name)}</span>}
        />
        <span className="hit-text">
          <strong>{event.name}</strong>
          {(event.place || event.caption) && (
            <span className="muted">{event.place ?? event.caption}</span>
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
function PersonRow({ person, onOpen }: { person: Person; onOpen?: () => void }) {
  /*
   * Bare. The handle is on the line underneath, always, wearing the `@` that
   * says what it is — so a result with no name written in read "@wren" over
   * "@wren", which is the sigil doing its job once and decorating a name the
   * other time. This is the same rule the profile this row opens keeps at the
   * top of the page: a name does not start with punctuation.
   */
  const name = person.displayName?.trim() || person.handle || 'Someone';
  /*
   * The person, not the friends list.
   *
   * Every one of these rows used to lead to `/friends` — an answer to "who do
   * I know" for somebody who had just asked "who is this". A handle is what
   * that page is keyed by, and a row without one cannot be visited: it is not
   * a findable person, so it is not one with a page.
   */
  const href = person.handle ? `/u/${encodeURIComponent(person.handle)}` : '/friends';

  /*
   * Where the two of you stand, and what the row is allowed to offer about it.
   *
   * `standing` comes from `/api/people`. The two local lists on this page —
   * your own friends and the events you can already see — send none, and for
   * friends that is not a gap: somebody in your friends list is a friend, and
   * defaulting to it is the truth rather than a guess.
   *
   * Held in state because pressing changes it, and the answer comes from the
   * server: `POST /api/friends` replies with the status it now holds, which
   * is `accepted` when this crossed with an ask of theirs and the endpoint
   * answered that instead of opening a second one.
   */
  const [standing, setStanding] = useState<Standing>(person.standing ?? 'friends');
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      if (!res.ok) throw new Error('no');
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      setStanding(body.status === 'accepted' ? 'friends' : 'asked');
    } catch {
      // The row keeps saying what it said. A search result is not the place to
      // report a failed request — the profile is one tap away and says the
      // same thing with room to explain itself.
      setStanding('none');
    } finally {
      setBusy(false);
    }
  }, [person.actorId]);

  return (
    <li className="hit-row">
      <a href={href} className="hit" onClick={onOpen}>
        {/*
          Their picture, and the letter only when there is none.

          `/api/people` sends it now, which is what makes this row worth
          looking at rather than reading: a column of identical letter-tiles is
          a list you parse, and a face is one you recognise. `Face` rather than
          an `<img>` because the URL is presigned for an hour and a tab left
          open outlives it — the letter is what an expired one becomes, not the
          broken-image glyph.
        */}
        <Face
          src={person.avatar}
          size={38}
          className="hit-thumb"
          fallback={<span aria-hidden="true">{initial(name)}</span>}
        />
        <span className="hit-text">
          <strong>{name}</strong>
          <span className="muted">{person.handle ? `@${person.handle}` : ''}</span>
        </span>
      </a>
      {/*
        Asking, from the list.

        A stranger found by handle is somebody you looked up in order to ask —
        that is the whole of what being findable leads to in this product — and
        the ask was two screens away: open their profile, find the button,
        come back. It is the same `POST /api/friends` that button makes, and it
        is beside the row rather than inside it because a button inside a link
        is a button that navigates.

        Only the two states this row can honestly act on. "Requested" is a word
        rather than a control: withdrawing is somebody's own to do and it is
        done on their page, where there is room to say what it means. An ask
        pointing at *you* says so and sends you there to answer it — a list is
        not the place to accept somebody, and the page that is already has
        Accept and Decline side by side.
      */}
      {standing === 'none' && (
        <button type="button" className="secondary small hit-do" disabled={busy} onClick={ask}>
          Add friend
        </button>
      )}
      {standing === 'asked' && <span className="hit-said">Requested</span>}
      {standing === 'asking' && (
        <a href={href} className="hit-said hit-said-link" onClick={onOpen}>
          Asked you
        </a>
      )}
    </li>
  );
}
