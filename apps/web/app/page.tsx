'use client';

import { useCallback, useState } from 'react';

import { WHEN_OPTIONS, eventDateFor, windowFor, type WindowId } from '@parea/autoselect';

import { Rail } from './components/Rail';
import { SignIn, useSession } from './components/SignIn';

/**
 * Create — design §3 screen 1, and the design handoff's 3a-3.
 *
 * Two columns: the form, and beside it what happens next. The share step used
 * to be a page you were sent to after creating, which put the most important
 * moment in the product behind a state transition — the event is worth nothing
 * until the link reaches the group chat, and the second after making it is
 * when someone is most likely to send it. Now it is visible the whole time and
 * simply fills in.
 *
 * This is also the public landing page and the only indexable one, so the
 * subheading is the pitch rather than an instruction.
 *
 * ## Why it asks when, and why native does not
 *
 * A window is what lets other people's own photos from the right hours be
 * found for them later instead of asking them to scroll. The native client no
 * longer asks: it reads the last few days off the phone and offers the runs it
 * finds, which is exact where a phrase is approximate. A browser has no
 * library to read, so here the question stands — and §17's rule still holds
 * that a *wrong* window is worse than none, which is why nothing is
 * pre-selected and "Not sure yet" is a real answer rather than the result of
 * skipping the question.
 */
