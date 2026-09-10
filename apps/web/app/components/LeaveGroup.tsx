'use client';

/**
 * Leaving a group, from the list of them.
 *
 * It was already possible and only from inside: `/group/<id>`, under the
 * `···`. Which is the one screen somebody is not on when they think of it —
 * the thought arrives while looking at the list of rooms, and the answer was
 * "open the room you want to be out of, then find a menu".
 *
 * The DELETE is the same one the group page sends, and there is deliberately
 * no second endpoint: leaving is a row being deleted and needs no permission,
 * because membership that cannot be given up is not membership.
 *
 * ## The two-step
 *
 * The group page's item leaves on one click, which is defensible there — you
 * are inside the thing, and it took two clicks to open the menu. In a list of
 * six rooms the same item sits under six identical `···`, and a mis-tap is a
 * different kind of accident: the wrong group. So the first press swaps the
 * label rather than doing anything, and the panel says what leaving costs
 * while it waits.
 *
 * Nothing is optimistic. The row stays until the server has answered and the
 * page is rebuilt from it — a row that vanished on a failed request would be
 * a group somebody believes they have left.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Menu } from './Menu';

export function LeaveGroup({ groupId, name }: { groupId: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Menu label={`More about ${name}`} glyph="···" tone="quiet" className="group-row-menu">
      {(close) => (
        <>
          <p className="menu-note">
            Photos live in the events, not in the group. Leaving stops the next
            one reaching you — it takes nothing away from the events you were
            in.
          </p>
          <button
            className="menu-danger"
            disabled={busy}
            onClick={async () => {
              if (!sure) {
                setSure(true);
                return;
              }
              setBusy(true);
              setError(null);
              try {
                const res = await fetch(`/api/groups/${groupId}/members`, {
                  method: 'DELETE',
                });
                if (!res.ok) throw new Error('Could not leave just now.');
                close();
                setSure(false);
                // The list is server-rendered, so this is what removes the row
                // — and it removes it because the server no longer lists it,
                // which is the only account of membership worth drawing.
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {sure ? `Yes, leave ${name}` : 'Leave this group'}
          </button>
          {error && <p className="menu-note">{error}</p>}
        </>
      )}
    </Menu>
  );
}
