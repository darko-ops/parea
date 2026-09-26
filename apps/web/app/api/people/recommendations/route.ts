/**
 * The Find Friends page, in one request.
 *
 * Three things in one payload because the screen cannot draw any of it without
 * the others: whether a number has been proved decides whether the page is a
 * form or a list, and the switch decides what the line under the number says. A
 * screen that fetched them separately would draw the list, then the form over
 * it, then move the switch — three frames of a page changing its mind.
 *
 * ## What is in the list, and what is deliberately not
 *
 * `recommendationsFor` is the whole of it: mutual friends, shared albums, shared
 * groups. There is no contacts permission in either client and nothing here
 * reads an address book — the argument for that is written out at the function,
 * and the short version is that an uploaded address book is a list of people who
 * never agreed to anything.
 *
 * ## Why the number gates the list
 *
 * A verified number is required before the people are sent. Not because the
 * query needs one — it does not — but because this is the one screen where
 * somebody is handed the benefit of everybody else being findable, and the price
 * of that is being findable themselves. Enforced here rather than only in the
 * client, for the reason every gate is: a client is a suggestion.
 *
 * The empty answer is not an error. A person with no number gets `people: []`
 * and enough state to know why, which is what lets one screen say "add your
 * number" and "nobody new right now" without two round trips to find out which.
 */

import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { accountFor, avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { recommendationsFor } from '@/friends';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const account = await accountFor(db, actorId);
  const verified = account?.phoneVerified === true;

  /*
   * Asked only when it can be answered.
   *
   * Skipping the query for somebody with no number is the gate, and it is also
   * the cheaper order: the statement is three aggregates over their whole
   * history of albums and groups, and running it to throw the answer away would
   * be the most expensive read on the page doing nothing.
   */
  const people = verified ? await recommendationsFor(db, actorId) : [];

  return NextResponse.json({
    phone: {
      /** "47", or null. Never the number — there is no number to send. */
      last2: account?.phoneLast2 ?? null,
      verified,
    },
    /** The switch, so the page can say what adding a number already did. */
    discoverable: account?.discoverable ?? false,
    people: await Promise.all(
      people.map(async (person) => ({
        actorId: person.actorId,
        handle: person.handle,
        displayName: person.displayName,
        // A URL, never the key — the boundary every picture in this product
        // crosses. Presigned for an hour, so it expires on its own.
        avatar: await avatarUrl(person.avatarKey),
        /*
         * The three reasons, kept apart rather than summed.
         *
         * The row has to be able to say *why* it is there, and "2 mutual
         * friends" and "3 albums together" are different sentences carrying
         * different weight. One score would leave the screen saying "suggested"
         * and nothing a reader could check.
         */
        mutuals: person.mutuals,
        albums: person.albums,
        groups: person.groups,
      })),
    ),
  });
}