export default function CreatePage() {
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [when, setWhen] = useState<WindowId | ''>('');
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Public unless the creator says otherwise — the forwarded link still works. */
  const [isPrivate, setIsPrivate] = useState(false);
  const session = useSession();

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!when || !name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const now = new Date();
        const window = windowFor(when, now);
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            place: place.trim() || undefined,
            eventDate: eventDateFor(when, now),
            // The pair the question exists to collect. Sent together or not at
            // all — the server refuses half a window, because half resolves
            // against an open interval, which is every photo on a device.
            startsAt: window?.startsAt ?? null,
            endsAt: window?.endsAt ?? null,
            accessPolicy: isPrivate ? 'account_required' : 'link_open',
          }),
        });
        if (!res.ok) throw new Error(await explain(res));
        const created = (await res.json()) as { url: string; code: string | null };
        setLink(new URL(created.url, globalThis.location.origin).toString());
        setCode(created.code);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [name, place, when, isPrivate],
  );

  const copy = useCallback(async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    // A label that changes back, rather than a toast. The feedback belongs on
    // the thing that was pressed.
    setTimeout(() => setCopied(false), 2000);
  }, [link]);

  const chosen = WHEN_OPTIONS.find((option) => option.id === when);

  return (
    <div className="shell">
      <Rail current={null} />

      <main className="main" style={{ padding: '36px 40px' }}>
        <div className="create">
          <form className="create-form" onSubmit={create}>
            <div>
              <h1>{link ? name : 'Start an event'}</h1>
              <p className="muted" style={{ margin: 0 }}>
                {link
                  ? 'Made. Send the link — an empty event stays empty.'
                  : 'Everyone who was there puts their photos in one place, and everyone gets the full set.'}
              </p>
            </div>

            {!link && session.known && !session.account && (
              <SignIn
                why="Making an event needs an account, so the people you invite know whose event it is."
                onSignedIn={session.refresh}
              />
            )}

            {!link && session.known && session.account && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="name">
                    WHAT WAS IT?
                  </label>
                  <input
                    id="name"
                    className="big"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sarah's birthday"
                    maxLength={120}
                    required
                  />
                </div>

                <div className="field">
                  <div className="field-head">
                    <label className="field-label" htmlFor="place">
                      WHERE
                    </label>
                    <span className="field-note">Optional · shows up under Find, by place</span>
                  </div>
                  <input
                    id="place"
                    type="text"
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    placeholder="Add a place"
                    maxLength={80}
                  />
                  {/*
                    As you would say it, not an address, and never derived from
                    a photo: §7.6 strips GPS at ingest and ingest fails if any
                    survives, so there is nothing to derive it from even if the
                    product wanted to.
                  */}
                  <p className="field-help">
                    As you&rsquo;d say it, not an address. Only ever shown to
                    people already in the event.
                  </p>
                </div>

                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label" style={{ padding: 0 }}>
                    WHEN
                  </legend>
                  <div className="pills">
                    {WHEN_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="pill"
                        aria-pressed={when === option.id}
                        onClick={() => setWhen(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {/*
                    The selected option's own description, then why the question
                    is being asked at all. A date question with no stated reason
                    gets a careless answer, and a careless one here pre-selects
                    the wrong photos on somebody else's phone.
                  */}
                  <p className="field-help">
                    {chosen ? `${capitalise(chosen.hint)}. ` : ''}
                    It is what lets everyone&rsquo;s own photos from the right
                    hours be found for them later, instead of asking them to
                    scroll. &ldquo;Not sure yet&rdquo; is a real answer.
                  </p>
                </fieldset>

                <fieldset className="field">
                  <legend className="field-label">WHO CAN SEE IT</legend>
                  <div className="pills">
                    <button
                      type="button"
                      className="pill"
                      aria-pressed={!isPrivate}
                      onClick={() => setIsPrivate(false)}
                    >
                      Anyone with the link
                    </button>
                    <button
                      type="button"
                      className="pill"
                      aria-pressed={isPrivate}
                      onClick={() => setIsPrivate(true)}
                    >
                      Only people signed in
                    </button>
                  </div>
                  <p className="field-help">
                    {isPrivate
                      ? 'The link still has to reach them, and they sign in before they see anything. Use this when the link may travel further than the guest list.'
                      : 'Whoever holds the link sees the photos, no account needed. Adding photos always needs one.'}
                  </p>
                </fieldset>

                <button
                  type="submit"
                  className="create-go"
                  disabled={busy || !name.trim() || !when}
                >
                  {busy ? 'Creating…' : 'Get a link'}
                </button>
                {error && <p className="muted">{error}</p>}
              </>
            )}

            {link && (
              <p className="muted">
                <a href={link}>Open it and add yours first</a> — an empty event
                stays empty.
              </p>
            )}
          </form>

          <aside className="aside">
            <div>
              <h2>Then send it</h2>
              <p className="field-help" style={{ margin: 0 }}>
                The link is the whole invitation — no app to install, and
                nothing to sign up for to look. Adding photos needs an account.
              </p>
            </div>

            <div className="aside-row">
              {/*
                Before there is a link this says so rather than showing a
                plausible-looking one. A greyed example someone might try to
                copy is worse than an empty state.
              */}
              <span className="aside-link">
                {link ?? 'Your link appears here'}
              </span>
              {link && (
                <button type="button" className="as-text" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>

            {code && (
              <div>
                <p className="field-label" style={{ marginBottom: 8 }}>
                  OR SAY IT OUT LOUD
                </p>
                <div className="aside-code">{code}</div>
                <p className="field-help" style={{ marginTop: 8 }}>
                  For the person across the room whose phone you are not
                  holding.
                </p>
              </div>
            )}

            <p className="aside-foot">
              On a phone you can pick people straight from your contacts. In a
              browser, paste it into the group chat — that is where everyone
              already is.
            </p>
          </aside>
        </div>

        <p className="muted footer">
          <a href="/events">Your events</a> · <a href="/account">Your account</a> ·{' '}
          <a href="/safety">Safety, reporting and contact</a> ·{' '}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </main>
    </div>
  );
}

/**
 * What actually went wrong, rather than "could not create the event".
 *
 * That message was all this page said for every failure, and it threw away
 * the server's answer to produce it. The commonest cause by far is a
 * deployment with no database — which looks, to whoever is typing, exactly
 * like their event name being unacceptable. A message that sends someone to
 * inspect their own input for a server problem is worse than no message.
 */
async function explain(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };

  switch (body.error) {
    case 'name_required':
      return 'That name is empty or too long.';
    case 'invalid_window':
      return 'That time window did not make sense. Pick when it was again.';
    case 'too_many_requests':
      return 'Too many events made from here just now. Try again in a while.';
    case 'not_a_member':
      return 'You are not in that group.';
    case 'sign_in_required':
      return 'Making an event needs an account. Sign in and try again.';
    case 'invalid_access_policy':
      return 'That is not a setting for who can see the event.';
    case 'not_configured':
      return 'This deployment is not finished — it has no database yet. Check /api/health.';
  }
  return res.status >= 500
    ? `The server failed (${res.status}). Check /api/health for what is missing.`
    : `Could not create the event (${res.status}).`;
}

/** The hints read as sentence fragments; this one starts a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
