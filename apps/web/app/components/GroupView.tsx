'use client';

/**
 * The group screen — docs/design.md §3.
 *
 * Deliberately plain. A group is a name, a member list and the events under
 * it; the moment it grows a profile picture and a bio it has stopped being the
 * answer to a distribution problem and started being a social network.
 *
 * The one thing it does that matters: "New event here", which reaches everyone
 * already without anybody chasing a dozen people through separate
 * conversations.
 */

import { useCallback, useState } from 'react';

type GroupData = {
  id: string;
  name: string;
  memberCount: number;
  member: boolean;
  role: 'member' | 'admin' | null;
  canJoinDirectly: boolean;
  events: { id: string; name: string; linkToken: string; eventDate: string | null }[];
};

export function GroupView({ group }: { group: GroupData }) {
  const [state, setState] = useState(group);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [requested, setRequested] = useState(false);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${group.id}/members`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
        return;
      }
      // Not someone who has been to one of its events: they have to ask.
      const asked = await fetch(`/api/groups/${group.id}/requests`, { method: 'POST' });
      if (!asked.ok) throw new Error('Could not ask to join.');
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id]);

  const createEvent = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newName, groupId: group.id }),
        });
        if (!res.ok) throw new Error('Could not create it.');
        const created = (await res.json()) as { url: string };
        window.location.href = created.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [group.id, newName],
  );

  if (!state.member) {
    return (
      <main className="wrap">
        <h1>{state.name}</h1>
        <p className="muted">
          {state.memberCount} {state.memberCount === 1 ? 'member' : 'members'}
        </p>
        <div className="panel">
          {requested ? (
            <p className="muted">
              Asked to join. Someone who runs this group will decide.
            </p>
          ) : (
            <>
              <p className="muted">
                You can see that this group exists. You cannot see its photos
                until you are in it.
              </p>
              <button onClick={join} disabled={busy}>
                {state.canJoinDirectly ? 'Join' : 'Ask to join'}
              </button>
            </>
          )}
          {error && <p className="muted">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>{state.name}</h1>
      <p className="muted">
        {state.memberCount} {state.memberCount === 1 ? 'member' : 'members'}
        {state.role === 'admin' && ' · you run this'}
      </p>

      <form className="panel" onSubmit={createEvent}>
        <label htmlFor="ev">Something new</label>
        <input
          id="ev"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Sunday roast"
          maxLength={120}
          required
        />
        <button type="submit" disabled={busy || !newName.trim()} style={{ marginTop: 12 }}>
          Create it here
        </button>
        <p className="muted" style={{ marginTop: 10 }}>
          Everyone in the group can add photos without being invited.
        </p>
      </form>

      <section className="panel">
        <h2>Everything so far</h2>
        {state.events.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          state.events.map((event) => (
            <p key={event.id}>
              <a href={`/event/${event.id}`}>{event.name}</a>
              {event.eventDate && <span className="muted"> · {event.eventDate}</span>}
            </p>
          ))
        )}
      </section>

      <p className="muted footer">
        <button
          className="secondary"
          onClick={async () => {
            await fetch(`/api/groups/${group.id}/members`, { method: 'DELETE' });
            window.location.href = '/';
          }}
        >
          Leave this group
        </button>
      </p>

      <p className="muted footer">
        <a href="/events">Your events</a> · <a href="/account">Your account</a> ·{' '}
        <a href="/safety">Safety, reporting and contact</a> ·{' '}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </main>
  );
}
