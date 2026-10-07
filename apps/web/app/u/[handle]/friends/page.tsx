/**
 * Somebody's friends — the page behind the count on their profile, the way
 * `/friends` is behind yours.
 *
 * For anybody signed in. Who is left out, and why, is in `friendsSeenBy`; who
 * may see the profile at all is `profileFor`'s, and a 404 here says no more
 * than the profile's own would.
 */

import { notFound, redirect } from 'next/navigation';

import { Face } from '@/../app/components/Faces';
import { Shell } from '@/../app/components/Shell';
import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { friendsSeenBy } from '@/friends';
import { profileFor } from '@/people';
import { currentAccountActorId } from '@/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return {
    title: `@${decodeURIComponent(handle)} · Friends`,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function PersonFriendsPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const db = getDb();
  const actorId = await currentAccountActorId();

  if (!actorId || !(await isSignedIn(db, actorId))) notFound();

  const person = await profileFor(db, actorId, decodeURIComponent(handle));
  if (!person) notFound();
  // Your own is the friends screen, with the requests on it.
  if (person.standing === 'self') redirect('/friends');

  const friends = await Promise.all(
    (await friendsSeenBy(db, actorId, person.actorId)).map(async (friend) => ({
      ...friend,
      avatar: await avatarUrl(friend.avatarKey),
    })),
  );
  const theirName = person.displayName || `@${person.handle}`;
  const profile = `/u/${encodeURIComponent(person.handle ?? handle)}`;

  return (
    <Shell>
      <main className="main">
        <header className="manage-head">
          <a className="back" href={profile} aria-label={`Back to ${theirName}`}>
            <span aria-hidden="true">{'‹'}</span>
          </a>
          <h1>{theirName}&rsquo;s friends</h1>
        </header>

        {friends.length === 0 ? (
          <p className="muted">No friends to show yet.</p>
        ) : (
          <ul className="people">
            {friends.map((friend) => {
              const label =
                friend.displayName || (friend.handle ? `@${friend.handle}` : 'Someone');
              return (
                <li key={friend.actorId}>
                  <Face
                    src={friend.avatar}
                    size={34}
                    className="member-face"
                    fallback={<span aria-hidden="true">{label.replace('@', '').slice(0, 1).toUpperCase()}</span>}
                  />
                  <div>
                    {friend.handle ? (
                      <a href={`/u/${encodeURIComponent(friend.handle)}`} className="named">
                        <strong>{label}</strong>
                      </a>
                    ) : (
                      <strong>{label}</strong>
                    )}
                    {friend.displayName && friend.handle && (
                      <p className="muted">@{friend.handle}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </Shell>
  );
}
