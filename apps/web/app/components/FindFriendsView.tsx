'use client';

/**
 * Find Friends — the people already here who may know you.
 *
 * Reached from the one control in the corner of Find. That page is a box over
 * three namespaces and it answers what you type; this is the other half of the
 * same question, and nobody can type it: *who is here that I know?*
 *
 * ## Why there is no contacts import
 *
 * The usual build of this screen asks for an address book and matches it. This
 * product refuses, and the reason is not squeamishness: an uploaded address book
 * is a list of people who never agreed to anything. Half of them are not users;
 * some of them are ex-partners and doctors and the plumber. The dialog asks one
 * person for a favour and spends everybody else's privacy to grant it.
 *
 * So the suggestions are built out of records this product already had a reason
 * to keep, and every one of them is a relationship the reader can see the other
 * end of already — friends in common, albums you were both in, groups you are
 * both in. See `recommendationsFor`, which is the whole of it.
 *
 * ## Why it asks for a number
 *
 * The number finds nobody; the query never reads it. It is the reciprocity. This
 * is the one page where somebody is handed the benefit of everybody else being
 * reachable, and the price is being reachable themselves — so the first state is
 * the ask, and the sentence beside it says what adding a number *does* rather
 * than dressing it up as a security step.
 *
 * ## Client, and why
 *
 * The verification is two round trips with a field between them, which is a
 * form with state. The rest of the page could have been server-rendered and
 * would then have to be two components sharing one payload, refetched after
 * every step. One client component, one endpoint.
 */

import { useCallback, useEffect, useState } from 'react';

import { Face } from './Faces';
import { initialOf, lensFor } from './lens';
import { RailIcon } from './RailIcon';

/**
 * The countries a code can be texted to — the server's allowance, as
 * `smsCountries` defaults it and production leaves it. A country it refuses
 * would only turn a choice into an error. The app offers the same three.
 */
const COUNTRIES = [
  { region: 'US', name: 'United States', code: '+1', short: 'US' },
  { region: 'CA', name: 'Canada', code: '+1', short: 'CA' },
  { region: 'GB', name: 'United Kingdom', code: '+44', short: 'UK' },
] as const;
type Region = (typeof COUNTRIES)[number]['region'];

/** The browser's own region, to start the picker on; the first entry otherwise. */
function browserRegion(): Region {
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const region = tag.split('-').find((part) => /^[A-Z]{2}$/.test(part));
      const match = COUNTRIES.find((c) => c.region === region);
      if (match) return match.region;
    }
  } catch {}
  return COUNTRIES[0].region;
}

/**
 * What the phone route is sent: the picker's code and the digits, spaces gone.
 * A number typed with its own `+` is sent as typed, so the server can say what
 * it says about it.
 */
function fullNumber(code: string, phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[\s()-]/g, '');
  return `${code}${trimmed.replace(/\D/g, '').replace(/^0+/, '')}`;
}

/** The first letter of a name, for a row with no picture in it. */
type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  /** Presigned on the server and short-lived — see `Face`. */
  avatar: string | null;
  mutuals: number;
  albums: number;
  groups: number;
  /** The evidence; absent from a deploy older than this client. */
  mutualFriends?: { handle: string | null; name: string }[];
  roll?: string | null;
  group?: string | null;
};

/** Suggestions drawn at a time, as in the app. */
const SUGGESTION_PAGE = 10;

type Payload = {
  phone: { last2: string | null; verified: boolean };
  discoverable: boolean;
  people: Person[];
};

/**
 * Why somebody is on the list, in the words the row uses.
 *
 * Strongest reason first and one reason only. A row reading "2 mutual friends ·
 * 1 album together · 1 group together" is three facts about a stranger before
 * the reader has decided whether they recognise the name, and the first is
 * already the whole argument; the others are why the order is what it is, not
 * something to print.
 *
 * Mutual friends lead because they are other people having already vouched. An
 * album is "we were in the same room". A group is only "we are both on a list",
 * which is the weakest and still worth saying, because it names a room the
 * reader can go and look at.
 *
 * The app says the same five sentences from `answers.ts`. Two clients wording
 * one idea twice is how they come to disagree about what the product knows.
 */
