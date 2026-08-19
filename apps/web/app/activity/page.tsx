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
import { greetingFor } from '@/greeting';
import { askedToJoin, invitesSeenAtFor, markInvitesSeen } from '@/invites';
import { pendingRequestsFor } from '@/requests';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Activity',
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

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long' });

/**
 * Which day-heading a line belongs under.
 *
 * Computed here, in the same pass that rounds the relative time, and for the
 * same reason: a boundary worked out in the browser can disagree with the one
 * the HTML was rendered against — a page loaded at 23:59 and hydrated at 00:00
 * would find its "Today" heading has become "Yesterday" and throw the tree
 * away. One clock decides, and it is this one.
 *
 * Calendar days rather than 24-hour windows. "Yesterday" means the day before
 * this one, not "between 24 and 48 hours ago" — something at 9am today and
 * something at 11pm last night are fourteen hours apart and belong under
 * different words, which is the whole point of the headings.
 *
 * The tail is deliberately coarse. Month names for the rest of this year, then
 * one "Earlier" for everything before it: a feed bounded at fifty lines rarely
 * reaches back that far, and a heading per month for four years of history is
 * structure describing an archive this page is not.
 */
function bucketFor(iso: string, now: Date): string {
  const at = new Date(iso);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (midnight(now).getTime() - midnight(at).getTime()) / 86_400_000,
  );

  // Negative is a clock somewhere being ahead — a photograph uploaded with a
  // future timestamp, or the two machines disagreeing by a minute across
  // midnight. It is still the newest thing on the page, so it goes at the top
  // under the heading everything else at the top has.
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (at.getFullYear() === now.getFullYear()) return MONTH.format(at);
  return 'Earlier';
}

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
  const greeting = greetingFor(account?.displayName ?? null, now);

  return (
    <Shell current="invites">
      <main className="lately">
        {/* The same two lines Home opens with, and the same classes: one
            greeting drawn one way, wherever it appears. */}
        <div className="lately-head">
          {greeting && <div className="home-greeting">{greeting}</div>}
          <h1 className="home-title">Lately</h1>
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
        </section>

        <SiteFooter />
      </main>
    </Shell>
  );
}
