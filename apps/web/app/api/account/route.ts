/**
 * Deleting an account — App Store Guideline 5.1.1(v), and design §3.
 *
 * Not optional: an app that lets someone create an account has to let them
 * delete it from inside the app. Two separate things are offered, because
 * conflating them takes away other people's copies of an evening they were
 * also at:
 *
 *   DELETE                 the account — the address, and the link between it
 *                          and this person's devices. Their uploads stay, and
 *                          they stay theirs: the actor reverts to a guest and
 *                          can still remove any photo one at a time.
 *   DELETE ?photos=1       the above, and tombstones everything they uploaded.
 *
 * The UI puts both in front of someone rather than choosing for them.
 */

import { handleKey, handleProblem, schema } from '@parea/core';
import { and, eq, ne, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { deleteAccount, deleteEverything } from '@/accounts';
import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/**
 * Set the name shown beside your photos.
 *
 * The native client does this through `/api/session`, which answers 404 to a
 * browser on purpose — that route hands back a bearer token, and a browser
 * carrying both a token and a cookie for the same actor is two credentials to
 * reason about. So the web needs its own way in, and this is it: same column,
 * no token, cookie only.
 *
 * Blank is a real answer and clears the name. The field is optional and always
 * has been; a rename that cannot be undone is not a rename.
 */
export async function PATCH(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    displayName?: unknown;
    bio?: unknown;
    handle?: unknown;
  };

  const db = getDb();
  const patch: {
    displayName?: string | null;
    bio?: string | null;
    handle?: string | null;
  } = {};

  if (typeof body.displayName === 'string') {
    patch.displayName = body.displayName.trim().slice(0, 80) || null;
  }

  // Bounded short, and empty means none rather than an empty line under a name.
  if (typeof body.bio === 'string') {
    patch.bio = body.bio.trim().slice(0, 200) || null;
  }

  if (typeof body.handle === 'string') {
    // Stored as written, compared folded — see the note in `handles.ts`. Only
    // the surrounding whitespace goes, because that is a typing accident
    // rather than a decision about capitals.
    const handle = body.handle.trim();
    if (handle === '') {
      // Clearing it is allowed. A handle is not something anyone is required
      // to have, and one you cannot give up is a name you are stuck with.
      patch.handle = null;
    } else {
      const problem = handleProblem(handle);
      if (problem) {
        return NextResponse.json({ error: 'invalid_handle', message: problem }, { status: 400 });
      }
      // Checked here for a readable answer, and still enforced by a unique
      // index underneath: two people claiming the same handle in the same
      // second both pass this and one loses at the write, which is the only
      // place that can actually be decided.
      //
      // Compared through `lower()` on both sides so it asks the question the
      // index will ask. An `=` against the column would report `SamJones` free
      // while `samjones` exists, and the 409 would arrive from the catch below
      // with no idea why.
      const [taken] = await db
        .select({ id: schema.actors.id })
        .from(schema.actors)
        .where(
          and(
            sql`lower(${schema.actors.handle}) = ${handleKey(handle)}`,
            ne(schema.actors.id, actorId),
          ),
        )
        .limit(1);
      if (taken) {
        return NextResponse.json(
          { error: 'handle_taken', message: 'That handle is already someone else’s.' },
          { status: 409 },
        );
      }
      patch.handle = handle;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_change' }, { status: 400 });
  }

  try {
    await db.update(schema.actors).set(patch).where(eq(schema.actors.id, actorId));
  } catch {
    // The unique index, arriving after the check above lost a race.
    return NextResponse.json(
      { error: 'handle_taken', message: 'That handle is already someone else’s.' },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const alsoPhotos = new URL(request.url).searchParams.get('photos') === '1';

  // Photos first: doing it after the account is gone would leave a window in
  // which a crash loses the request entirely, and the person believes their
  // photos went with their account.
  const photos = alsoPhotos ? await deleteEverything(db, actorId) : 0;
  const deleted = await deleteAccount(db, actorId);

  return NextResponse.json({ deleted, photos });
}
