/**
 * Somebody else's page.
 *
 * Reached from a search result, from the friends list, from a suggestion —
 * anywhere a name is drawn. Before this, all of those went to `/friends`,
 * which answers "who do I know" when the question was "who is this".
 *
 * Signed in only, and a 404 for everybody the search box would not have
 * returned. See `people.ts` for what the page may say and why the omissions
 * are the design.
 *
 * Not indexable, and more emphatically than most: it is a page about a named
 * person, which is the last thing in this product that should be in an index.
 */

import { notFound } from 'next/navigation';

import { PersonView } from '@/../app/components/PersonView';
import { Shell } from '@/../app/components/Shell';
import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { ago } from '@parea/cards';
import { getDb } from '@/db';
import { leadImage } from '@/cards';
import { albumsWithBoth, profileFor } from '@/people';
import { currentActorId } from '@/session';

export const dynamic = 'force-dynamic';

/**
 * The handle, from the URL rather than from the database.
 *
 * A title is worth having — an open tab that says "Every photo from everyone
 * who was there" is one nobody can find again — and it is worth *not* paying a
 * second query for, since this runs alongside the page's own load. The handle
 * is what was asked for, so it is what the tab says, whether or not anybody is
 * behind it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return {
    title: `@${decodeURIComponent(handle)}`,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const db = getDb();
  const actorId = await currentActorId();

  /*
   * A guest with a link to one album is not somebody who gets to look people
   * up. The same test `/api/people` applies, so the two doors agree.
   */
  if (!actorId || !(await isSignedIn(db, actorId))) notFound();

  const person = await profileFor(db, actorId, decodeURIComponent(handle));
  if (!person) notFound();

  const shared = await albumsWithBoth(db, actorId, person.actorId);
  const now = new Date();

  return (
    <Shell>
      <main className="main">
        <PersonView
          person={{
            actorId: person.actorId,
            handle: person.handle,
            displayName: person.displayName,
            avatar: await avatarUrl(person.avatarKey),
            standing: person.standing,
            requestId: person.requestId,
          }}
          shared={await Promise.all(
            shared.map(async (listing) => ({
              id: listing.id,
              name: listing.name,
              caption: listing.caption,
              // Rounded here, against the server's clock, for the same reason
              // every other relative time in this product is: rounding it in
              // the browser makes the first render disagree with the HTML it
              // replaced, and React throws the tree away when it does.
              when: ago(new Date(listing.lastActiveAt), now),
              // Cover first, newest photograph otherwise. See `leadImage`.
              thumb: await leadImage(listing),
            })),
          )}
        />
      </main>
    </Shell>
  );
}
