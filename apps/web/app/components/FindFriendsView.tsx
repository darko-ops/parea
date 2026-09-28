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

/** The first letter of a name, for a row with no picture in it. */
function initial(name: string): string {
  return name.trim().replace('@', '').slice(0, 1).toUpperCase() || '?';
}

type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  /** Presigned on the server and short-lived — see `Face`. */
  avatar: string | null;
  mutuals: number;
  albums: number;
  groups: number;
};

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

  const [phone, setPhone] = useState('');
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
        body: JSON.stringify({ phone }),
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
  }, [phone]);

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

  return (
    /*
      `.main` and `.main-head`, the shape every prose-and-panels page in this
      client takes — see `FriendsView`. Not Find's own warm `.main-find`: that
      surface exists to make a column of cards read as objects, and this page is
      a form and a list.
    */
    <main className="main">
      <div className="main-head">
        <h1>Find friends</h1>
      </div>

      {state === null ? (
        <p className="muted">Looking…</p>
      ) : (
        <>
          {!verified && (
            /*
              The ask, and it is the whole page until it is answered.

              A list of people under an unanswered form is a page arguing with
              itself: one half saying "we need something from you", the other
              half already doing the thing.
            */
            <section className="panel">
              <h2>Add your phone number</h2>
              <p className="muted">
                So the people who already have your number can find you here.
                That is the whole of it &mdash; we do not read your contacts, and
                the number itself is never stored or shown to anybody.
              </p>

              {sentTo === null ? (
                <>
                  <label htmlFor="ff-phone">Phone number</label>
                  <div className="row">
                    <input
                      id="ff-phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+44 7700 900123"
                    />
                    <button
                      className="small"
                      disabled={busy || phone.trim().length < 7}
                      onClick={() => void sendCode()}
                    >
                      Send me a code
                    </button>
                  </div>
                  <p className="muted">
                    Start with the country code. We cannot guess which country a
                    local number belongs to, so a wrong guess would quietly find
                    nobody.
                  </p>
                  {/*
                    What pressing the button does, under the button.

                    Five things have to be here and each is a sentence rather
                    than a clause of boilerplate: who texts you, what arrives,
                    how often, who pays, and where the rules are. It reads as
                    ordinary honesty and it is also, precisely, what US carriers
                    check when they ask for proof of consent — a verification
                    campaign is approved or refused on whether the screen that
                    asks for the number tells somebody they are about to be
                    texted.

                    Under the control rather than over it: that is where the eye
                    already is when reaching for it, and the field's own hint has
                    the line directly beneath it. The app places it identically —
                    one campaign covers both clients, and a screenshot of one is
                    submitted as evidence for the other.

                    It *asks* rather than describes, and that is a correction. It
                    used to open "Tapping this sends you one text…", which states
                    a fact about what the button does — true, and not consent. A
                    carrier reviewing it said so: the opt-in has to show somebody
                    agreeing to receive text messages rather than merely being
                    told that some will arrive. "You agree to receive" is the
                    difference, and naming the button in the sentence is what ties
                    the agreement to the act.
                  */}
                  <p className="muted sms-consent">
                    By tapping &ldquo;Send me a code&rdquo; you agree to receive
                    one text message from Parea containing a verification code.
                    One message per request, not a subscription. Message and data
                    rates may apply. See our <a href="/terms">Terms</a> and{' '}
                    <a href="/privacy">Privacy</a>.
                  </p>
                </>
              ) : (
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
              )}

              {error && <p className="muted">{error}</p>}
            </section>
          )}

          {verified && (
            <>
              {error && <p className="muted">{error}</p>}

              {/*
                What the number did, said on the page that asked for it.

                Not a boast and not fine print. Adding a number made somebody
                findable by anybody who has it, and the honest place to say so is
                here rather than leaving them to discover it in their account
                settings — which is also where the sentence points, because a
                statement about a switch with no route to the switch is worse
                than silence.
              */}
              <p className="muted find-friends-standing">
                Your number ends {state.phone.last2 ?? '••'}.{' '}
                {state.discoverable ? (
                  <>
                    People who have it can find you &mdash; turn that off in{' '}
                    <a href="/account">your account</a> whenever you like.
                  </>
                ) : (
                  <>
                    People who have it cannot find you: that is switched off in{' '}
                    <a href="/account">your account</a>.
                  </>
                )}
              </p>

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
                <section className="find-section">
                  <h2 className="find-head">People you may know</h2>
                  <ul className="hits">
                    {state.people.map((person) => {
                      const name = person.displayName?.trim() || person.handle || 'Someone';
                      const standing = asked[person.actorId];
                      return (
                        <li key={person.actorId} className="hit-row">
                          {/* The row opens the person; the button asks. A row
                              whose only action is the ask would make deciding
                              whether you know somebody impossible from here. */}
                          <a
                            href={person.handle ? `/u/${encodeURIComponent(person.handle)}` : '#'}
                            className="hit"
                          >
                            {/* Through `Face` rather than an `<img>`: the URL is
                                presigned for an hour and a tab left open
                                outlives it, so the letter is what an expired one
                                becomes rather than the broken-image glyph. The
                                same row the handle search draws. */}
                            <Face
                              src={person.avatar}
                              size={38}
                              className="hit-thumb"
                              fallback={<span aria-hidden="true">{initial(name)}</span>}
                            />
                            <span className="hit-text">
                              <strong>{name}</strong>
                              <span className="muted">{reasonFor(person)}</span>
                            </span>
                          </a>
                          {standing === 'asked' ? (
                            /* A word rather than a disabled button. Asking is
                               done and there is nothing to press; a greyed-out
                               "Add friend" invites a second click and answers it
                               with nothing. The same word the handle search's
                               rows use. */
                            <span className="hit-said">Requested</span>
                          ) : (
                            <button
                              type="button"
                              className="secondary small hit-do"
                              disabled={standing === 'asking'}
                              onClick={() => void ask(person)}
                            >
                              Add friend
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
