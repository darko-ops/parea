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

import { REQUEST_ACCESS } from '@parea/core';
import { useCallback, useEffect, useState } from 'react';

import { useImageFailure } from './useImageFailure';

type PendingReport = {
  id: string;
  note: string | null;
  autoHideAt: string | null;
  alreadyHidden: boolean;
  photo: { id: string; src: string };
};

type AccessRequest = {
  id: string;
  createdAt: string;
  displayName: string | null;
  handle: string | null;
};

export function ManageView({
  eventId,
  initial,
}: {
  eventId: string;
  initial: {
    name: string;
    joinsOpen: boolean;
    uploadsOpen: boolean;
    accessPolicy: string;
    code: string | null;
    url: string;
    groupId: string | null;
  };
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
  const [groupName, setGroupName] = useState('');
  const [findable, setFindable] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);

  const loadReports = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/reports`);
    if (res.ok) setReports((await res.json()).reports);
  }, [eventId]);

  /**
   * Only fetched for the policy that produces them.
   *
   * The route answers 404 to anyone who is not the host, so calling it on a
   * public event would work and return an empty list — and then the section
   * below would render "Nothing waiting" under a heading about a feature that
   * event does not have.
   */
  const loadRequests = useCallback(async () => {
    if (initial.accessPolicy !== REQUEST_ACCESS) return;
    const res = await fetch(`/api/events/${eventId}/access-requests`);
    if (res.ok) setRequests((await res.json()).requests);
  }, [eventId, initial.accessPolicy]);

  useEffect(() => {
    void loadReports();
    void loadRequests();
  }, [loadReports, loadRequests]);

  async function answer(requestId: string, action: 'approve' | 'decline') {
    setBusy(requestId);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/access-requests`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      });
      if (!res.ok) throw new Error('Could not save that.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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

      {initial.accessPolicy === REQUEST_ACCESS && (
        <section className="panel">
          <h2>Asking to come in{requests.length > 0 && ` (${requests.length})`}</h2>
          {requests.length === 0 ? (
            <p className="muted">Nobody waiting.</p>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="pending pending-person">
                <div>
                  <p>
                    {request.displayName ?? 'Someone'}
                    {request.handle && <span className="muted"> @{request.handle}</span>}
                  </p>
                  {/*
                    Said plainly: approving is not "they can look", it is "they
                    are in", and in this product being in an event means being
                    able to add to it. Somebody clicking through a queue should
                    not have to remember that.
                  */}
                  <p className="muted">
                    Approving lets them see the photos and add their own.
                  </p>
                  <div className="row">
                    <button
                      onClick={() => answer(request.id, 'approve')}
                      disabled={busy === request.id}
                    >
                      Let them in
                    </button>
                    <button
                      className="secondary"
                      onClick={() => answer(request.id, 'decline')}
                      disabled={busy === request.id}
                    >
                      Not this time
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      )}

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
              <PendingThumb src={report.photo.src} />
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

      {!initial.groupId && (
        <section className="panel">
          <h2>Keep doing this?</h2>
          <p className="muted">
            If the same people keep turning up, make a group. The next thing you
            create reaches everyone in it without you sending anything to
            anyone, and the photos land in one running archive instead of a
            series of links people lose.
          </p>
          <label htmlFor="gname">Call it</label>
          <input
            id="gname"
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="The Flat"
            maxLength={80}
          />
          <div className="switch" style={{ marginTop: 12 }}>
            <span>
              Let people find it by name
              <br />
              <span className="muted">
                Off for a friend group. On for a club or a team — people can see
                the name and ask to join, never the photos.
              </span>
            </span>
            <button
              className="secondary"
              onClick={() => setFindable((v) => !v)}
              type="button"
            >
              {findable ? 'On' : 'Off'}
            </button>
          </div>
          <button
            style={{ marginTop: 12 }}
            disabled={busy === 'group' || !groupName.trim()}
            onClick={async () => {
              setBusy('group');
              try {
                const res = await fetch('/api/groups', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    name: groupName,
                    fromEventId: eventId,
                    findable,
                  }),
                });
                if (!res.ok) throw new Error('Could not make the group.');
                const created = (await res.json()) as { id: string };
                window.location.href = `/group/${created.id}`;
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setBusy(null);
              }
            }}
          >
            {busy === 'group' ? 'Making it…' : 'Make a group'}
          </button>
        </section>
      )}

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

/**
 * The photo a takedown request is about — or the fact that it would not load.
 *
 * The most important thumbnail in the product to not draw a broken glyph for.
 * The host is about to decide whether to remove someone's photo, and a glyph
 * is ambiguous in the one way that matters here: it looks like the photo is
 * already gone, which is an argument for one of the two buttons. Saying it
 * plainly leaves the host knowing they are deciding blind.
 */
function PendingThumb({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);

  if (failed) return <span className="tile-empty">Not available</span>;

  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt="" onError={onError} />;
}

/** "in about 3 hours" / "shortly", without pulling in a date library. */
function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'shortly';
  const hours = Math.round(ms / 3600_000);
  if (hours < 1) return 'within the hour';
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}
