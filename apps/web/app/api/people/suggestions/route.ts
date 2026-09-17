/**
 * People worth asking to be friends with — design.md §3.
 *
 * Friends of your friends, most mutuals first, minus everybody you are already
 * friends with, have a request open either way with, or have blocked in either
 * direction. All of that is `suggestionsFor`, which the web's Find page has
 * been calling directly since it was a server component.
 *
 * This exists because the app cannot call a server component. It is the same
 * function behind both, rather than a second query that would eventually
 * disagree about who is worth suggesting.
 *
 * Signed in only, and not merely present. A suggestion is derived entirely
 * from a friendship graph, and a guest device has none — so the honest answer
 * for one is an empty list, and the route says so with a status rather than
 * pretending nobody is out there.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { suggestionsFor } from '@/friends';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const suggested = await suggestionsFor(db, actorId);

  return NextResponse.json({
    people: await Promise.all(
      suggested.map(async (person) => ({
        actorId: person.actorId,
        handle: person.handle,
        displayName: person.displayName,
        /*
         * A URL, never the key. The rule the whole boundary follows: a storage
         * key is a thing you can ask the bucket for, and nothing outside this
         * tier is ever handed one.
         */
        avatar: await avatarUrl(person.avatarKey),
        /*
         * How many of your own people already know them, which is the whole
         * reason this is a suggestion rather than a list. "3 mutual friends"
         * is the sentence that makes an unfamiliar handle worth tapping.
         */
        mutuals: person.mutuals,
      })),
    ),
  });
}
