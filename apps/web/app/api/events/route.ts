/**
 * Create an event — screen 1 of design §3.
 *
 * The creator becomes an actor here, which is the one place identity is minted
 * without an upload: making an event is a contribution of sorts, and the
 * creator needs to be able to administer it afterwards.
 */

import {
  ACCOUNT_REQUIRED,
  LINK_OPEN,
  REQUEST_ACCESS,
  newLinkToken,
  schema,
} from '@parea/core';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { avatarUrl } from '@/accounts';
import { getDb } from '@/db';
import { eventsFor } from '@/events';
import { imageSrc } from '@/images';
import { findGroup, membershipOf } from '@/groups';
import { notifyGroupEvent } from '@/notify';
import { asDateString, parseWindow } from '@/eventwindow';
import { CREATE_EVENT_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId, ensureActor, grantCapability } from '@/session';

export const runtime = 'nodejs';

type Body = {
  groupId?: unknown;
  name?: unknown;
  caption?: unknown;
  place?: unknown;
  eventDate?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  createdByName?: unknown;
  /**
   * 'link_open' (public), 'account_required' (private, sign in to look) or
   * 'request_access' (private, the host lets each person in). Public default.
   */
  accessPolicy?: unknown;
  /**
   * Whether the link admits anybody who holds it. Off means only the people
   * the host adds get in — the same switch as `joinsOpen` on the manage
   * screen, asked at the moment somebody is deciding who this is for.
   */
  linkJoins?: unknown;
  /** Whether to take a spoken phrase from the pool. */
  passPhrase?: unknown;
};

/**
 * The events this actor can reach — backs the app's home and profile tabs, and
 * the web account page.
 *
 * Lives here rather than at its own path because it is a list of the resource
 * this route already creates. It was `GET /api/albums` while the product had a
 * second word for an event; the word is gone, and so is the second path.
 *
 * Answers an empty list rather than 403 for someone with no actor: the app
 * asks on launch, before anyone has contributed anything, and having no events
 * and not existing look the same from here because they should.
 */
