/**
 * Where a reader stands with an album's set of hosts.
 *
 * One function, because two surfaces answer the question and they must not
 * answer it differently: `/event/[id]` renders the first frame and
 * `/api/events/[id]/photos` replaces it a moment later, so a notice that
 * appears — or worse, disappears — between the two is the page contradicting
 * itself while somebody watches.
 *
 * It is also the third place the contribute policy could have been re-derived,
 * and that is the reason it is here rather than inlined twice. `canAdd` is
 * already the server's decision rather than a client's reading of
 * `contributePolicy`; this is the same discipline applied to the sentence
 * beside it.
 */

import { CONTRIBUTE_HOST, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';

import type { Db } from './db';

export type Hosting = {
  /** Already one of the people who may add. */
  isHost: boolean;
  /**
   * The album is set to `host`, this reader is not one, and they may take
   * part — so asking is a thing that exists here.
   *
   * Deliberately narrow. On `everyone` there is nothing to ask for; on
   * `creator` the whole point of the setting is that there is no set to join,
   * and offering a way to ask would make "Only me" something its owner has to
   * keep defending.
   */
  canAsk: boolean;
  /** What their last ask left standing, or null for never having asked. */
  asked: 'open' | 'approved' | 'declined' | null;
};

/** Nobody is asking about an album they are not signed in to. */
const NOT_ASKING: Hosting = { isHost: false, canAsk: false, asked: null };

export async function hostingFor(
  db: Db,
  event: { id: string; createdBy: string; contributePolicy: string },
  /**
   * The signed-in account's actor, not the device's.
   *
   * A host is a person, and being one has to follow somebody between their
   * phone and their laptop — which is what the account actor is for. The
   * device actor would make the role a property of the browser.
   */
  accountActorId: string | null,
  /** Whether this reader may take part at all — the `contribute` decision. */
  canContribute: boolean,
): Promise<Hosting> {
  if (!accountActorId) return NOT_ASKING;

  const [participant] = await db
    .select({ role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, event.id),
        eq(schema.eventParticipants.actorId, accountActorId),
      ),
    )
    .limit(1);

  const isHost = accountActorId === event.createdBy || participant?.role === 'host';

  /*
   * Their own ask, and only looked up when it could change what is drawn.
   *
   * Somebody who is already a host has nothing to ask for, and the row — if
   * there is one — is the record of how they got here rather than anything the
   * screen should still be reporting.
   */
  const [ask] = isHost
    ? []
    : await db
        .select({ status: schema.eventHostRequests.status })
        .from(schema.eventHostRequests)
        .where(
          and(
            eq(schema.eventHostRequests.eventId, event.id),
            eq(schema.eventHostRequests.actorId, accountActorId),
          ),
        )
        .limit(1);

  return {
    isHost,
    canAsk: !isHost && event.contributePolicy === CONTRIBUTE_HOST && canContribute,
    asked: ask?.status ?? null,
  };
}
