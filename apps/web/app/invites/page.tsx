/**
 * Invites — other people's events, in the two states they can be in.
 *
 * The tabs are links and the page is server-rendered, so which one you are on
 * survives a reload and can be sent to somebody. A pair of buttons swapping
 * client state would look identical and lose both.
 *
 * Not indexable: it lists what one person is in and what they have asked for.
 */

import { EventCard } from '@/../app/components/EventCard';
import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { toCards } from '@/cards';
import { getDb } from '@/db';
import { PendingInvites } from '@/../app/components/PendingInvites';
import { askedToJoin, invitedEvents, markInvitesSeen, pendingInvites } from '@/invites';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Invites',
  robots: { index: false, follow: false },
};

const AGO = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Rough on purpose: nobody needs "3 hours and 12 minutes ago" for this. */
function ago(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 3600
      ? ['minute', 60]
      : Math.abs(seconds) < 86_400
        ? ['hour', 3600]
        : ['day', 86_400];
  return AGO.format(Math.round(seconds / size), unit);
}

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const waiting = tab === 'asked';

  const db = getDb();
  const actorId = await currentActorId();
  const [invited, asked, pending] = await Promise.all([
    invitedEvents(db, actorId),
    askedToJoin(db, actorId),
    pendingInvites(db, actorId),
  ]);

  /*
   * Looking is what clears the badge.
   *
   * A write during a render, which is normally the wrong shape — but "mark as
   * read" is precisely a side effect of having read, and the alternative is a
   * client effect that POSTs on mount, i.e. a second round trip to record that
   * the first one happened. After the reads above, so a request that fails
   * halfway leaves the count intact rather than cleared without being shown.
   */
  await markInvitesSeen(db, actorId);
  const cards = await toCards(invited);
  const now = new Date();

  return (
    <Shell current="invites">
      <main className="main">
        <div className="main-head">
          <h1>Invites</h1>
        </div>

        {/*
          Counted on the tab itself. The number is the only reason to look at
          the other one, and a person who has been let in since they last
          checked should not have to open both to find out.
        */}
        <nav className="tabs" aria-label="Which invites">
          <a href="/invites" aria-current={waiting ? undefined : 'page'}>
            Invited{invited.length > 0 && ` (${invited.length})`}
          </a>
          <a href="/invites?tab=asked" aria-current={waiting ? 'page' : undefined}>
            Asked to join{asked.length > 0 && ` (${asked.length})`}
          </a>
        </nav>

        {/*
          Above the events themselves, because it is the only thing on this
          screen anybody is waiting on. The list below is what has already been
          settled.
        */}
        {!waiting && <PendingInvites invites={pending} />}

        {!waiting &&
          (cards.length === 0 ? (
            pending.length > 0 ? null : (
            <p className="empty muted">
              Nothing yet. An event somebody else made shows up here once you
              open the link they sent you.
            </p>
            )
          ) : (
            <div className="cards">
              {cards.map((event) => (
                /*
                 * Through the link rather than straight to the event.
                 *
                 * A person invited by a friend is a participant, and
                 * participation is deliberately not a credential — that is what
                 * makes rotating a link actually revoke. So they were listed
                 * here and got a 404 on opening. Going via `/e/<token>` hands
                 * them the capability the way it hands it to anybody else, and
                 * from their side it is indistinguishable from being sent the
                 * link, which is what the host did.
                 */
                <EventCard
                  key={event.id}
                  event={{
                    ...event,
                    href: event.linkToken ? `/e/${event.linkToken}` : undefined,
                  }}
                />
              ))}
            </div>
          ))}

        {waiting &&
          (asked.length === 0 ? (
            <p className="empty muted">
              Nothing waiting. Private events are the ones you have to ask
              about — the rest open straight from the link.
            </p>
          ) : (
            <ul className="asked">
              {asked.map((request) => (
                <li key={request.eventId}>
                  <div>
                    {/*
                      Named, not linked. The name is fair to show — they hold
                      the link, which is how they got here — but the event
                      itself answers 404 until the host says yes, and a link
                      that leads to nothing is worse than no link.
                    */}
                    <strong>{request.name}</strong>
                    <p className="muted">
                      {request.status === 'open'
                        ? `Asked ${ago(request.askedAt, now)}. Waiting on whoever made it.`
                        : 'Not opened up to you. The person who made the event is the one to ask.'}
                    </p>
                  </div>
                  <span className={`pip pip-${request.status}`}>
                    {request.status === 'open' ? 'Waiting' : 'No'}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        <SiteFooter />
      </main>
    </Shell>
  );
}
