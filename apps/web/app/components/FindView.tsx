'use client';

/**
 * The interactive half of Find: a group search box, and your events by place.
 *
 * The search is debounced and hits the same `/api/groups/search` the native
 * client uses. What comes back is a *door* — a group's name and how many
 * people are in it — never its events or its photos. §3: you can see that a
 * group exists and nothing inside it until you are in it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Door = { id: string; name: string; memberCount: number };
type Place = { place: string; events: { id: string; name: string }[] };

/** Long enough that typing a word is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function FindView({ places, unplaced }: { places: Place[]; unplaced: number }) {
  const [query, setQuery] = useState('');
  const [doors, setDoors] = useState<Door[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against an early request landing after a later one and overwriting
  // newer results with staler ones.
  const latest = useRef(0);

  const search = useCallback(async (q: string) => {
    const mine = ++latest.current;
    if (q.trim().length < 2) {
      setDoors([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/groups/search?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as { groups?: Door[] };
      if (mine === latest.current) setDoors(body.groups ?? []);
    } catch {
      if (mine === latest.current) setDoors([]);
    } finally {
      if (mine === latest.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void search(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <>
      <section className="panel">
        <label htmlFor="q">Find a group</label>
        <input
          id="q"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sunday roast"
          autoComplete="off"
        />
        <p className="muted" style={{ marginTop: 10 }}>
          Groups can be findable. Events and photos never are — the only way
          into one is a link someone sent you.
        </p>

        {doors.length > 0 && (
          <ul className="plain" style={{ marginTop: 14 }}>
            {doors.map((door) => (
              <li key={door.id}>
                <a href={`/group/${door.id}`}>{door.name}</a>{' '}
                <span className="muted">
                  · {door.memberCount} {door.memberCount === 1 ? 'member' : 'members'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!searching && query.trim().length >= 2 && doors.length === 0 && (
          <p className="muted" style={{ marginTop: 14 }}>
            No group by that name. Groups are only findable if whoever runs one
            chose to make it so.
          </p>
        )}
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Your events by place</h2>
        {places.length === 0 ? (
          <p className="muted">
            None of your events has a place yet. Add one when you start the
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
            {unplaced} {unplaced === 1 ? 'event has' : 'events have'} no place set.
          </p>
        )}
      </section>
    </>
  );
}
