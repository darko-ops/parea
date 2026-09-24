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
 * ## Nothing on it but the conversations
 *
 * The list arrived first and the furniture stayed: under it sat the cluster
 * cards — "these people keep turning up too", each a stack of faces and a
 * `Make a group` — and under those a line about finding groups you are not in.
 * So a page whose heading says Groupchats went on being two thirds a groups
 * directory, and the conversations were the part you scrolled past.
 *
 * Both have gone to Find, which is where groups are found and, in the app,
 * where they are made. What is left is what the heading says: the rooms you
 * can talk in, and the way into one.
 *
 * Not indexable: it lists what one person belongs to.
 */

import { Shell } from '@/../app/components/Shell';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { greetingFor, partOfDay } from '@/greeting';
import { lensFor, myGroupsDetailed } from '@/groups';
import { invitesSeenAtFor } from '@/invites';
import { currentActorId } from '@/session';
import { readerZone } from '@/zone';
import { NewGroupPanel } from '@/../app/components/CreateGroupCard';
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
  const [groups, account] = await Promise.all([
    myGroupsDetailed(db, actorId, since),
    // For the greeting only, as on Home, Activity and Find.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
  ]);
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
        <NewGroupPanel greeting={greeting} />

        {groups.length === 0 ? (
          /*
            Not a failure and not an empty product: somebody here has not been
            in a group yet, which is a thing that happens after a couple of
            evenings with the same people rather than a thing to go and do.

            It leads with what is missing — the page answering its own heading
            — then answers the question this page invites and could not
            otherwise: where the *other* kind of conversation went, which is
            onto the photograph it is about.

            Two doors, and they are different doors. The `+` above makes a room
            outright; Find is where the product offers to make one out of
            people it has noticed you keep ending up with, which is the version
            that does not produce an empty room.
          */
          <div className="groups-none">
            <p className="groups-none-lead">No chats yet.</p>
            <p>
              Every group you are in has one. Comments on a photograph live on
              the album they belong to, and turn up in{' '}
              <a href="/activity">Notifications</a> when somebody answers you.
            </p>
            <p>
              The <strong>+</strong> above starts a group.{' '}
              <a href="/find">Search</a> offers to make one out of the people
              you keep sharing albums with, which is the version with somebody
              already in it.
            </p>
            <a href="/events" className="button-like primary">
              Your albums
            </a>
          </div>
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

        <SiteFooter />
      </main>
    </Shell>
  );
}
