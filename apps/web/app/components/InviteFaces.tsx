'use client';

/**
 * Asking people in from the create form: a card that says who, and opens onto
 * a rail of faces.
 *
 * The app's `InviteFaces`, in a browser. Closed, it is one line — the faces
 * already picked, stacked, and how many. Open, it is the two sources
 * `MemberPicker` reads, friends and a search by handle, drawn as faces to click
 * rather than rows to read. Picking still asks rather than adds, and nothing is
 * sent until the roll exists: `picked` lives with the caller for that reason.
 */

import { useEffect, useState } from 'react';

import { Face } from './Faces';
import { initialOf, lensFor } from './lens';
import { nameOf, type Person } from './MemberPicker';

/** What the invites route takes in one request. */
const MAX_PER_REQUEST = 50;

/** Long enough that a handle being typed does not spend a request per letter. */
const SEARCH_DELAY_MS = 250;

function firstNameOf(person: Person): string {
  return nameOf(person).split(/\s+/)[0] ?? nameOf(person);
}

/** "Nobody yet", "Maya & Priya", "Maya, Jonah +2" — then "will be asked". */
function askedLine(picked: Person[]): string {
  if (picked.length === 0) return 'Nobody yet — tap to pick friends';
  const names = picked.map(firstNameOf);
  if (names.length <= 2) return `${names.join(' & ')} will be asked`;
  return `${names[0]}, ${names[1]} +${names.length - 2} will be asked`;
}

/** Their picture, or their letter on their lens — keyed on the actor. */
function PersonFace({ person, size, className }: { person: Person; size: number; className: string }) {
  const lens = lensFor(person.actorId);
  return (
    <Face
      src={person.avatar}
      size={size}
      className={className}
      fallback={
        <span className="invite-letter" style={{ background: lens.fill, color: lens.ink }} aria-hidden="true">
          {initialOf(nameOf(person))}
        </span>
      }
    />
  );
}

export function InviteFaces({
  picked,
  onChange,
}: {
  picked: Person[];
  onChange: (next: Person[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Person[]>([]);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void fetch('/api/friends')
      .then((r) => (r.ok ? r.json() : { friends: [] }))
      .then((body) => setFriends(body.friends ?? []))
      // The search is the other half; an error here must not close both.
      .catch(() => {});
  }, []);

  // The same endpoint, delay and two-letter floor as `MemberPicker`.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setFound([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
        setFound(res.ok ? ((await res.json()).people ?? []) : []);
      } catch {
        setFound([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const chosen = new Set(picked.map((p) => p.actorId));

  const toggle = (person: Person) => {
    if (chosen.has(person.actorId)) {
      onChange(picked.filter((p) => p.actorId !== person.actorId));
      return;
    }
    // Refused rather than truncated on send: the control says so, not a 400.
    if (picked.length >= MAX_PER_REQUEST) return;
    onChange([...picked, person]);
  };

  /*
   * What the rail shows. With a search, its results less anybody already
   * picked, who is in the stack above. Without one, anybody picked from an
   * earlier search first, so they can be clicked back out, then friends.
   */
  const searched = term.trim().length >= 2;
  const friendIds = new Set(friends.map((f) => f.actorId));
  const rail = searched
    ? found.filter((p) => !chosen.has(p.actorId))
    : [...picked.filter((p) => !friendIds.has(p.actorId)), ...friends];

  // Nobody picked: the first three friends, faint, as a hint of what goes here.
  const stack = picked.length > 0 ? picked.slice(0, 3) : friends.slice(0, 3);
  const title = picked.length === 0 ? 'Invite friends' : `${picked.length} invited`;

  return (
    <div className={`invite-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="invite-head"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {stack.length > 0 && (
          <span className={`invite-stack${picked.length === 0 ? ' is-hint' : ''}`} aria-hidden="true">
            {stack.map((person) => (
              <PersonFace key={person.actorId} person={person} size={34} className="invite-stack-face" />
            ))}
          </span>
        )}
        <span className="invite-text">
          <span className="invite-title">{title}</span>
          <span className="invite-sub">{askedLine(picked)}</span>
        </span>
        <span className="invite-search-button" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </span>
      </button>

      {/* Collapsed by its grid row, so it can slide open; inert while shut so
          the search is not a tab stop nobody can see. */}
      <div className="invite-panel" inert={!open}>
        <div className="invite-panel-inner">
        <label className="invite-field">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search friends or @handle"
            aria-label="Search friends or @handle"
            autoComplete="off"
          />
        </label>

        {rail.length > 0 ? (
          <ul className="invite-rail">
            {rail.map((person) => {
              const on = chosen.has(person.actorId);
              const name = nameOf(person);
              return (
                <li key={person.actorId}>
                  <button
                    type="button"
                    className={`invite-person${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={on ? `${name}, take out` : `Ask ${name}`}
                    onClick={() => toggle(person)}
                  >
                    <span className="invite-person-face">
                      <PersonFace person={person} size={54} className="invite-rail-face" />
                      <span className="invite-check" aria-hidden="true">✓</span>
                    </span>
                    <span className="invite-person-name">{firstNameOf(person)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          // Not "no such person": the search hides anybody either side of a
          // block, so a handle that exists can legitimately answer nothing.
          <p className="invite-empty">
            {searched
              ? searching
                ? 'Looking…'
                : 'Nobody to show for that.'
              : 'Search for somebody by their @handle.'}
          </p>
        )}

        {picked.length >= MAX_PER_REQUEST && (
          <p className="invite-empty">That is {MAX_PER_REQUEST}, which is as many as one go takes.</p>
        )}
        </div>
      </div>
    </div>
  );
}
