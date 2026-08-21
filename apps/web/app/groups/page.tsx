/**
 * Groups — the rooms you are in, and the ones you have not named yet.
 *
 * Groups existed before this page did and had nowhere of their own: you
 * reached one from a chip on Search, from an event that belonged to it, or
 * from a link. That is fine for a thing you visit occasionally and wrong for
 * one the product treats as persistent identity — "the same people keep doing
 * things together" is the whole reason groups exist, and there was no screen
 * answering "which people, and what have they been doing".
 *
 * ## Groups are made here now, and what makes that safe
 *
 * This page used to refuse a create action outright, and the argument was
 * good: a group is noticed afterwards, and a bare `New group` produces a named
 * room with nobody in it — a distribution problem with no photographs in it.
 *
 * What changed is not the argument but what sits beside the button. The page
 * leads with something the product already knew and had never shown: the
 * people this actor keeps ending up in the same events as. Creating is then
 * confirming a set of people who already exist rather than inventing one, and
 * the empty room the old comment warned about cannot be the common case.
 *
 * The clusters are an observation and never a claim — see `recurringClusters`,
 * and `CreateGroupCard` for why pressing the button still writes nothing.
 * Above the list when there are no groups, demoted below it when there are.
 *
 * Not indexable: it lists what one person belongs to.
 */

import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { greetingFor } from '@/greeting';
import {
  GROUP_STRIP,
  lensFor,
  myGroupsDetailed,
  recurringClusters,
  sharedOnceWith,
} from '@/groups';
import { invitesSeenAtFor } from '@/invites';
import { currentActorId } from '@/session';
import { Face } from '@/../app/components/Faces';
import { GroupCover } from '@/../app/components/GroupCover';
import { CreateGroupCard, MakeFromAnyone } from '@/../app/components/CreateGroupCard';

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
  const [groups, account, clusters] = await Promise.all([
    myGroupsDetailed(db, actorId, since),
    // For the greeting only, as on Home, Activity and Find.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
    recurringClusters(db, actorId),
  ]);
  /*
   * The add row's suggestions, fetched once for the page rather than once per
   * card. Anybody already in a cluster is excluded here, so the "add somebody
   * who was not at those events" row never offers a person who is standing in
   * the chips above it.
   */
  const also = await sharedOnceWith(db, actorId, clusters.flatMap((c) => c.personIds));
  const now = new Date();
  const greeting = greetingFor(account?.displayName ?? null, now);

  return (
    <Shell current="groups">
      <main className="groups-page">
        <div className="groups-head">
          {greeting && <div className="home-greeting">{greeting}</div>}
          <h1 className="home-title">Groups</h1>
          {/*
            Outlined, not filled, and only once there is a list. On a page with
            rooms in it the primary action is entering one; the filled button
            belongs to the first cluster card, on the page that has no rooms.
          */}
          {groups.length > 0 && <MakeFromAnyone also={also} compact />}
        </div>

        {groups.length === 0 ? (
          clusters.length > 0 ? (
            /*
              What the product noticed, offered as something to confirm.

              Two sentences and nothing else — no illustration, no badge, no
              empty-state graphic. The heading is an observation about the
              past; the body is the one thing a group does that nothing else
              here does.
            */
            <div className="clusters">
              <div className="clusters-lead">
                <h2>The same people keep turning up.</h2>
                <p>
                  You have shared several events with these people. Keep everyone
                  together for next time — the next event includes all of them
                  without a single invite.
                </p>
              </div>

              <div className="cluster-list">
                {clusters.map((cluster, i) => (
                  <CreateGroupCard
                    key={cluster.key}
                    cluster={cluster}
                    people={cluster.people}
                    also={also}
                    primary={i === 0}
                  />
                ))}
              </div>

              <MakeFromAnyone also={also} />
            </div>
          ) : (
            /*
              Nothing to recognise yet, which is still true and still not a
              failure — somebody here has not had the second evening with the
              same people, which is the moment a group is for.

              The copy is unchanged from when this was the only empty state.
              What is added is the link beneath it: now that groups can be made
              here, a page with no clusters must not be a dead end.
            */
            <div className="groups-none">
              <p className="groups-none-lead">You are not in any groups yet.</p>
              <p>
                Groups are for the people who keep turning up — once you have
                shared a couple of events with the same faces, they show up here
                ready to keep together. Nothing to go on yet.
              </p>
              <a href="/events" className="button-like primary">
                Your events
              </a>
              <MakeFromAnyone also={also} />
            </div>
          )
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
          Demoted, once there are rooms to enter.

          Same card one size down, under a label that keeps it an observation
          rather than a prompt: "too" only makes sense as a remark about the
          list above it. Never more than two, and a cluster whose people are
          already gathered in one of these groups is dropped upstream — which
          is what lets this section stay without needing a way to dismiss it.
        */}
        {groups.length > 0 && clusters.length > 0 && (
          <div className="clusters clusters-also">
            <h2 className="clusters-also-head">These people keep turning up too</h2>
            <div className="cluster-list">
              {clusters.map((cluster) => (
                <CreateGroupCard
                  key={cluster.key}
                  cluster={cluster}
                  people={cluster.people}
                  also={also}
                  small
                />
              ))}
            </div>
          </div>
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
