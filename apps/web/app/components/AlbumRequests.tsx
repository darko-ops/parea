'use client';

/**
 * Who is waiting on the host of an album, on the pane about people.
 *
 * Two queues, and they were in two different places that were both somewhere
 * else. Asking to be let into a private album was answerable on `/manage` and
 * nowhere else — a screen reached by opening the `⋯` and choosing `Manage
 * album`, which a host has no other reason to do. Asking to be allowed to
 * *add* photographs was answerable only in Notifications, on the list of
 * everything else waiting. So a host looking at the album could see the person
 * in neither case, and `requests.ts` has claimed in a comment for months that
 * both are "answerable from the album's People tab", which was a description
 * of the intention rather than of the code.
 *
 * Both are here now, which makes that true and gives the pane the same shape a
 * group's People tab has: who is waiting, then who is already in.
 *
 * ## Why they stay two lists
 *
 * The route that serves them says it best and it is worth repeating where the
 * two are drawn together: they are asked by different people and answered with
 * different information. The access queue is strangers at the door of a
 * private album and the question is "do I know this person". The host queue is
 * people already inside, whom the reader can see in the roster below, asking
 * for a little more. One heading each, because a host reading a list wants one
 * kind of question in it.
 *
 * ## Fetched here rather than handed down
 *
 * The page computes the *count* — it is on the People tab whether or not
 * anybody has opened it — and this fetches the rows. Two reasons. A queue that
 * arrives with the page is a queue that is stale by the time somebody presses
 * anything, and a host answering three requests reloads nothing. And the
 * albums a reader cannot administer never call this at all: the component is
 * not rendered, so there is no request to refuse.
 */

import { useCallback, useEffect, useState } from 'react';

type Waiting = {
  id: string;
  /** What they have to be called by. A handle is issued at sign-in, so a
      display name is the one that can be missing. */
  displayName: string | null;
  handle: string | null;
};

type Queue = 'access-requests' | 'host-requests';

export function AlbumRequests({
  eventId,
  /** Called after an approval, which changes the roster under this. */
  onApproved,
}: {
  eventId: string;
  onApproved: () => void;
}) {
  const [access, setAccess] = useState<Waiting[]>([]);
  const [hosts, setHosts] = useState<Waiting[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async (queue: Queue) => {
      const res = await fetch(`/api/events/${eventId}/${queue}`);
      if (!res.ok) return [];
      return ((await res.json()) as { requests: Waiting[] }).requests;
    };
    void Promise.all([load('access-requests'), load('host-requests')]).then(
      ([asked, wanting]) => {
        // The tab can be left before either lands, and setting state on a
        // component nobody is looking at is how a stale queue gets drawn over
        // a fresh one when it comes back.
        if (!live) return;
        setAccess(asked);
        setHosts(wanting);
      },
    );
    return () => {
      live = false;
    };
  }, [eventId]);

  /**
   * Answering one.
   *
   * The row goes after the server has said so, never before: an optimistic
   * removal takes somebody off the screen and leaves them waiting when the
   * call failed, which is the one outcome a host would never find out about.
   *
   * `onApproved` only on approve. Approving writes a participation or a role,
   * so the roster under this is now wrong; declining changes nothing anybody
   * can see except this row.
   */
  const answer = useCallback(
    async (queue: Queue, requestId: string, action: 'approve' | 'decline') => {
      setBusy(requestId);
      setError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/${queue}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId, action }),
        });
        if (!res.ok) throw new Error('Could not answer that. Try again.');
        const drop = (rows: Waiting[]) => rows.filter((row) => row.id !== requestId);
        if (queue === 'access-requests') setAccess(drop);
        else setHosts(drop);
        if (action === 'approve') onApproved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [eventId, onApproved],
  );

  if (access.length === 0 && hosts.length === 0) return null;

  /*
   * One list, drawn twice with different words.
   *
   * `note` is what approving actually does, and it is per queue rather than
   * per row: the consequence is the same for every name under one heading, and
   * saying it three times is the screen repeating itself. Said plainly in both
   * cases — "approving lets them in" is not the same claim as "they can look",
   * and in this product being in an album means being able to add to it.
   */
  const list = (
    queue: Queue,
    rows: Waiting[],
    head: string,
    note: string,
    yes: string,
  ) =>
    rows.length > 0 && (
      <section className="join-queue" aria-label={head}>
        <h2 className="join-queue-head">{head}</h2>
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <span className="join-who">
                {row.displayName ?? 'Someone'}
                {/* The handle, where the display name is not the whole of who
                    they are. A host who was there recognises the name; the
                    handle is what makes two Toms two people. */}
                {row.handle && <span className="join-handle">@{row.handle}</span>}
              </span>
              <button
                type="button"
                className="join-yes"
                disabled={busy === row.id}
                onClick={() => answer(queue, row.id, 'approve')}
              >
                {yes}
              </button>
              <button
                type="button"
                className="join-no"
                disabled={busy === row.id}
                onClick={() => answer(queue, row.id, 'decline')}
              >
                Decline
              </button>
            </li>
          ))}
        </ul>
        <p className="join-queue-note">{note}</p>
      </section>
    );

  return (
    <>
      {error && <p className="group-error">{error}</p>}
      {list(
        'access-requests',
        access,
        `${access.length} waiting to be let in`,
        'Approving lets them see the photographs and add their own. Declining tells them nothing — they can ask again.',
        'Let them in',
      )}
      {list(
        'host-requests',
        hosts,
        `${hosts.length} asking to add photographs`,
        'They are already in this album. Approving lets them add to it, which on an album set to hosts only is what they are asking for.',
        'Allow',
      )}
    </>
  );
}
