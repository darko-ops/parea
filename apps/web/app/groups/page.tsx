/**
 * Groupchats — the conversations, and the rooms you have not named yet.
 *
 * This was a list of *rooms*, and the rail called it Groups. Both have
 * changed, and the second followed the first: what somebody opens this page
 * for is the talking.
 *
 * It drew a block per group — a name, a stack of faces, a count of albums and
 * people, three covers and a `View all` — with the last thing anybody said as
 * the final line of each. Around two hundred pixels a group, so three of them
 * filled a laptop screen and the conversations were underneath the furniture.
 * The app had the identical page and the identical complaint; its note is the
 * argument, and this is the same answer: one list of conversations, and the
 * rooms are on Find, which is where groups are found.
 *
 * Nothing about a room is lost. Find lists the groups, `/group/<id>` is still
 * albums, chat and people, and every row here lands in the chat one tab away
 * from all of it.
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
 * They stay on this page rather than following the rooms to Find: a cluster is
 * not a group yet, and the reason to make one is that you would talk to these
 * people — which is the page they belong on.
 *
 * Not indexable: it lists what one person belongs to.
 */

import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { greetingFor, partOfDay } from '@/greeting';
import {
  lensFor,
  myGroupsDetailed,
  recurringClusters,
  sharedOnceWith,
} from '@/groups';
import { invitesSeenAtFor } from '@/invites';
import { currentActorId } from '@/session';
import { readerZone } from '@/zone';
import { CreateGroupCard, NewGroupPanel } from '@/../app/components/CreateGroupCard';
import { GroupChats, type ChatRow } from '@/../app/components/GroupChats';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Groupchats',
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

/*
 * No `metaFor` any more — "4 albums · 12 people · added to 2 days ago" was
 * what a *room* is, in a line, and it is one of the things that pushed the
 * conversation to the bottom of each block. The room's own screen says all
 * three, and Find's group cards say the size.
 */

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
  // The reader's clock, for the greeting — see `zone.ts`. Not the server's,
  // which is UTC and said good afternoon over somebody's breakfast.
  const zone = await readerZone();
  const greeting = greetingFor(account?.displayName ?? null, now, zone);

  return (
    <Shell current="groups" at={partOfDay(now, zone)}>
      <main className="groups-page">
        {/*
          The header and the create form, together — see `NewGroupPanel`. The
          button is here in every state, including the empty one: outlined, so
          the filled `Make a group` on the first cluster card is still the
          page's single primary action.
        */}
        <NewGroupPanel greeting={greeting} also={also} />

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
                  You have shared several albums with these people. Keep everyone
                  together for next time — the next album includes all of them
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

            </div>
          ) : (
            /*
              Nothing to recognise yet, which is still true and still not a
              failure — somebody here has not had the second evening with the
              same people, which is the moment a group is for.

              It leads with what is missing rather than with what they have
              not done: "No chats yet" is the page answering its own heading.
              The second paragraph is the question this page invites and could
              not otherwise answer — where the *other* kind of conversation
              went, which is onto the photograph it is about.

              Creation is not offered again here — `New group` is in the
              header above, in every state — but the copy names it, because a
              page whose only visible control sends you somewhere else reads
              as a dead end to the person most likely to be new.
            */
            <div className="groups-none">
              <p className="groups-none-lead">No chats yet.</p>
              <p>
                Every group you are in has one. Comments on a photograph live
                on the album they belong to, and turn up in{' '}
                <a href="/activity">Notifications</a> when somebody answers you.
              </p>
              <p>
                {/*
                  The control is a `+` with no word on it, so the sentence
                  says where it is rather than quoting a label that is not
                  drawn. A line of copy naming a button nobody can see is the
                  page describing a different version of itself.
                */}
                Groups are for the people who keep turning up — once you have
                shared a couple of albums with the same faces, they show up here
                ready to keep together. Nothing to go on yet, so the{' '}
                <strong>+</strong> above is the way to start one.
              </p>
              <a href="/events" className="button-like primary">
                Your albums
              </a>
            </div>
          )
        ) : (
          /*
            The conversations, newest first — see `GroupChats` for why the
            order is the last thing *said* rather than the last album added
            to, and why a silent room is still in the list.

            Sorted here rather than in the browser, so the order is in the HTML
            somebody's reader sees before any script runs.
          */
          <GroupChats
            chats={[...groups]
              .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? ''))
              .map((group): ChatRow => ({
                id: group.id,
                name: group.name,
                lens: lensFor(group.id),
                last: group.lastMessage && {
                  author: group.lastMessage.author,
                  body: group.lastMessage.body,
                  mine: group.lastMessage.mine,
                  // Worded here, like every relative time in this product: the
                  // two clocks disagree and React answers a text mismatch by
                  // throwing the tree away.
                  when: ago(group.lastMessage.at, now),
                  // The author's colour, from the same hash the tiles use.
                  // `lensFor` cannot cross into the browser — `groups.ts`
                  // opens the database on the way past — so it is resolved
                  // here and the row is handed two colours, not a palette.
                  lens: lensFor(group.lastMessage.author),
                },
                unread: group.unreadCount,
              }))}
          />
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
