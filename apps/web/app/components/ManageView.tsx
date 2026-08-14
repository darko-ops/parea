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

type Friend = { actorId: string; handle: string | null; displayName: string | null };

type AccessRequest = {
  id: string;
  createdAt: string;
  displayName: string | null;
  handle: string | null;
};

export function ManageView({
  eventId,
  tab,
  initial,
}: {
  eventId: string;
  /** Which half of the screen this is. From the URL, so it survives a reload. */
  tab: 'manage' | 'members';
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
  const [friends, setFriends] = useState<Friend[]>([]);
  const [already, setAlready] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<number | null>(null);
  /** What the search box holds, and what it found. Friends need no search. */
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  /** The host this is being read on, for building a copyable link. */
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  /**
   * Who the list is showing: search results once there is a query, friends
   * before that. One variable rather than a ternary at each of the four places
   * that ask, which is how the empty state and the list come to disagree about
   * which of them should be on screen.
   */
  const searchable = term.trim().length >= 2 ? found : friends;

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

  /**
   * Who you could add, and who is already here.
   *
   * Both, because a picker that offers somebody who is already in the event is
   * offering to do nothing, and the person tapping it has no way to know that
   * until afterwards.
   */
  const loadFriends = useCallback(async () => {
    const [f, a] = await Promise.all([
      fetch('/api/friends').then((r) => (r.ok ? r.json() : { friends: [] })),
      fetch(`/api/events/${eventId}/invites`).then((r) => (r.ok ? r.json() : { already: [] })),
    ]);
    setFriends(f.friends ?? []);
    setAlready(new Set<string>(a.already ?? []));
  }, [eventId]);

  useEffect(() => {
    void loadReports();
    void loadRequests();
    void loadFriends();
  }, [loadReports, loadRequests, loadFriends]);

  /*
   * Anybody, by handle — not only friends.
   *
   * The same endpoint the Friends screen searches: prefix-only, accounts only,
   * and it hides each of two people from the other after a block. Debounced,
   * because this fires per keystroke and what is behind it walks the account
   * table.
   */
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
        setFound(res.ok ? ((await res.json()).people ?? []) : []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  async function invite() {
    setBusy('invite');
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorIds: [...picked] }),
      });
      if (!res.ok) throw new Error('Could not add them.');
      const body = (await res.json()) as { invited: number };
      setInvited(body.invited);
      setPicked(new Set());
      await loadFriends();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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
      {/*
        A back control, not a sentence with a link in it.

        "Back to the photos" was a line of prose under the title — the one way
        out of this screen, set in the same size and colour as a caption. Going
        back is the most likely thing somebody does here, and on a phone the
        top-left corner is where a thumb already goes looking for it.
      */}
      <header className="manage-head">
        <a
          className="back"
          href={`/event/${eventId}`}
          aria-label="Back to the photos"
        >
          <span aria-hidden="true">{'\u2039'}</span>
        </a>
        <h1>{initial.name}</h1>
      </header>

      {/*
        Two tabs, because this was nine panels in one column and the two things
        somebody comes here to do — change how the event works, and deal with
        who is in it — were interleaved. Links rather than state, matching
        Invites: the tab survives a reload and can be sent to somebody.
      */}
      <nav className="tabs" aria-label="What to manage">
        <a
          href={`/event/${eventId}/manage`}
          aria-current={tab === 'manage' ? 'page' : undefined}
        >
          Manage
        </a>
        <a
          href={`/event/${eventId}/manage?tab=members`}
          aria-current={tab === 'members' ? 'page' : undefined}
        >
          Members
          {requests.length > 0 && <span className="badge">{requests.length}</span>}
        </a>
      </nav>

      {tab === 'members' && (
        <section className="panel">
          <h2>Add members</h2>

          {/*
            One list, two sources. Your friends are in it without being asked
            for, because they are who a host usually means; anybody else is a
            search away, because the alternative was telling a host to go and
            befriend somebody before they could put them into an evening they
            had both been at.

            What the search offers is what the server will accept — see
            `invitable`. A result somebody taps and the server then refuses is
            a bug that reads as a permissions message.
          */}
          <label htmlFor="who" className="field-label">
            Search by name or handle
          </label>
          <input
            id="who"
            type="search"
            value={term}
            placeholder="AmberQuietLantern"
            onChange={(e) => setTerm(e.target.value)}
          />

          {searchable.length === 0 ? (
            <p className="panel-note" style={{ margin: '12px 0 0' }}>
              {term.trim().length >= 2
                ? searching
                  ? 'Looking…'
                  : `Nobody here is called “${term.trim()}”.`
                : 'Type a name or a handle. Anybody with an account can be added — it puts them straight in, and they find it under their Invites.'}
            </p>
          ) : (
            <>
              <ul className="people">
                {searchable.map((friend) => {
                  const inIt = already.has(friend.actorId);
                  const on = picked.has(friend.actorId);
                  return (
                    <li key={friend.actorId}>
                      <div>
                        <strong>{friend.displayName || `@${friend.handle}`}</strong>
                        {friend.displayName && friend.handle && (
                          <p className="muted">@{friend.handle}</p>
                        )}
                      </div>
                      {inIt ? (
                        <span className="pip pip-declined">Already here</span>
                      ) : (
                        <button
                          className={on ? undefined : 'secondary'}
                          aria-pressed={on}
                          onClick={() =>
                            setPicked((p) => {
                              const next = new Set(p);
                              if (next.has(friend.actorId)) next.delete(friend.actorId);
                              else next.add(friend.actorId);
                              return next;
                            })
                          }
                        >
                          {/*
                            "Selected", not "Adding": nothing has happened yet.
                            A present participle on a button that has just been
                            pressed reads as work in progress, and somebody who
                            believes the add already went through has no reason
                            to press the button underneath that actually does it.
                          */}
                          {on ? 'Selected' : 'Add'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="row" style={{ marginTop: 14 }}>
                <button onClick={invite} disabled={picked.size === 0 || busy === 'invite'}>
                  {picked.size === 0
                    ? 'Add to this event'
                    : `Add ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
                </button>
                {invited !== null && (
                  <span className="muted">
                    {invited === 0
                      ? 'Nobody was added.'
                      : `Added ${invited}. It is under their Invites now.`}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'members' && initial.accessPolicy === REQUEST_ACCESS && (
        <section className="panel">
          <h2>Requests</h2>
          <p className="panel-note">
            People who found this event and are waiting to be let in.
          </p>
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

      {tab === 'manage' && (
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
      )}

      {tab === 'manage' && (
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
      )}

      {/*
        The second way into an event, and the narrower one. The link works for
        whoever holds it; this works only for people who already agreed to be
        your friend, and it puts them straight in rather than asking them.
      */}

      {tab === 'manage' && (
        <section className="panel">
          <h2>The link</h2>
          {/*
            The absolute URL only once there is a window to ask.

            This was `typeof window === 'undefined' ? link : absolute`, which is
            the first thing React's hydration-mismatch message lists: the server
            rendered the path and the client rendered the whole URL, they
            disagreed, and the page threw its tree away and rebuilt it on every
            visit. Nothing looked wrong — the link was right by the time anybody
            read it. State starts empty, so the server and the first client
            render agree, and the origin arrives a frame later.
          */}
          <code>{origin ? new URL(link, origin).toString() : link}</code>
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
      )}

      {tab === 'manage' && !initial.groupId && (
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

      {tab === 'manage' && (
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
      )}

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
