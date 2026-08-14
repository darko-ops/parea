'use client';

/**
 * Where it was, with the spelling done for you.
 *
 * A text input first and an autocomplete second, in that order: whatever is
 * typed is the answer, and a suggestion only replaces it if somebody picks
 * one. The field worked before this existed and still works when the lookup
 * returns nothing — which it does whenever the deployment has no places key —
 * so nobody is ever stuck unable to name a pub because a third party is down.
 *
 * What is stored is the label and nothing else. See `api/places` for why there
 * are no coordinates in this product.
 */

import { useEffect, useRef, useState } from 'react';

type Place = { label: string };

/** Long enough that somebody has stopped typing, short enough to feel live. */
const DEBOUNCE_MS = 220;
const MIN = 3;

export function PlaceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  /** What the last accepted suggestion was, so it is not offered back. */
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < MIN || query === chosen.current) {
      setPlaces([]);
      return;
    }

    /*
     * Debounced, and the in-flight request is abandoned rather than awaited.
     *
     * Without the abort, answers arrive in whatever order the network returns
     * them and the list ends up showing suggestions for a prefix of what is in
     * the box — the classic autocomplete bug, and the one people read as "it
     * suggested nonsense" rather than as a race.
     */
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { places?: Place[] };
        setPlaces(body.places ?? []);
        setOpen(true);
      } catch {
        // Aborted, offline, or a provider having a bad day. The field is a
        // text box either way.
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  return (
    <div className="place">
      <input
        id="place"
        type="text"
        value={value}
        onChange={(e) => {
          chosen.current = null;
          onChange(e.target.value);
        }}
        onFocus={() => setOpen(places.length > 0)}
        // `blur` fires before a click on the list lands, so closing on it
        // would make every suggestion unclickable. The delay is the standard
        // fix and the reason this is not `onBlur={() => setOpen(false)}`.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Add a location"
        maxLength={80}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && places.length > 0}
        aria-autocomplete="list"
      />

      {open && places.length > 0 && (
        <ul className="place-list">
          {places.map((place) => (
            <li key={place.label}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chosen.current = place.label;
                  onChange(place.label);
                  setOpen(false);
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
