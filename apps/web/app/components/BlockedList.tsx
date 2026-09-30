'use client';

/**
 * The people this person has blocked, and the way back — design §13.
 *
 * A block is silent, which makes this list the only place it is visible to
 * anyone. That is the reason it has to exist: a tool that can be picked up in
 * one tap from a photograph and never seen again is a tool somebody forgets
 * they used, and then wonders why a friend's pictures stopped arriving.
 *
 * ## The confirmation is in the row, not in a dialog
 *
 * Unblocking is the one thing on this screen that reaches somebody else — they
 * start seeing this person's photos again, without being told why. The row
 * turns into the question, naming who it is about, so the answer is given
 * looking at their face rather than at a browser's box that could be about
 * anyone.
 */

import { useCallback, useEffect, useState } from 'react';

import { Avatar } from './Avatar';

type Blocked = {
  actorId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  blockedAt: string;
};

export function BlockedList() {
  // Null is "not yet" and draws nothing; an empty list is a real answer.
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/blocks')
      .then((r) => r.json())
      .then((body: { blocked?: Blocked[] }) => setBlocked(body.blocked ?? []))
      .catch(() => setBlocked([]));
  }, []);

  const unblock = useCallback(async (person: Blocked) => {
    setBusy(true);
    try {
      const res = await fetch('/api/blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      if (!res.ok) {
        setNote(`Could not unblock ${person.name}. Try again in a moment.`);
        return;
      }
      /*
       * Taken off the list rather than re-fetched: the route only ever deletes
       * the one row, so the list without it is exactly what a reload would say.
       */
      setBlocked((list) => (list ?? []).filter((p) => p.actorId !== person.actorId));
      setNote(`${person.name} is unblocked.`);
    } finally {
      setAsking(null);
      setBusy(false);
    }
  }, []);

  return (
    <section className="panel">
      <h2>Blocked</h2>
      <p className="muted">
        You and the people here do not see each other&apos;s photos, messages,
        comments or moments — even in albums and groups you share. They are not
        told.
      </p>

      {blocked?.map((person) => (
        <div className="device-row" key={person.actorId}>
          {asking === person.actorId ? (
            <>
              <p className="device-detail blocked-ask">
                Unblock {person.name}? You will see each other’s photos, messages, comments and moments again.
              </p>
              <div className="row blocked-buttons">
                <button className="danger" onClick={() => unblock(person)} disabled={busy}>
                  Unblock
                </button>
                <button className="secondary" onClick={() => setAsking(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="blocked-who">
                <Avatar
                  url={person.avatarUrl}
                  initial={person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
                  className="message-face"
                />
                <div>
                  <p className="device-name">{person.name}</p>
                  {/* Skipped when the name already is the handle, which is
                      what the route falls back to for somebody with no name. */}
                  {person.handle && person.name !== `@${person.handle}` && (
                    <p className="device-detail">@{person.handle}</p>
                  )}
                </div>
              </div>
              <button
                className="secondary"
                onClick={() => {
                  setNote(null);
                  setAsking(person.actorId);
                }}
                disabled={busy}
              >
                Unblock
              </button>
            </>
          )}
        </div>
      ))}

      {blocked?.length === 0 && <p className="muted">You have not blocked anyone.</p>}

      {note && <p className="muted">{note}</p>}
    </section>
  );
}