export function reasonFor(person: Person): string {
  if (person.mutuals > 0) {
    return `${person.mutuals} mutual ${person.mutuals === 1 ? 'friend' : 'friends'}`;
  }
  if (person.albums > 0) {
    return person.albums === 1
      ? 'In a roll with you'
      : `In ${person.albums} rolls with you`;
  }
  if (person.groups > 0) {
    return person.groups === 1
      ? 'In a group with you'
      : `In ${person.groups} groups with you`;
  }
  // The server does not send a row with all three at nought — a row is on the
  // list because one of them is not. Here so that a stale response is vague
  // rather than saying "0 mutual friends".
  return 'You may know them';
}

export function FindFriendsView() {
  /** Null until the first answer: the difference between asking and nobody. */
  const [state, setState] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The national number; the country code is `region`'s, its own control. */
  const [phone, setPhone] = useState('');
  /** The consent box under the number. Unticked on every visit; see below. */
  const [smsAgreed, setSmsAgreed] = useState(false);
  /*
   * Starts on the first entry and moves to the browser's region after mount:
   * read during render, the server's guess and the browser's would disagree
   * and React would throw the tree away.
   */
  const [region, setRegion] = useState<Region>(COUNTRIES[0].region);
  useEffect(() => setRegion(browserRegion()), []);
  const country = COUNTRIES.find((c) => c.region === region) ?? COUNTRIES[0];
  const [code, setCode] = useState('');
  /**
   * The number a code has just gone to, as its last two digits.
   *
   * Local, and it is what puts the card in its middle state. The pending row is
   * deliberately invisible to every read in the product — nothing about a claim
   * nobody has proved belongs in an account payload — so "a code is outstanding"
   * is knowledge this page has and the server will not hand back. Losing it by
   * reloading is correct: the code still works, and the way to use it is to ask
   * again, which supersedes rather than accumulating.
   */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Who has been asked from here, in this tab.
   *
   * Not a reload. Re-fetching the list to make one row disappear would take the
   * whole thing out from under a cursor halfway down it.
   */
  const [asked, setAsked] = useState<Record<string, 'asking' | 'asked'>>({});
  /** How many suggestions are drawn: ten, and ten more each "Show more". */
  const [shown, setShown] = useState(SUGGESTION_PAGE);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/people/recommendations');
      if (!res.ok) throw new Error(String(res.status));
      setState((await res.json()) as Payload);
      setError(null);
    } catch {
      // Kept apart from an empty list, which is a real and common answer.
      // "Nobody new right now" and "we could not find out" are different
      // sentences and only one of them is worth a retry under.
      setState({ phone: { last2: null, verified: false }, discoverable: false, people: [] });
      setError('Could not load this. Reload to try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/phone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: fullNumber(country.code, phone) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        last2?: string;
      };
      if (!res.ok) {
        /*
         * One refusal is worth its own sentence and the server names it: a
         * number with no country code. "Invalid" would send somebody back to
         * retype the same digits, because what is wrong is not in them.
         */
        setError(
          body.error === 'needs_country_code'
            ? 'Start with the country code, like +44 or +1.'
            : body.error === 'country_not_supported'
              ? 'Numbers from that country are not supported yet.'
            : body.error === 'try_later'
              ? 'Confirming numbers is paused for today. Try again tomorrow.'
            : body.error === 'too_many_requests'
              ? 'That is a lot of codes for one hour. Try again later.'
              : body.error === 'not_configured'
                // The one failure that is about this deployment rather than
                // about the number, and it is not something waiting will fix —
                // so the sentence does not suggest trying again.
                ? 'Confirming a number is not set up on this deployment yet.'
                : 'Could not send a code just now. Try again in a moment.',
        );
        return;
      }
      setSentTo(body.last2 ?? null);
      setCode('');
    } finally {
      setBusy(false);
    }
  }, [country.code, phone]);

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/phone/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        // The route knows which of five things went wrong — expired, mistyped,
        // spent, too many tries, already somebody else's — and says so.
        // Inventing a sentence here would eventually say the wrong one.
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'That code did not work. Ask for another.');
        return;
      }
      setSentTo(null);
      setPhone('');
      setCode('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [code, load]);

  const ask = useCallback(async (person: Person) => {
    setAsked((was) => ({ ...was, [person.actorId]: 'asking' }));
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAsked((was) => ({ ...was, [person.actorId]: 'asked' }));
    } catch {
      // Back to a button that can be pressed again, rather than a row stuck
      // saying it is doing something it has stopped doing.
      setAsked((was) => {
        const next = { ...was };
        delete next[person.actorId];
        return next;
      });
    }
  }, []);

  const verified = state?.phone.verified === true;
  /** Nothing added and no code outstanding: the whole page is the ask. */
  const asking = state !== null && !verified && sentTo === null;

  /*
   * A pasted international number, split back into the two controls: a code
   * the picker knows moves into it and the rest stays. One it does not know is
   * left whole and sent as typed.
   */
  const typeNumber = (next: string) => {
    const trimmed = next.trim();
    if (trimmed.startsWith('+')) {
      const match = [...COUNTRIES]
        .sort((a, b) => b.code.length - a.code.length)
        .find((c) => trimmed.replace(/[\s()-]/g, '').startsWith(c.code));
      if (match) {
        if (match.code !== country.code) setRegion(match.region);
        setPhone(trimmed.slice(match.code.length).trim());
        return;
      }
    }
    setPhone(next);
  };

  return (
    /*
      `.main` and `.main-head`, the shape every prose-and-panels page in this
      client takes — see `FriendsView`. Not Find's own warm `.main-find`: that
      surface exists to make a column of cards read as objects, and this page is
      a form and a list.
    */
    <main className="main">
      <div className="main-head ffl-top">
        <div className="ffl-title">
          <h1>Find friends</h1>
          {verified && (
            <span className="ffl-lede">
              People you may know, from rolls, groups and friends you share.
            </span>
          )}
        </div>
        {verified && state && (
          /*
            What the number did, said on the page that asked for it — a card on
            a phone, a pill beside the title on a desktop. Not a boast and not
            fine print: adding a number made somebody findable by anybody who
            has it, and it points at the switch, because a statement about a
            switch with no route to it is worse than silence.
          */
          <div className={`ffl-status${state.discoverable ? ' on' : ''}`}>
            <span className="ffl-dot" aria-hidden="true" />
            <span className="ffl-status-text">
              <strong>
                {state.discoverable ? 'Findable' : 'Not findable'} by your number ··
                {state.phone.last2 ?? '••'}
              </strong>
              <span>
                {state.discoverable
                  ? 'People who have it can find you.'
                  : 'Switched off in your account.'}
              </span>
            </span>
            <a href="/account" className="ffl-pill">
              Account
            </a>
          </div>
        )}
      </div>

      {state === null ? (
        <p className="muted">Looking…</p>
      ) : (
        <>
          {asking && (
            /*
              The ask, and it is the whole page until it is answered.

              A list of people under an unanswered form is a page arguing with
              itself: one half saying "we need something from you", the other
              half already doing the thing. So there is no panel around it —
              the page is the panel: one promise, the number in two parts, the
              button and what pressing it agrees to, and a way out for somebody
              who only wanted a handle. The app's screen is the same page.
            */
            <section className="ff-ask">
              <div className="ff-hero">
                <span className="ff-disc" aria-hidden="true">
                  <RailIcon glyph="add-person" />
                </span>
                <h2>Find contacts</h2>
                <p className="muted">
                  Add your number so people who already have it can find you
                  here. We never upload your contacts, and the number is never
                  shown to anybody.
                </p>
              </div>

              {/*
                The country code as its own control, so a local number is typed
                the way people know it. It answers in a control what the old
                hint asked for in words: we cannot guess which country a local
                number belongs to, and a wrong guess would quietly find nobody.
              */}
              <div className="ff-field">
                <select
                  className="ff-country"
                  aria-label="Country code"
                  value={region}
                  onChange={(e) => setRegion(e.target.value as Region)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.region} value={c.region} aria-label={`${c.name} ${c.code}`}>
                      {c.code} {c.short}
                    </option>
                  ))}
                </select>
                <input
                  id="ff-phone"
                  className="ff-number"
                  type="tel"
                  autoComplete="tel-national"
                  aria-label="Your phone number"
                  value={phone}
                  onChange={(e) => typeNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy && smsAgreed && phone.replace(/\D/g, '').length >= 6) {
                      void sendCode();
                    }
                  }}
                  placeholder={country.code === '+44' ? '7700 900123' : '201 555 0123'}
                />
              </div>

              {/*
                Consent, as a box somebody ticks, between the number and the
                button that sends to it.

                Five things are in the sentence — who texts you, what arrives,
                how often, who pays, and where the rules are — which is what US
                carriers check before approving the campaign. It was a sentence
                under the button, and a reviewer refused it twice: once because
                it described what the button did rather than asking for
                agreement, and again because there was nothing to *tick*. An
                opt-in has to be an act, unticked until the person does it, so
                the button stays off until they have.

                Word for word the same as the app's and as `CONSENT` on /texts,
                which is the public copy a reviewer reads; a test holds the
                three together.
              */}
              <label className="auth-agree ff-agree">
                <input
                  type="checkbox"
                  checked={smsAgreed}
                  onChange={(e) => setSmsAgreed(e.target.checked)}
                />
                <span className="muted">
                  I agree to receive one text message from Parea containing a
                  verification code each time I tap &ldquo;Send me a code&rdquo;.
                  One message per request, not a subscription. Message and data
                  rates may apply. See our <a href="/terms">Terms</a> and{' '}
                  <a href="/privacy">Privacy</a>.
                </span>
              </label>

              <button
                className="ff-send"
                disabled={busy || !smsAgreed || phone.replace(/\D/g, '').length < 6}
                onClick={() => void sendCode()}
              >
                {busy ? 'Sending…' : 'Send me a code'}
              </button>

              {error && <p className="muted ff-error">{error}</p>}

              <p className="ff-handle">
                Know their handle? <a href="/find?scope=people">Search on Find</a>
              </p>
            </section>
          )}

          {!verified && !asking && (
            /*
              A code outstanding: the panel it has always been, with the six
              digits and the two of the number it went to.
            */
            <section className="panel">
              <h2>Add your phone number</h2>
              <p className="muted">
                So the people who already have your number can find you here.
                That is the whole of it &mdash; we never upload your contacts,
                and the number itself is never stored or shown to anybody.
              </p>

              <>
                <p className="muted">We sent a code to the number ending {sentTo}.</p>
                <label htmlFor="ff-code">The six-digit code</label>
                <div className="row">
                  <input
                    id="ff-code"
                    // Lets a browser fill it straight from the text message,
                    // which is the same hand-off the sign-in field takes.
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                  <button
                    className="small"
                    disabled={busy || code.trim().length < 6}
                    onClick={() => void confirm()}
                  >
                    Confirm
                  </button>
                </div>
                {/* Asking again supersedes rather than accumulating — only the
                    newest code can be presented — so this is "start over"
                    without having to say so. */}
                <button
                  className="secondary small"
                  disabled={busy}
                  onClick={() => {
                    setSentTo(null);
                    setCode('');
                    setError(null);
                  }}
                >
                  Use a different number
                </button>
              </>

              {error && <p className="muted">{error}</p>}
            </section>
          )}

          {verified && (
            <>
              {error && <p className="muted">{error}</p>}

              {state.people.length === 0 ? (
                /*
                  The empty state, and it has to be a sentence rather than a
                  shrug.

                  This list is built from albums, groups and friends in common,
                  so empty means something specific and cheerful: the product has
                  nothing to go on yet. Saying that is the difference between a
                  page that looks broken and one that tells somebody what would
                  fill it.
                */
                <p className="find-empty">
                  Nobody new to suggest right now. Suggestions come from rolls
                  you have both been in, groups you are both in, and friends you
                  have in common &mdash; so this fills up as you share evenings
                  with people. You can also find anybody by their handle on{' '}
                  <a href="/find">Find</a>.
                </p>
              ) : (
                <section className="ffl-section">
                  <div className="ffl-head">
                    <h2>People you may know</h2>
                    <span>{state.people.length}</span>
                  </div>

                  {/* One list on a phone, a grid of cards on a desktop: the
                      same people twice, and CSS shows one. A card has room to
                      show *why* — the friends' faces, the roll, the group — and
                      a row has room to say it. */}
                  <ul className="ffl-list">
                    {state.people.slice(0, shown).map((person) => (
                      <PersonRow
                        key={person.actorId}
                        person={person}
                        standing={asked[person.actorId]}
                        onAsk={() => void ask(person)}
                      />
                    ))}
                  </ul>
                  <ul className="ffl-grid">
                    {state.people.slice(0, shown).map((person) => (
                      <PersonCard
                        key={person.actorId}
                        person={person}
                        standing={asked[person.actorId]}
                        onAsk={() => void ask(person)}
                      />
                    ))}
                  </ul>
                  {state.people.length > shown && (
                    <button
                      type="button"
                      className="secondary ffl-more"
                      onClick={() => setShown((n) => n + SUGGESTION_PAGE)}
                    >
                      Show more
                    </button>
                  )}
                </section>
              )}

              <p className="ffl-handle">
                Know their handle? <a href="/find?scope=people">Search on Find</a>
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}

type Standing = 'asking' | 'asked' | undefined;

/** Why they are here, as a colour and a glyph on the corner of their face. */
type Kind = 'friends' | 'rolls' | 'groups';

function kindOf(person: Person): Kind {
  return person.mutuals > 0 ? 'friends' : person.albums > 0 ? 'rolls' : 'groups';
}

/**
 * The line under the reason on a card: the friends by name, the roll, the
 * group. Null when the server sent none — an older deploy, or an unnamed group
 * — and the card then says the reason alone.
 */
function evidenceFor(person: Person): string | null {
  const kind = kindOf(person);
  if (kind === 'friends') {
    const names = (person.mutualFriends ?? []).map((f) => f.name.split(' ')[0]);
    if (names.length === 0) return null;
    const more = person.mutuals - names.length;
    if (more > 0) return `${names.join(', ')} and ${more} more`;
    return names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  if (kind === 'rolls') {
    if (!person.roll) return null;
    return person.albums > 1 ? `${person.roll} +${person.albums - 1}` : person.roll;
  }
  return person.group ?? null;
}

function KindGlyph({ kind }: { kind: Kind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'friends' && (
        <>
          <circle cx="9.5" cy="8.5" r="3.5" />
          <path d="M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5" />
          <path d="M16 5.4a3.5 3.5 0 0 1 0 6.2" />
          <path d="M17.5 14.9c2.2.5 3.5 1.9 3.5 4.6" />
        </>
      )}
      {kind === 'rolls' && (
        <>
          <rect x="8" y="4" width="12.5" height="12.5" rx="2" />
          <path d="M16 20H5.5a2 2 0 0 1-2-2V8" />
        </>
      )}
      {kind === 'groups' && (
        <>
          <path d="M9 2.5h10A2.5 2.5 0 0 1 21.5 5v5A2.5 2.5 0 0 1 19 12.5" />
          <path d="M4 8h10a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 18H8l-4 3.5 1-3.5H4a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 4 8z" />
        </>
      )}
    </svg>
  );
}

function AddGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5" />
      <line x1="18.5" y1="3.5" x2="18.5" y2="9.5" />
      <line x1="15.5" y1="6.5" x2="21.5" y2="6.5" />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Their picture, or their letter on their own lens. */
function Avatar({ person, size, name }: { person: Person; size: number; name: string }) {
  const lens = lensFor(person.handle ?? person.actorId);
  return (
    <Face
      src={person.avatar}
      size={size}
      className="ffl-face"
      fallback={
        <span
          className="ffl-letter"
          style={{ background: lens.fill, color: lens.ink, fontSize: Math.round(size * 0.375) }}
          aria-hidden="true"
        >
          {initialOf(name)}
        </span>
      }
    />
  );
}

/**
 * The ask. "Requested" once asked: a word in an outline rather than a disabled
 * button, because asking is done and there is nothing to press — a greyed-out
 * Add invites a second click and answers it with nothing.
 */
function AskButton({
  standing,
  name,
  onAsk,
  label,
  className,
}: {
  standing: Standing;
  name: string;
  onAsk: () => void;
  label: string;
  className: string;
}) {
  if (standing === 'asked') {
    return (
      <span className={`${className} ffl-asked`}>
        <TickGlyph />
        Requested
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${className} ffl-add`}
      disabled={standing === 'asking'}
      onClick={onAsk}
      aria-label={`Add ${name} as a friend`}
    >
      <AddGlyph />
      {label}
    </button>
  );
}

function PersonRow({ person, standing, onAsk }: { person: Person; standing: Standing; onAsk: () => void }) {
  const name = person.displayName?.trim() || person.handle || 'Someone';
  const kind = kindOf(person);
  return (
    <li className="ffl-row">
      {/* The row opens the person; the button asks. A row whose only action is
          the ask would make deciding whether you know somebody impossible. */}
      <a href={person.handle ? `/u/${encodeURIComponent(person.handle)}` : '#'} className="ffl-row-link">
        <span className="ffl-row-face">
          <Avatar person={person} size={48} name={name} />
          <span className={`ffl-kind ffl-kind-${kind}`}>
            <KindGlyph kind={kind} />
          </span>
        </span>
        <span className="ffl-row-text">
          <strong>{name}</strong>
          <span>{reasonFor(person)}</span>
        </span>
      </a>
      <AskButton standing={standing} name={name} onAsk={onAsk} label="Add" className="ffl-row-do" />
    </li>
  );
}

function PersonCard({ person, standing, onAsk }: { person: Person; standing: Standing; onAsk: () => void }) {
  const name = person.displayName?.trim() || person.handle || 'Someone';
  const kind = kindOf(person);
  const lens = lensFor(person.handle ?? person.actorId);
  const evidence = evidenceFor(person);
  return (
    <li className="ffl-card">
      <span className="ffl-band" style={{ background: lens.fill }} aria-hidden="true" />
      <a href={person.handle ? `/u/${encodeURIComponent(person.handle)}` : '#'} className="ffl-card-link">
        <span className="ffl-card-face">
          <Avatar person={person} size={72} name={name} />
        </span>
        <span className="ffl-card-name">
          <strong>{name}</strong>
          {person.handle && <span>@{person.handle}</span>}
        </span>
      </a>
      <div className="ffl-why">
        {kind === 'friends' && (person.mutualFriends ?? []).length > 0 && (
          <span className="ffl-why-faces" aria-hidden="true">
            {(person.mutualFriends ?? []).map((friend, i) => {
              const fl = lensFor(friend.handle ?? friend.name);
              return (
                <span key={i} style={{ background: fl.fill, color: fl.ink }}>
                  {initialOf(friend.name)}
                </span>
              );
            })}
          </span>
        )}
        {kind === 'rolls' && (
          <span className="ffl-why-rolls" aria-hidden="true">
            {Array.from({ length: Math.min(person.albums, 3) }, (_, i) => (
              <span key={i} />
            ))}
          </span>
        )}
        {kind === 'groups' && person.group && (
          <span
            className="ffl-why-group"
            style={{ background: lensFor(person.group).fill, color: lensFor(person.group).ink }}
            aria-hidden="true"
          >
            {initialOf(person.group)}
          </span>
        )}
        <span className="ffl-why-text">
          <strong>{reasonFor(person)}</strong>
          {evidence && <span>{evidence}</span>}
        </span>
      </div>
      <AskButton standing={standing} name={name} onAsk={onAsk} label="Add friend" className="ffl-card-do" />
    </li>
  );
}

