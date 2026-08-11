'use client';

import { useState } from 'react';

import { WHEN_OPTIONS, eventDateFor, windowFor, type WindowId } from '@parea/autoselect';

/**
 * Create — screen 1 of design §3. Name, when, get a link.
 *
 * This file used to claim it asked for the time window "rather than inferring
 * it", and it did not: it asked for a date and sent only that, so
 * `starts_at`/`ends_at` were null on every event ever made and auto-selection
 * fell back to inference for all of them. The comment is the reason nobody
 * noticed, which is worth remembering about comments.
 *
 * It asks properly now, with the same phrases the native client uses and from
 * the same module — `@parea/autoselect`, beside the `resolveWindow` that
 * consumes them, so the two clients cannot come to disagree about what
 * "Tonight" means.
 *
 * A date picker would be the obvious web-native control and it is the wrong
 * one: a date is not a window, and §17 records that a *wrong* window is worse
 * than none, because it pre-ticks the wrong photos and spends the
 * contributor's trust and their photo-library permission in one moment. So the
 * same rules as native — nothing pre-selected, and "not sure" is an answer
 * rather than the result of skipping the question.
 */
export default function CreatePage() {
  const [name, setName] = useState('');
  const [when, setWhen] = useState<WindowId | ''>('');
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!when) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const window = windowFor(when, now);
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          eventDate: eventDateFor(when, now),
          // The pair the whole screen exists to collect. Sent together or not
          // at all — the server refuses half a window, because half resolves
          // against an open interval, which is every photo on a device.
          startsAt: window?.startsAt ?? null,
          endsAt: window?.endsAt ?? null,
        }),
      });
      if (!res.ok) throw new Error('Could not create the event.');
      const created = (await res.json()) as { url: string; code: string | null };
      setLink(new URL(created.url, globalThis.location.origin).toString());
      setCode(created.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (link) {
    return (
      <main className="wrap">
        <h1>Share this</h1>
        <p className="muted">
          Anyone with the link can add their photos. No account, no app.
        </p>
        <div className="panel">
          <code>{link}</code>
        </div>
        <button onClick={() => navigator.clipboard.writeText(link)}>
          Copy link
        </button>

        {code && (
          <div className="panel" style={{ marginTop: 16 }}>
            <p className="muted">Or say the code out loud</p>
            <h2>{code}</h2>
            <p className="muted">
              For the person across the room whose phone you are not holding.
            </p>
          </div>
        )}

        <p className="muted" style={{ marginTop: 24 }}>
          <a href={link}>Open it and add yours first</a> — an empty event stays
          empty.
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>Every photo from everyone who was there</h1>
      <p className="muted">
        Make a place to put them. Share the link. Everyone gets the full set.
      </p>
      <form className="panel" onSubmit={create}>
        <label htmlFor="name">What was it?</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sarah's birthday"
          maxLength={120}
          required
        />

        <fieldset className="choices">
          <legend>When?</legend>
          {/*
            Said plainly. A date question with no stated reason gets a careless
            answer, and a careless one here is worse than none.
          */}
          <p className="muted">
            This is what lets people&rsquo;s own photos from the right hours be
            found for them later, instead of asking them to scroll.
          </p>
          {WHEN_OPTIONS.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="radio"
                name="when"
                value={option.id}
                checked={when === option.id}
                onChange={() => setWhen(option.id)}
              />
              <span>
                {option.label}
                <span className="muted"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <button type="submit" disabled={busy || !name.trim() || !when}>
          {busy ? 'Creating…' : 'Get a link'}
        </button>
      </form>
      {error && <p className="muted">{error}</p>}

      <p className="muted footer">
        {/*
          Below the fold on the one page someone lands on cold. An account is
          optional and does one thing; putting it near the top would suggest
          this is something you sign up for, which is the opposite of the
          product.
        */}
        <a href="/account">Your account</a> ·{' '}
        <a href="/safety">Safety, reporting and contact</a> ·{' '}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </main>
  );
}
