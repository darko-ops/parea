/**
 * The access layer against a real database.
 *
 * @parea/core's policy tests cover the decision logic exhaustively with facts
 * handed in. This covers the other half — that the facts resolved from
 * Postgres are the right ones — which is where an authorization bug would
 * actually live: correct rules, wrong inputs.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AccessError,
  decide,
  findEventByLinkToken,
  guard,
  recordParticipant,
  toResponse,
} from '@/access';
import { sign, unsign, encodeCapability, decodeCapability } from '@/auth/cookies';
import type { Db } from '@/db';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "code", "derivative", "device", "event",
      "event_participant", "group_member", "groups", "photo", "report"
    restart identity cascade
  `);
});

async function makeActor() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return actor!.id;
}

/**
 * An actor that has claimed an account, which is what `contribute` and every
 * code now require. Signing in is the only thing that sets `accountId`, so the
 * fixture sets it directly rather than driving the whole code exchange.
 */
async function makeSignedInActor(email = `${crypto.randomUUID()}@example.test`) {
  const [account] = await db.insert(schema.accounts).values({ email }).returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', accountId: account!.id })
    .returning();
  return actor!.id;
}

async function makeEvent(overrides: Partial<typeof schema.events.$inferInsert> = {}) {
  const createdBy = overrides.createdBy ?? (await makeActor());
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy, ...overrides })
    .returning();
  return event!;
}

