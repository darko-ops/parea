'use client';

/**
 * The things waiting on an answer from you, answerable where they are.
 *
 * This was a bubble: one accent-tinted pill reading "3 invites" that opened a
 * list. Two things were wrong with it and they pull in opposite directions.
 *
 * When the number was zero the pill was still there — full width, at the top of
 * the page, announcing an absence. The old reasoning for that is in the git
 * history and it was not silly: a count that only appears when non-zero teaches
 * people to scan for its absence, and absence is also what a broken query looks
 * like. But the price was the loudest object on the page being a statement that
 * nothing is happening, on most loads, forever. If a zero is wanted for
 * reassurance it belongs in the rail's badge, which is already null there.
 *
 * And when the number was *not* zero, the things needing a person were folded
 * away behind a click — so the one part of this page that cannot be read and
 * forgotten was the one part hidden. The collapse is gone. Three cards is not
 * a wall of text, and the alternative is a number that has to be opened before
 * it means anything.
 *
 * Optimistic in one direction, the same rule as everywhere else here: the card
 * goes as soon as the answer is sent, because whichever way it was answered the
 * question is dealt with. A failure puts it back and says so, rather than
 * leaving somebody looking at a list that has quietly not changed.
 *
 * And answering leaves you here. Accepting an invitation to an album used to
 * navigate into it; three invitations meant being carried off after the first
 * and coming back for the rest. The feed below picks the album up on the
 * refresh — "You joined <name>", with a link — so it is one tap away rather
 * than unavoidable.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { PendingRequest, PendingRequestKind } from '@/requests';

import { Face } from './Faces';

/** Where an answer goes, and what the two answers are called there. */
const ANSWERS: Record<
  PendingRequestKind,
  { yes: string; no: string; yesLabel: string; noLabel: string }
> = {
  invite: { yes: 'accept', no: 'decline', yesLabel: 'Accept', noLabel: 'Decline' },
  friend: { yes: 'accept', no: 'decline', yesLabel: 'Accept', noLabel: 'Decline' },
  // Same words as an event's. Being asked into a group is the same shape of
  // question, and giving it its own verb would imply a different answer.
  group_invite: { yes: 'accept', no: 'decline', yesLabel: 'Accept', noLabel: 'Decline' },
  // Not "Accept": this one is a door being opened onto photographs of an
  // evening, and the word for that is not the word for agreeing to something.
  join: { yes: 'approve', no: 'decline', yesLabel: 'Let in', noLabel: 'Not now' },
};

function endpoint(request: PendingRequest): { url: string; body: Record<string, string> } {
  switch (request.kind) {
    case 'invite':
      return { url: `/api/invites/${request.id}`, body: {} };
    case 'friend':
      return { url: '/api/friends', body: { requestId: request.id } };
    case 'join':
      return {
        url: `/api/events/${request.eventId}/access-requests`,
        body: { requestId: request.id },
      };
    case 'group_invite':
      return { url: `/api/group-invites/${request.id}`, body: {} };
  }
}

/**
 * A request, plus how long its asker has been waiting.
 *
 * Worded by the server, like every relative time in this product: rounding it
 * in the browser makes the first render disagree with the HTML it replaced,
 * and React answers that by throwing the tree away.
 *
 * `title` and `detail` are `requests.ts`'s own and are not touched here. The
 * time is added beside them rather than folded into `detail`, because `detail`
 * is also what the rail's badge and the Friends page speak from — a sentence
 * that grows a clause for one screen is a sentence two other screens now carry
 * for no reason.
 */
export type WaitingRequest = PendingRequest & { when: string };

export function PendingRequests({ requests }: { requests: WaitingRequest[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(requests);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = useCallback(
    async (request: WaitingRequest, yes: boolean) => {
      setBusy(request.key);
      setError(null);
      const before = open;
      setOpen((list) => list.filter((r) => r.key !== request.key));
      try {
        const { url, body } = endpoint(request);
        const action = yes ? ANSWERS[request.kind].yes : ANSWERS[request.kind].no;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, action }),
        });
        if (!res.ok) throw new Error('Could not answer that.');
        /*
         * Accepting is not opening.
         *
         * This used to send you straight into the event, on the reasoning that
         * accepting is the one answer that changes what is reachable and the
         * place to rebuild the page is the thing that just opened. That is
         * true and it is still the wrong move: somebody working down a list of
         * three invitations was thrown out of the list by the first one, and
         * had to come back to answer the other two.
         *
         * So the card goes and the page stays. Getting in is not lost — the
         * server wrote the participant row and the capability, which is what
         * puts the album on Home and puts "You joined <name>" in the feed
         * below with a link straight to it.
         */
        if (yes && request.kind === 'invite') router.refresh();
        // The same reasoning for a group: accepting is the only answer that
        // changes what is reachable, and the place to rebuild the page is the
        // room that just opened.
        if (yes && request.kind === 'group_invite' && request.groupId) {
          window.location.href = `/group/${request.groupId}`;
        }
      } catch (err) {
        setOpen(before);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [open, router],
  );

  /*
   * Nothing waiting draws nothing at all — no heading, no bar, no zero.
   *
   * The feed simply starts the page, which is the honest shape for it: on most
   * days there is nothing to answer, and a section that is only there when it
   * has something in it is a section whose presence is itself the news.
   */
  if (open.length === 0) return null;

  return (
    <section className="waiting">
      <div className="section-title">
        <h2>Waiting on you</h2>
        <span className="section-count">{open.length}</span>
      </div>

      {error && <p className="waiting-error">{error}</p>}

      <div className="waiting-list">
        {open.map((request) => (
          <div className="waiting-card" key={request.key}>
            {/*
              `Face` rather than a bare `<img>`, for the reason it exists: an
              avatar is presigned for an hour and an event's photograph is
              signed against its `cap_epoch`, so a tab left open long enough
              holds a card whose picture has expired. The letter is what that
              becomes, rather than the broken-image glyph — on a card whose
              whole job is to be answered.
            */}
            <Face
              src={request.image}
              size={44}
              className="waiting-face"
              fallback={
                <span aria-hidden="true">
                  {request.title.replace(/^@/, '').slice(0, 1).toUpperCase()}
                </span>
              }
            />

            <span className="waiting-what">
              <span className="waiting-title">{request.title}</span>
              <span className="waiting-detail">
                {request.detail} · {request.when}
              </span>
            </span>

            <span className="waiting-answers">
              <button
                type="button"
                className="waiting-yes"
                disabled={busy === request.key}
                onClick={() => answer(request, true)}
              >
                {ANSWERS[request.kind].yesLabel}
              </button>
              <button
                type="button"
                className="waiting-no"
                disabled={busy === request.key}
                onClick={() => answer(request, false)}
              >
                {ANSWERS[request.kind].noLabel}
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
