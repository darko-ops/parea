'use client';

import { useState } from 'react';

/**
 * Create — screen 1 of design §3. Name, optional date, get a link.
 *
 * The time window is asked for here rather than inferred, because inference
 * from existing uploads only helps contributor five and the person with 200
 * photos is often contributor one (design §7.3). It stays optional: a required
 * field on the creation screen is a worse trade than a missing window.
 */
export default function CreatePage() {
  const [name, setName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, eventDate: eventDate || undefined }),
      });
      if (!res.ok) throw new Error('Could not create the event.');
      const created = (await res.json()) as { url: string };
      setLink(new URL(created.url, window.location.origin).toString());
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
        <label htmlFor="date" style={{ marginTop: 16 }}>
          When? <span className="muted">(optional)</span>
        </label>
        <input
          id="date"
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()} style={{ marginTop: 16 }}>
          {busy ? 'Creating…' : 'Get a link'}
        </button>
      </form>
      {error && <p className="muted">{error}</p>}
    </main>
  );
}
