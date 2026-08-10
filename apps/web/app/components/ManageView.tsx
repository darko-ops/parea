'use client';

/**
 * The host screen — docs/design.md §5 and §13.
 *
 * Everything a host can do, in one place, ordered by how urgent it is rather
 * than how interesting: pending removal requests first, because someone is
 * waiting on an answer and a clock is running; then the three switches; then
 * the two destructive actions.
 *
 * The requests list is the reason this screen has to exist at all. Without it
 * the 48-hour auto-hide is the only outcome that ever occurs and the host's
 * ability to decline is theoretical.
 */

import { useCallback, useEffect, useState } from 'react';

type PendingReport = {
  id: string;
  note: string | null;
  autoHideAt: string | null;
  alreadyHidden: boolean;
  photo: { id: string; src: string };
};

export function ManageView({
  eventId,
  initial,
}: {
  eventId: string;
  initial: { name: string; joinsOpen: boolean; uploadsOpen: boolean; code: string | null; url: string };
}) {
  const [joinsOpen, setJoinsOpen] = useState(initial.joinsOpen);
  const [uploadsOpen, setUploadsOpen] = useState(initial.uploadsOpen);
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [link, setLink] = useState(initial.url);
  const [code, setCode] = useState(initial.code);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadReports = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/reports`);
    if (res.ok) setReports((await res.json()).reports);
  }, [eventId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function resolve(reportId: string, action: 'remove' | 'decline') {
    setBusy(reportId);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function setSwitch(patch: { joinsOpen?: boolean; uploadsOpen?: boolean }) {
    setBusy('switch');
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Could not save that.');
      const next = await res.json();
      setJoinsOpen(next.joinsOpen);
      setUploadsOpen(next.uploadsOpen);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy('rotate');
    try {
      const res = await fetch(`/api/events/${eventId}/rotate`, { method: 'POST' });
      if (!res.ok) throw new Error('Could not rotate the link.');
      const next = await res.json();
      setLink(next.url);
      setCode(next.code);
      setConfirmRotate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function destroy() {
    setBusy('delete');
    try {
      const res = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete it.');
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>{initial.name}</h1>
        <p className="muted">
          <a href={`/event/${eventId}`}>Back to the photos</a>
        </p>
      </header>

      <section className="panel">
        <h2>
          Requests to take a photo down
          {reports.length > 0 && ` (${reports.length})`}
        </h2>
        {reports.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="pending">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={report.photo.src} alt="" />
              <div>
                <p className="muted">
                  {report.alreadyHidden
                    ? 'Hidden automatically because this went unanswered. Declining puts it back.'
                    : report.autoHideAt
                      ? `Hidden automatically ${relative(report.autoHideAt)} unless you answer.`
                      : 'Awaiting your decision.'}
                </p>
                {report.note && <p className="muted">&ldquo;{report.note}&rdquo;</p>}
                <div className="row">
                  <button
                    onClick={() => resolve(report.id, 'remove')}
                    disabled={busy === report.id}
                  >
                    Take it down
                  </button>
                  <button
                    className="secondary"
                    onClick={() => resolve(report.id, 'decline')}
                    disabled={busy === report.id}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <h2>Who can do what</h2>
        <div className="switch">
          <span>
            New people can join
            <br />
            <span className="muted">
              Turning this off does not remove anyone already here.
            </span>
          </span>
          <button
            className="secondary"
            disabled={busy === 'switch'}
            onClick={() => setSwitch({ joinsOpen: !joinsOpen })}
          >
            {joinsOpen ? 'On' : 'Off'}
          </button>
        </div>
        <div className="switch">
          <span>
            People can still add photos
            <br />
            <span className="muted">Late photos are usually the point.</span>
          </span>
          <button
            className="secondary"
            disabled={busy === 'switch'}
            onClick={() => setSwitch({ uploadsOpen: !uploadsOpen })}
          >
            {uploadsOpen ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>The link</h2>
        <code>{typeof window === 'undefined' ? link : new URL(link, window.location.origin).toString()}</code>
        {code && <p className="muted">Or say: {code}</p>}
        {confirmRotate ? (
          <>
            <p className="muted">
              This replaces the link and the spoken code. Everyone loses access
              until you send them the new one — including people who have
              already added photos. Use it if the link reached someone it
              should not have.
            </p>
            <div className="row">
              <button className="danger" onClick={rotate} disabled={busy === 'rotate'}>
                {busy === 'rotate' ? 'Replacing…' : 'Replace the link'}
              </button>
              <button className="secondary" onClick={() => setConfirmRotate(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="secondary" onClick={() => setConfirmRotate(true)}>
            Replace the link
          </button>
        )}
      </section>

      <section className="panel">
        <h2>Delete</h2>
        {confirmDelete ? (
          <>
            <p className="muted">
              Deletes the event and every photo in it, for everyone. Anyone who
              has not downloaded them yet will not get another chance.
            </p>
            <div className="row">
              <button className="danger" onClick={destroy} disabled={busy === 'delete'}>
                {busy === 'delete' ? 'Deleting…' : 'Delete this event'}
              </button>
              <button className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="secondary" onClick={() => setConfirmDelete(true)}>
            Delete this event
          </button>
        )}
      </section>

      {error && <p className="muted">{error}</p>}
    </main>
  );
}

/** "in about 3 hours" / "shortly", without pulling in a date library. */
function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'shortly';
  const hours = Math.round(ms / 3600_000);
  if (hours < 1) return 'within the hour';
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}
