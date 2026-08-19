/**
 * Search — one box over the things this person can already reach, plus the two
 * namespaces the product allows to be looked up.
 *
 * §3's rule is that **groups can be findable and photos never are**, and this
 * page is where that rule is most visible. What is matched here:
 *
 *   - your own albums, filtered in the browser over a list the server already
 *     decided you may see. Nothing is discovered;
 *   - your own friends, the same;
 *   - anybody by handle, prefix-only, which is what makes a person findable
 *     enough to be asked and no further;
 *   - findable groups, which return a door and never what is inside.
 *
 * With nothing typed it offers the two things that may be offered: friends of
 * your friends, who are the weakest suggestion available — somebody you could
 * already reach by asking the friend you have in common — and findable groups
 * those friends are in, which are a door to knock on rather than a way in.
 *
 * **Your albums used to be the third of those and are not any more.** They were
 * a worse copy of the home screen one tap away, and, more to the point, a list
 * of albums under a heading on a search page is one ticket away from a list of
 * *other people's*. There is no album search beyond your own and no photo
 * search at all. Adding either would turn "possession of the link is the access
 * model" into "type a word and see whose wedding comes up".
 */

import { Shell } from '@/../app/components/Shell';
import { FindView } from '@/../app/components/FindView';
import { accountFor, avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { friendsOf, suggestionsFor } from '@/friends';
import { greetingFor } from '@/greeting';
import { groupsFor, suggestedGroupsFor } from '@/groups';
import { leadImage } from '@/cards';
import { searchable } from '@/search';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Search',
  robots: { index: false, follow: false },
};

export default async function FindPage() {
  const db = getDb();
  const actorId = await currentActorId();
  const [listings, friends, suggested, groups, offered, account] = await Promise.all([
    eventsFor(db, actorId),
    friendsOf(db, actorId),
    suggestionsFor(db, actorId),
    // The groups this person is already in. Not a search — the page names
    // Groups as one of the three things it finds, and a heading that only ever
    // fills up after you type is a heading that has to be discovered.
    groupsFor(db, actorId),
    // Findable groups a friend is already in. The only thing on this page that
    // is *recommended* rather than listed back, and it is a door — see
    // `suggestedGroupsFor` for why a group may be one and an album may not.
    suggestedGroupsFor(db, actorId),
    // For the greeting only, as on Home.
    actorId ? accountFor(db, actorId) : Promise.resolve(null),
  ]);

  /*
   * The albums, with the string they are matched against built here.
   *
   * Server-side for the same reason the home screen builds its haystack there:
   * the text a query is matched against and the text on the row have to be
   * derived once, or they come to disagree about whether the place counts.
   */
  const albums = await Promise.all(
    listings.map(async (listing) => ({
      id: listing.id,
      name: listing.name,
      place: listing.place,
      caption: listing.caption,
      // The cover if the album has one, else its newest photograph — the same
      // question the cards ask, asked through the same function so that an
      // album does not lead with one picture here and another there.
      thumb: await leadImage(listing),
      haystack: searchable(listing),
    })),
  );

  /*
   * The mutual friends' pictures, presigned here.
   *
   * Same boundary rule as everywhere else: the object key stays on the server
   * and what crosses is a URL that expires. `Face` handles the expiry, which
   * on this page matters — a tab left open overnight would otherwise show
   * broken-image glyphs beside "Priya and Dee are in this".
   */
  const suggestedGroups = await Promise.all(
    offered.map(async (group) => ({
      id: group.id,
      name: group.name,
      memberCount: group.memberCount,
      mutualCount: group.mutualCount,
      asked: group.asked,
      mutuals: await Promise.all(
        group.mutuals.map(async (person) => ({
          id: person.id,
          name: person.name,
          handle: person.handle,
          avatar: await avatarUrl(person.avatarKey),
        })),
      ),
    })),
  );

  return (
    <Shell current="find">
      {/*
        Its own surface rather than `.main`'s white. The page is a column of
        cards now — groups, people, your own groups — and cards on white are
        outlines drawn on nothing; the warm ground is what makes them objects,
        the same way it does on an album.
      */}
      <main className="main main-find">
        <div className="find-page">
          <FindView
            greeting={greetingFor(account?.displayName ?? null, new Date())}
            albums={albums}
            friends={friends}
            suggested={suggested}
            suggestedGroups={suggestedGroups}
            groups={groups.map((g) => ({ id: g.id, name: g.name, role: g.role }))}
          />
        </div>
      </main>
    </Shell>
  );
}
