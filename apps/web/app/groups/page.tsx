/**
 * Groups — the rooms you are in.
 *
 * Groups existed before this page did and had nowhere of their own: you
 * reached one from a chip on Search, from an event that belonged to it, or
 * from a link. That is fine for a thing you visit occasionally and wrong for
 * one the product treats as persistent identity — "the same people keep doing
 * things together" is the whole reason groups exist, and there was no screen
 * answering "which people, and what have they been doing".
 *
 * ## There is no Create group button, and that is the design
 *
 * A group is made *from an event* — `POST /api/groups` requires a
 * `fromEventId` and refuses without one, and the reason is at the top of that
 * file: noticing that the same people keep turning up is something that
 * happens afterwards. An empty group you then have to fill is a distribution
 * problem with no photographs in it, and the people you would invite have no
 * reason to accept yet.
 *
 * So the empty state says where groups come from rather than offering a button
 * that would have to be disabled or would create something hollow. The action
 * lives on an event you host, which is the only place it can be taken.
 *
 * Not indexable: it lists what one person belongs to.
 */

import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { greetingFor } from '@/greeting';
import { GROUP_STRIP, lensFor, myGroupsDetailed } from '@/groups';
import { invitesSeenAtFor } from '@/invites';
import { currentActorId } from '@/session';
import { Face } from '@/../app/components/Faces';
import { GroupCover } from '@/../app/components/GroupCover';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Groups',
  robots: { index: false, follow: false },
};

const AGO = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Worded on the server, like every relative time in this product: the two
 * clocks disagree, and React answers a text mismatch by throwing the tree
 * away.
 */
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

/** "4 events · 12 people · added to 2 days ago" — what the room is, in a line. */
function metaFor(
  group: { eventCount: number; memberCount: number; lastActiveAt: string | null },
  now: Date,
): string {
  const parts = [
    `${group.eventCount} ${group.eventCount === 1 ? 'event' : 'events'}`,
    `${group.memberCount} ${group.memberCount === 1 ? 'person' : 'people'}`,
  ];
  // Only when there is something to have been active about. "added to never"
  // is a sentence about an absence the count above already states.
  if (group.lastActiveAt) parts.push(`added to ${ago(group.lastActiveAt, now)}`);
  return parts.join(' · ');
}

export default async function GroupsPage() {
  const db = getDb();
  const actorId = await currentActorId();
  // Read before anything uses it. Null means never looked, which has to mean
  // everything is new rather than nothing.
  const since = (await invitesSeenAtFor(db, actorId)) ?? new Date(0);
  const [groups, account] = await Promise.all([
    myGroupsDetailed(db, actorId, since),
    // For the greeting only, as on Home, Activity and Find.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
  ]);
  const now = new Date();
  const greeting = greetingFor(account?.displayName ?? null, now);

  return (
    <Shell current="groups">
      <main className="groups-page">
        <div className="groups-head">
          {greeting && <div className="home-greeting">{greeting}</div>}
          <h1 className="home-title">Groups</h1>
        </div>

        {groups.length === 0 ? (
          /*
            Where groups come from, rather than a button that cannot work.
            Somebody landing here with none has not failed at anything — they
            have not yet had the second evening with the same people, which is
            the moment a group is for.
          */
          <div className="groups-none">
            <p className="groups-none-lead">
              You are not in any groups yet.
            </p>
            <p>
              A group is made from an event, not from nothing — when the same
              people keep turning up, you roll one of your events into a group
              and everybody in it stays in the loop for the next one. Open an
              event you made and look for <strong>Make a group</strong>.
            </p>
            <a href="/events" className="button-like primary">
              Your events
            </a>
          </div>
        ) : (
          <ul className="groups-list">
            {groups.map((group) => {
              const lens = lensFor(group.id);
              return (
                <li key={group.id}>
                  {/*
                    A row and a `View all` beside it, which is why this is a
                    flex container holding two links rather than one link
                    wrapping everything: an anchor inside an anchor is markup a
                    browser refuses to nest.
                  */}
                  <div className="group-head-row">
                    <a href={`/group/${group.id}`} className="group-row">
                      <span
                        className="group-tile"
                        style={{ background: lens.fill, color: lens.ink }}
                        aria-hidden="true"
                      >
                        {group.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="group-what">
                        <span className="group-line">
                          <span className="group-name">{group.name}</span>
                          {/*
                            Who is in it, beside the name. The count stays in
                            the meta line underneath and is not made redundant
                            by this: the stack shows *who*, the number says
                            *how many*, and three faces cannot say eleven.
                          */}
                          <span className="group-faces">
                            {group.faces.map((person, i) => (
                              <Face
                                key={i}
                                src={person.avatarUrl}
                                size={22}
                                className="group-face"
                                fallback={
                                  <span aria-hidden="true">
                                    {person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
                                  </span>
                                }
                              />
                            ))}
                            {group.moreFaces > 0 && (
                              <span className="group-face group-face-more">
                                +{group.moreFaces}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="group-meta">{metaFor(group, now)}</span>
                      </span>
                      {/*
                        Admin only. "Member" on every other row is a word that
                        appears so often it stops being read, and the rows it
                        would appear on are the ones where it changes nothing.
                      */}
                      {group.role === 'admin' && <span className="group-role">Admin</span>}
                    </a>
                    {/*
                      Only when the strip below is not already all of them. A
                      group with three events or fewer has nothing further to
                      show, and "View all 3" over three covers is a link to
                      what you are looking at.
                    */}
                    {group.eventCount > GROUP_STRIP && (
                      <a href={`/group/${group.id}`} className="group-all">
                        View all {group.eventCount}
                      </a>
                    )}
                  </div>

                  {/*
                    The three most recent events, each linking straight to
                    itself rather than to the group — the point of the strip is
                    one click instead of two.

                    There is no `+N` tile: it would be a fourth cover-shaped
                    object that is not a cover, and `View all` says the same
                    thing in words, in the place people look for a way onward.
                  */}
                  <div
                    className={`group-strip${
                      group.events.length < GROUP_STRIP ? ' group-strip-few' : ''
                    }`}
                  >
                    {group.events.length === 0 ? (
                      <span className="cover-none cover-empty">No events yet</span>
                    ) : (
                      group.events.map((event) => (
                        <a
                          href={`/event/${event.id}`}
                          className="strip-event"
                          key={event.id}
                        >
                          <span className="strip-cover">
                            {event.cover ? (
                              <GroupCover src={event.cover} />
                            ) : (
                              <span className="cover-none" aria-hidden="true" />
                            )}
                            {event.fresh > 0 && (
                              <span className="fresh">
                                <span className="fresh-dot" aria-hidden="true" />
                                {event.fresh} new
                              </span>
                            )}
                          </span>
                          <span className="strip-event-name">{event.name}</span>
                        </a>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/*
          Where the other kind of group is. Discovery belongs on Search and
          stays there — this page is the rooms you are in, and a second list of
          rooms you are not would make it two pages wearing one heading.
        */}
        <div className="groups-foot">
          <p>
            Looking for one you are not in? <a href="/find">Search</a> finds
            groups that have chosen to be findable — you would still be asking
            to be let in.
          </p>
        </div>

        <SiteFooter />
      </main>
    </Shell>
  );
}
