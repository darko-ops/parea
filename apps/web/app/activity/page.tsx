/**
 * Lately — answer, then read.
 *
 * Two halves, in that order of urgency rather than of time, and the change is
 * how much room each gets. The top of the page is what somebody is waiting on
 * you for, as cards you can answer without opening anything. Below it is what
 * has already happened, which is a list to read and not a list to work through.
 *
 * The page is called Lately now. That word was already here — it was the
 * conditional heading over the feed, drawn only when something sat above it —
 * and promoting it means the page opens by saying what it holds rather than by
 * naming the software's category for it. "Activity" stays as the rail's label,
 * where a category is exactly what is wanted.
 *
 * Not indexable: it lists what one person is in and what they have asked for.
 */

import { ActivityList } from '@/../app/components/ActivityList';
import { PendingRequests } from '@/../app/components/PendingRequests';
import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { activityFor } from '@/activity';
import { getDb } from '@/db';
import { greetingFor, partOfDay } from '@/greeting';
import { askedToJoin, invitesSeenAtFor, markInvitesSeen } from '@/invites';
import { pendingRequestsFor } from '@/requests';
import { currentActorId } from '@/session';
import { readerZone } from '@/zone';
import { ago, bucketFor } from '@/when';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Activity',
  robots: { index: false, follow: false },
};

export default async function ActivityPage() {
  const db = getDb();
  const actorId = await currentActorId();
  const [items, asked, requests, seenAt, account] = await Promise.all([
    activityFor(db, actorId),
    askedToJoin(db, actorId),
    pendingRequestsFor(db, actorId),
    /*
     * Read before it is written, three statements below.
     *
     * `markInvitesSeen` moves this boundary as a side effect of the page being
     * rendered, so asking for it afterwards would return the moment of this
     * render and mark every line as already read — the unread state would be
     * correct exactly once, for somebody who never came back.
     */
    invitesSeenAtFor(db, actorId),
    // For the greeting only, as on Home. Null for a browser that has never
    // signed in, which renders the page without one.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
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
  const now = new Date();
  // Never looked means everything is new, not nothing. Comparing against null
  // gives false in JavaScript, which is the wrong answer in the quiet way.
  const since = seenAt ? seenAt.toISOString() : null;
  // The reader's clock, for the greeting — see `zone.ts`. Not the server's,
  // which is UTC and said good afternoon over somebody's breakfast.
  const zone = await readerZone();
  const greeting = greetingFor(account?.displayName ?? null, now, zone);

  return (
    <Shell current="invites" at={partOfDay(now, zone)}>
      <main className="lately">
        {/* The same two lines Home opens with, and the same classes: one
            greeting drawn one way, wherever it appears. */}
        <div className="lately-head">
          {/* The greeting is the heading, and the page's name is the
              fallback for a reader it cannot name. See `HomeView`. */}
          <h1 className="home-title">{greeting ?? 'Lately'}</h1>
        </div>

        {/*
          What is waiting, first and answerable. Draws nothing at all when
          there is nothing — see the note on the component for why that is a
          reversal of what this page used to do.
        */}
        <PendingRequests
          requests={requests.map((request) => ({
            ...request,
            when: ago(request.at, now),
          }))}
        />

        {asked.length > 0 && (
          /*
            Kept, and made lighter. These are not answerable by the person
            reading them — somebody else is deciding — so they are rows rather
            than cards: a bordered box implies something to do with it.
          */
          <section className="asked-section">
            <div className="section-title">
              <h2>You asked to join</h2>
            </div>
            <ul className="asked">
              {asked.map((request) => (
                <li key={request.eventId}>
                  <span className="asked-what">
                    <span className="asked-name">{request.name}</span>
                    <span className="asked-when">Asked {ago(request.askedAt, now)}</span>
                  </span>
                  <span
                    className={`pip ${request.status === 'open' ? 'pip-open' : 'pip-declined'}`}
                  >
                    {request.status === 'open' ? 'Waiting' : 'Not this time'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
          Then the list. Derived from the rows that already exist rather than
          from a notifications table — see `activity.ts` for why, and for what
          that costs.
        */}
        <section className="feed">
          {/*
            The rows are handed down already worded, already dated and already
            bucketed: both the relative time and the day it belongs under are
            decided once, here, against the server's clock. Deciding either in
            the browser would make the first render disagree with the HTML it
            replaced, and React discards the tree when it does.
          */}
          <ActivityList
            items={items.map((item) => ({
              id: item.id,
              who: item.who,
              what: item.what,
              when: ago(item.at, now),
              href: item.href,
              image: item.image,
              images: item.images,
              bucket: bucketFor(item.at, now),
              unread: since === null || item.at > since,
            }))}
          />

          {/*
            The two cases the welcome cannot cover, and they are both real.
 
            It is an `ActivityItem` now, so it needs an actor to be dated by
            and it is gone for good once somebody hides it — a browser that has
            never signed in has no arrival to name, and a reader who dismissed
            it is not owed it back. Either way the list is empty and the page
            would otherwise be a heading over nothing.
          */}
          {items.length === 0 && (
            <p className="activity-empty">
              Nothing yet. When somebody adds photos to an album you are in,
              says something about yours, or opens one to you, it turns up
              here.
            </p>
          )}
        </section>

        <SiteFooter />
      </main>
    </Shell>
  );
}