describe('resolving credentials from the database', () => {
  it('admits a stranger holding the link', async () => {
    const event = await makeEvent();
    const decision = await decide(db, event, 'view', {
      actorId: null,
      linkToken: event.linkToken,
    });
    expect(decision).toEqual({ allow: true });
  });

  it('refuses the same stranger without it', async () => {
    const event = await makeEvent();
    const decision = await decide(db, event, 'view', { actorId: null });
    expect(decision).toEqual({ allow: false, reason: 'no_credential' });
  });

  it('finds an event by link token and not by a near miss', async () => {
    const event = await makeEvent();
    expect(await findEventByLinkToken(db, event.linkToken)).toBeTruthy();
    expect(await findEventByLinkToken(db, newLinkToken())).toBeNull();
  });

  it('reads participation from event_participant, so joins_open is enforceable', async () => {
    const event = await makeEvent({ joinsOpen: false });
    const actorId = await makeActor();

    // Not yet in: the link no longer admits them.
    expect(await decide(db, event, 'view', { actorId, linkToken: event.linkToken }))
      .toEqual({ allow: false, reason: 'joins_closed' });

    await recordParticipant(db, event.id, actorId);

    // Already in: unaffected by the switch.
    expect(await decide(db, event, 'view', { actorId, capEpoch: event.capEpoch }))
      .toEqual({ allow: true });
  });

  /**
   * The bug this was written for: every share link 404ed.
   *
   * `/e/<token>` granted the capability cookie and redirected, and the event
   * page then answered 404 — for everyone except the creator, a group member,
   * and anyone who had already uploaded, which is every person a link is ever
   * sent to. Verified against production before the fix: the exchange returned
   * 307 and set `pa_cap_…`, and both following requests to `/event/<id>` were
   * 404.
   *
   * Nothing failed. The exchange is one request and the render is the next, so
   * each half worked in isolation and no test joined them up.
   */
  it('leaves a capability that is worth nothing on its own', async () => {
    const event = await makeEvent();
    const stranger = await makeActor();

    // Exactly what the event page asks on the request after the redirect: an
    // actor, a fresh capability, and no link token — the token is spent, which
    // is the entire point of exchanging it.
    expect(await decide(db, event, 'view', { actorId: stranger, capEpoch: event.capEpoch }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('and works the moment the exchange records who came in', async () => {
    const event = await makeEvent();
    const stranger = await makeActor();

    await recordParticipant(db, event.id, stranger);

    expect(await decide(db, event, 'view', { actorId: stranger, capEpoch: event.capEpoch }))
      .toEqual({ allow: true });
  });

  it('recording a participant twice is not an error', async () => {
    const event = await makeEvent();
    const actorId = await makeActor();
    await recordParticipant(db, event.id, actorId);
    await expect(recordParticipant(db, event.id, actorId)).resolves.toBeUndefined();
  });

  it('reads group membership and distinguishes admins', async () => {
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'House', slug: 'house' })
      .returning();
    const event = await makeEvent({ groupId: group!.id });
    const member = await makeActor();
    const admin = await makeActor();
    await db.insert(schema.groupMembers).values([
      { groupId: group!.id, actorId: member!, role: 'member' },
      { groupId: group!.id, actorId: admin!, role: 'admin' },
    ]);

    expect(await decide(db, event, 'view', { actorId: member })).toEqual({ allow: true });
    expect(await decide(db, event, 'administer', { actorId: member })).toEqual({
      allow: false,
      reason: 'not_administrator',
    });
    expect(await decide(db, event, 'administer', { actorId: admin })).toEqual({
      allow: true,
    });
  });

  it('matches a spoken code against the one the event actually holds', async () => {
    const event = await makeEvent();
    const guest = await makeSignedInActor();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: event.id, claimedAt: new Date() });

    expect(await decide(db, event, 'contribute', { actorId: guest, code: 'amber-fox' }))
      .toEqual({ allow: true });
    expect(await decide(db, event, 'contribute', { actorId: guest, code: 'silver-otter' }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('will not take a correct code from someone signed out', async () => {
    const event = await makeEvent();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: event.id, claimedAt: new Date() });

    expect(await decide(db, event, 'view', { actorId: await makeActor(), code: 'amber-fox' }))
      .toEqual({ allow: false, reason: 'sign_in_required' });
  });

  it('a code claimed by another event does not open this one', async () => {
    const mine = await makeEvent();
    const theirs = await makeEvent();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: theirs.id, claimedAt: new Date() });

    expect(await decide(db, mine, 'view', { actorId: null, code: 'amber-fox' }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('rotating the link locks out stored capabilities but not the new link', async () => {
    const event = await makeEvent();
    const actorId = await makeActor();
    await recordParticipant(db, event.id, actorId);

    const rotated = newLinkToken();
    const [after] = await db
      .update(schema.events)
      .set({ linkToken: rotated, capEpoch: event.capEpoch + 1 })
      .where(eq(schema.events.id, event.id))
      .returning();

    expect(await decide(db, after!, 'view', { actorId, capEpoch: event.capEpoch }))
      .toEqual({ allow: false, reason: 'stale_capability' });
    expect(await decide(db, after!, 'view', { actorId, linkToken: rotated }))
      .toEqual({ allow: true });
    expect(await decide(db, after!, 'view', { actorId, linkToken: event.linkToken }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('a soft-deleted event is gone even for its creator', async () => {
    const creator = await makeActor();
    const event = await makeEvent({ createdBy: creator, deletedAt: new Date() });
    expect(await decide(db, event, 'view', { actorId: creator })).toEqual({
      allow: false,
      reason: 'event_deleted',
    });
  });
});

describe('guard', () => {
  it('throws rather than returning a value a handler could forget to check', async () => {
    const event = await makeEvent();
    await expect(guard(db, event, 'view', { actorId: null })).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(
      guard(db, event, 'view', { actorId: null, linkToken: event.linkToken }),
    ).resolves.toBeUndefined();
  });

  it('does not leak why, to someone who never had access', async () => {
    const event = await makeEvent();
    try {
      await guard(db, event, 'view', { actorId: null });
      expect.unreachable();
    } catch (err) {
      const res = toResponse(err);
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: 'not_found' });
    }
  });

  it('does explain itself to someone who proved access', async () => {
    const event = await makeEvent({ uploadsOpen: false });
    try {
      await guard(db, event, 'contribute', {
        actorId: await makeSignedInActor(),
        linkToken: event.linkToken,
      });
      expect.unreachable();
    } catch (err) {
      const res = toResponse(err);
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: 'uploads_closed' });
    }
  });

  it('rethrows anything that is not an access failure', () => {
    expect(() => toResponse(new TypeError('boom'))).toThrow(TypeError);
  });
});

describe('signed cookies', () => {
  it('round-trips a value', () => {
    expect(unsign(sign('actor-123'))).toBe('actor-123');
  });

  it('rejects a tampered payload', () => {
    const signed = sign('actor-123');
    expect(unsign(signed.replace('actor-123', 'actor-456'))).toBeNull();
  });

  it('rejects a tampered signature and a bare value', () => {
    expect(unsign(`${sign('a')}x`)).toBeNull();
    expect(unsign('actor-123')).toBeNull();
    expect(unsign(undefined)).toBeNull();
  });

  it('carries the epoch a capability was granted at', () => {
    const encoded = encodeCapability({ eventId: 'evt', capEpoch: 3 });
    expect(decodeCapability(encoded)).toEqual({ eventId: 'evt', capEpoch: 3 });
  });

  it('will not accept a capability with a forged epoch', () => {
    const encoded = encodeCapability({ eventId: 'evt', capEpoch: 1 });
    expect(decodeCapability(encoded.replace('evt:1', 'evt:2'))).toBeNull();
  });
});

describe('a door that does not write anything down evicts people later', () => {
  /**
   * The native failure, which is not the web one.
   *
   * Native keeps the link token and presents it on every call, so `viaLink`
   * carries it and viewing works — the capability cookie the web depends on is
   * never involved. So the missing participant record cost nothing visible,
   * right up until a host closed joins: `joins_open` off means "new people can
   * no longer join; everyone already in keeps access", and the second half of
   * that is enforced entirely by `event_participant`.
   */
  it('keeps someone in who joined before the host closed joins', async () => {
    const event = await makeEvent({ joinsOpen: false });
    const joined = await makeSignedInActor();

    // Carrying the link and nothing else: refused, though they were here
    // before the switch was thrown.
    expect(await decide(db, event, 'view', { actorId: joined, linkToken: event.linkToken }))
      .toEqual({ allow: false, reason: 'joins_closed' });

    // Written down at the door, which is what the join route now does.
    await recordParticipant(db, event.id, joined);

    expect(await decide(db, event, 'view', { actorId: joined, linkToken: event.linkToken }))
      .toEqual({ allow: true });
  });

  it('still refuses someone arriving after it closed', async () => {
    // The switch has to keep meaning something. This is the case recording at
    // the door would break if it happened above the refusal.
    const event = await makeEvent({ joinsOpen: false });
    expect(await decide(db, event, 'view', {
      actorId: await makeSignedInActor(),
      linkToken: event.linkToken,
    })).toEqual({ allow: false, reason: 'joins_closed' });
  });
});

describe('a private event where the host decides', () => {
  const privateEvent = () => makeEvent({ accessPolicy: 'request_access' });

  it('stops a signed-in link holder at the door', async () => {
    const event = await privateEvent();
    expect(await decide(db, event, 'view', {
      actorId: await makeSignedInActor(),
      linkToken: event.linkToken,
    })).toEqual({ allow: false, reason: 'approval_required' });
  });

  it('asks for sign-in before it asks for approval', async () => {
    // Order matters for what the person is told to do next. "Wait to be let
    // in" to somebody who has not said who they are sends them to wait for a
    // decision nobody can make.
    const event = await privateEvent();
    expect(await decide(db, event, 'view', {
      actorId: await makeActor(),
      linkToken: event.linkToken,
    })).toEqual({ allow: false, reason: 'sign_in_required' });
  });

  it('opens once the host records them as in', async () => {
    // Approval is an `event_participant` row and nothing else — the request
    // table is the conversation, not the grant.
    const event = await privateEvent();
    const guest = await makeSignedInActor();
    await recordParticipant(db, event.id, guest);

    expect(await decide(db, event, 'view', { actorId: guest, capEpoch: event.capEpoch }))
      .toEqual({ allow: true });
  });

  it('does not let the spoken phrase go round the host', async () => {
    // The code is the weakest secret in the system — short, said out loud,
    // recycled. It must not be the way past the one policy whose point is
    // that a person decides.
    const event = await privateEvent();
    const guest = await makeSignedInActor();
    await db
      .insert(schema.codes)
      .values({ words: 'amber-quiet-lantern', eventId: event.id, claimedAt: new Date() });

    expect(await decide(db, event, 'view', { actorId: guest, code: 'amber-quiet-lantern' }))
      .toEqual({ allow: false, reason: 'approval_required' });
  });

  it('still says nothing at all to someone without the link', async () => {
    // 404, not "ask the host": `approval_required` would confirm the event
    // exists to anyone who guessed an id.
    const event = await privateEvent();
    expect(await decide(db, event, 'view', { actorId: await makeSignedInActor() }))
      .toEqual({ allow: false, reason: 'no_credential' });
  });

  it('never makes the creator ask themselves', async () => {
    const creator = await makeSignedInActor();
    const event = await makeEvent({ accessPolicy: 'request_access', createdBy: creator });
    expect(await decide(db, event, 'view', { actorId: creator })).toEqual({ allow: true });
  });
});

describe('the request route', () => {
  const route = readFileSync(
    fileURLToPath(new URL('../app/api/events/[id]/access-requests/route.ts', import.meta.url)),
    'utf8',
  );

  it('grants by recording a participant, not by writing to its own table', () => {
    // The whole reason the grant lives elsewhere: a bug in this file can lose
    // a request, which is visible and fixable by asking again, and cannot open
    // an event, which would be neither.
    expect(route).toMatch(/recordParticipant\(db, id, row\.actorId\)/);
  });

  it('records the participant before marking the request answered', () => {
    // Crash between the two writes and the host clicks approve again, which is
    // harmless. The other order leaves someone marked approved who can see
    // nothing and has no way to say so.
    // Anchored on the value written rather than on the shape of the call, so
    // reformatting the update does not quietly turn this into a test that
    // matches nothing and passes.
    const grant = route.indexOf('recordParticipant(db, id, row.actorId)');
    const mark = route.indexOf("status: action === 'approve'");
    expect(grant).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(grant).toBeLessThan(mark);
  });

  it('checks the link before it will carry a name to the host', () => {
    // Without this, anyone who guessed an event id could put themselves in
    // front of its host.
    expect(route).toMatch(/requester\.capEpoch !== event\.capEpoch/);
  });

  it('will not reopen a request the host declined', () => {
    expect(route).toMatch(/if \(existing\) return NextResponse\.json\(\{ status: existing\.status \}\)/);
  });

  it('scopes a resolution to its own event', () => {
    // A request id from another event must not be answerable by the admin of
    // this one.
    expect(route).toMatch(/eq\(schema\.eventAccessRequests\.eventId, id\)/);
  });
});

describe('the native join route', () => {
  const route = readFileSync(
    fileURLToPath(new URL('../app/api/join/route.ts', import.meta.url)),
    'utf8',
  );

  it('records the join it is named after', () => {
    expect(route).toMatch(/recordParticipant\(db, event\.id, actorId\)/);
  });

  it('records below the refusal, like the web door', () => {
    const denial = route.indexOf('if (!decision.allow)');
    const record = route.indexOf('recordParticipant(db,');
    expect(denial).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(-1);
    expect(denial, 'participation must be recorded below the refusal').toBeLessThan(record);
  });

  it('does not mint an actor to record', () => {
    // `/api/session` is explicit that native must not hold a cookie and a
    // keychain token for the same actor, and `ensureActor` sets a cookie. A
    // row naming an actor this client cannot prove it is records nobody.
    // A call, not a mention — the comment above it in the route says the word
    // while explaining why it is not used, and a test that cannot tell those
    // apart fails on its own documentation.
    expect(route).not.toMatch(/ensureActor\s*\(/);
    expect(route).toMatch(/if \(actorId\) await recordParticipant/);
  });
});

describe('the link exchange', () => {
  const route = readFileSync(
    fileURLToPath(new URL('../app/e/[token]/route.ts', import.meta.url)),
    'utf8',
  );

  it('records who came in, not just what their browser now holds', () => {
    // The half that was missing. `recordParticipant` lived in the upload route
    // and nowhere else, so the only way to become a participant was to already
    // be one — you had to upload to an event you could not open.
    expect(route).toMatch(/recordParticipant\(db, event\.id, actorId\)/);
  });

  it('gives a first-time visitor an actor to be', () => {
    // A stranger arriving from a group chat has no cookie at all, and
    // `currentActorId()` would be null — there would be nobody to record.
    expect(route).toMatch(/ensureActor\(db\)/);
  });

  it('records only after the decision, so a closed event stays closed', () => {
    // The ordering is the whole safety property. `joins_closed` is refused by
    // `decide`; recording above that line would make this route the way in for
    // exactly the people the switch was thrown against, and it would look like
    // a tidier version of the same code.
    const denial = route.indexOf('if (!decision.allow)');
    const record = route.indexOf('recordParticipant(db,');
    expect(denial).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(-1);
    expect(denial, 'participation must be recorded below the refusal').toBeLessThan(record);
  });
});