export async function GET() {
  const listings = await eventsFor(getDb(), await currentActorId());

  return NextResponse.json({
    events: await Promise.all(
      listings.map(async (listing) => {
        // Signed here rather than shipped raw. Two reasons: the native client
        // cannot sign anything — it has no image secret and must not — and a
        // storage key is an internal address that has no business crossing
        // this boundary at all.
        const mosaic = await Promise.all(
          listing.mosaic.map((photo) =>
            imageSrc(
              {
                eventId: listing.id,
                storageKey: photo.storageKey,
                contentHash: photo.hash ? Buffer.from(photo.hash, 'hex') : null,
              },
              'thumb',
              listing.capEpoch,
            ),
          ),
        );
        /*
         * Avatars leave as URLs, and the keys do not leave at all.
         *
         * Same rule as the photo keys directly above: a storage key is an
         * internal address, and a presigned URL is a short-lived capability
         * the client can actually use. `creator` and `members` are rebuilt
         * rather than spread, so adding a column to either one cannot leak it
         * by default.
         */
        const { creator, members, ...rest } = listing;
        return {
          ...rest,
          mosaic,
          creator: {
            handle: creator.handle,
            avatarUrl: await avatarUrl(creator.avatarKey),
          },
          members: await Promise.all(
            members.map(async (member) => ({
              avatarUrl: await avatarUrl(member.avatarKey),
            })),
          ),
        };
      }),
    ),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  // The auto-selection window (§7.3), validated here because this is the
  // first release in which any client sends one. A window that does not run
  // forwards, or half of one, would be stored happily and then pre-select the
  // wrong photos for every contributor — the asymmetric failure §17 names,
  // and one nothing downstream can detect.
  const window = parseWindow(body.startsAt, body.endsAt);
  if (window === 'invalid') {
    return NextResponse.json({ error: 'invalid_window' }, { status: 400 });
  }

  // Named rather than thrown. Without this the missing variable surfaces as a
  // bare 500 with an empty body, and all a client can say about it is "could
  // not create the event" — which sends someone looking at their form instead
  // of at their configuration. Same shape as the sign-in route's answer when
  // it has no secret.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const db = getDb();

  // Every storage bound in the product is per event, which means an attacker
  // who can mint events without limit has no bound at all. This is the floor
  // under all of them.
  if (!(await withinLimit(db, CREATE_EVENT_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  // Creating requires an account, so this resolves an existing actor rather
  // than minting one: `ensureActor` would hand a signed-out visitor a fresh
  // anonymous identity and the check below would then reject it, which is a
  // row in the actor table for every refused attempt.
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }
  await ensureActor(
    db,
    typeof body.createdByName === 'string' ? body.createdByName.trim() : undefined,
  );

  // Public or private, decided here and nowhere else. Unrecognised values are
  // refused rather than defaulted: `authorize` fails closed on a policy it does
  // not know, so a typo that reached the column would lock the creator out of
  // the event they had just made.
  const requested = body.accessPolicy === undefined ? LINK_OPEN : body.accessPolicy;
  const OFFERED = [LINK_OPEN, ACCOUNT_REQUIRED, REQUEST_ACCESS] as const;
  if (!OFFERED.includes(requested as (typeof OFFERED)[number])) {
    return NextResponse.json({ error: 'invalid_access_policy' }, { status: 400 });
  }
  const accessPolicy = requested as (typeof OFFERED)[number];

  // Creating inside a group is the whole point of having one: its members get
  // access without anyone re-solving "how do I reach everyone" (design §3).
  let groupId: string | null = null;
  if (typeof body.groupId === 'string') {
    if (!(await membershipOf(db, body.groupId, actorId))) {
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }
    groupId = body.groupId;
  }

  const [event] = await db
    .insert(schema.events)
    .values({
      name,
      groupId,
      linkToken: newLinkToken(),
      createdBy: actorId,
      accessPolicy,
      eventDate: asDateString(body.eventDate),
      // Typed by the host, never derived from the photos — there is no
      // location in them to derive from, by design (§7.6).
      // One line under the name, and bounded here as well as in the column —
      // 200 characters is a sentence, which is what this is for.
      caption:
        typeof body.caption === 'string' && body.caption.trim()
          ? body.caption.trim().slice(0, 200)
          : null,
      place:
        typeof body.place === 'string' && body.place.trim()
          ? body.place.trim().slice(0, 80)
          : null,
      // Drives auto-selection later (design §7.3). Captured at creation
      // because inferring it from uploads only helps contributor five, not
      // contributor one — who is often the person with 200 photos.
      startsAt: window?.startsAt ?? null,
      endsAt: window?.endsAt ?? null,
      // Retention lever, populated but not enforced in v1 (design §15). Null
      // for grouped events: a group's archive is the thing that accrues value,
      // and expiring it is what the group is bought to prevent.
      expiresAt: groupId ? null : new Date(Date.now() + 60 * 24 * 3600 * 1000),
      // The link is the product's front door and it is open unless somebody
      // says otherwise. Off is for an album whose members are all being added
      // by name: the link then opens nothing for anyone new, which is the only
      // way to say "not by link" that `authorize` can actually enforce.
      joinsOpen: body.linkJoins === false ? false : true,
    })
    .returning();

  await db
    .insert(schema.eventParticipants)
    .values({ eventId: event!.id, actorId })
    .onConflictDoNothing();

  if (groupId) {
    const group = await findGroup(db, groupId);
    if (group) {
      // Not awaited for its result — a push outage must not fail the create.
      await notifyGroupEvent(db, {
        groupId,
        groupName: group.name,
        eventId: event!.id,
        eventName: event!.name,
        createdBy: actorId,
      });
    }
  }

  /*
   * The phrase is asked for now, rather than always minted.
   *
   * It used to be claimed for every event and shown in a panel beside the
   * form. The panel is gone and the pool is finite — a phrase claimed for an
   * album nobody says it out loud for is a phrase no other album can have —
   * so it is taken only when somebody turns it on.
   */
  const code = body.passPhrase === true ? await claimCode(db, event!.id) : null;
  await grantCapability(event!.id, event!.capEpoch);

  return NextResponse.json(
    {
      id: event!.id,
      name: event!.name,
      linkToken: event!.linkToken,
      url: `/e/${event!.linkToken}`,
      code,
    },
    { status: 201 },
  );
}

/**
 * Take a code from the free pool — design §5.
 *
 * SELECT ... FOR UPDATE SKIP LOCKED so two simultaneous creations take
 * different codes rather than one failing on a unique violation.
 *
 * Returns null when the pool is empty, which is survivable: the link still
 * works and the code is a convenience. Run `deriver jobs seed-codes` to fill
 * it — an empty pool means the spoken-code door never opens.
 */
async function claimCode(
  db: ReturnType<typeof getDb>,
  eventId: string,
): Promise<string | null> {
  const claimed = await db.execute<{ words: string }>(sql`
    update "code" set event_id = ${eventId}, claimed_at = now(), released_at = null
    where id = (
      select id from "code" where event_id is null
      order by random() limit 1 for update skip locked
    )
    returning words
  `);
  return claimed[0]?.words ?? null;
}
