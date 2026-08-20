/**
 * Groups — the rooms you are in.
 *
 * Groups existed before this page did and had nowhere of their own: you
 * reached one from a chip on Search, from an album that belonged to it, or
 * from a link. That is fine for a thing you visit occasionally and wrong for
 * one the product treats as persistent identity — "the same people keep doing
 * things together" is the whole reason groups exist, and there was no screen
 * answering "which people, and what have they been doing".
 *
 * ## There is no Create group button, and that is the design
 *
 * A group is made *from an album* — `POST /api/groups` requires a
 * `fromEventId` and refuses without one, and the reason is at the top of that
 * file: noticing that the same people keep turning up is something that
 * happens afterwards. An empty group you then have to fill is a distribution
 * problem with no photographs in it, and the people you would invite have no
 * reason to accept yet.
 *
 * So the empty state says where groups come from rather than offering a button
 * that would have to be disabled or would create something hollow. The action
 * lives on an album you host, which is the only place it can be taken.
 *
 * Not indexable: it lists what one person belongs to.
 */

import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { greetingFor } from '@/greeting';
import { myGroups } from '@/groups';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Groups',
  robots: { index: false, follow: false },
};

/**
 * The lens a group's tile is drawn in.
 *
 * By a stable hash of the id, so a group keeps its colour between visits — a
 * list whose colours reshuffle on every load is decoration rather than a way
 * of telling two rooms apart. The same four-colour palette and the same rule
 * the search page's door cards use.
 *
 * Never a photograph. A group has no cover, and borrowing one from an album
 * inside it would put a picture from a room on a screen that is only the door
 * to it — visible, eventually, to somebody who has been removed.
 */
const LENSES = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

function lensFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return LENSES[hash % LENSES.length]!;
}

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

/** "4 albums · 12 people · added to 2 days ago" — what the room is, in a line. */
function metaFor(
  group: { albumCount: number; memberCount: number; lastActiveAt: string | null },
  now: Date,
): string {
  const parts = [
    `${group.albumCount} ${group.albumCount === 1 ? 'album' : 'albums'}`,
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
  const [groups, account] = await Promise.all([
    myGroups(db, actorId),
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
              A group is made from an album, not from nothing — when the same
              people keep turning up, you roll one of your albums into a group
              and everybody in it stays in the loop for the next one. Open an
              album you made and look for <strong>Make a group</strong>.
            </p>
            <a href="/albums" className="button-like primary">
              Your albums
            </a>
          </div>
        ) : (
          <ul className="groups-list">
            {groups.map((group) => {
              const lens = lensFor(group.id);
              return (
                <li key={group.id}>
                  <a href={`/group/${group.id}`} className="group-row">
                    <span
                      className="group-tile"
                      style={{ background: lens.fill, color: lens.ink }}
                      aria-hidden="true"
                    >
                      {group.name.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <span className="group-what">
                      <span className="group-name">{group.name}</span>
                      <span className="group-meta">{metaFor(group, now)}</span>
                    </span>
                    {/*
                      Admin only. "Member" on every other row is a word that
                      appears so often it stops being read, and the rows it
                      would appear on are the ones where it changes nothing.
                    */}
                    {group.role === 'admin' && <span className="group-role">Admin</span>}
                  </a>
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
