/**
 * The two parts of the native client that can be tested without a device.
 *
 * Everything else in here imports Expo modules at module scope, so it needs a
 * simulator or a phone; that is the honest boundary and it is why the upload
 * queue was written platform-free and lives in `@parea/upload`, where its
 * tests are.
 *
 * What is left is worth testing on its own account. `tokenFromInput` is the
 * front door — it decides whether a pasted link or a scanned QR gets someone
 * into an event — and `Api` is the one place where "two clients, one protocol"
 * is deliberately not identical: the web carries identity in a cookie, this
 * carries the same signed value as a bearer token.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Offline } from '@parea/upload';

import { Api, ApiError, type PendingRequest, tokenFromInput } from '../src/api';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 chars, as minted by @parea/core

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what someone actually pastes or scans', () => {
  it('takes a bare token', () => {
    expect(tokenFromInput(TOKEN)).toBe(TOKEN);
  });

  it('takes the full link', () => {
    expect(tokenFromInput(`https://parea.app/e/${TOKEN}`)).toBe(TOKEN);
  });

  it('survives the whitespace a paste brings with it', () => {
    expect(tokenFromInput(`  https://parea.app/e/${TOKEN}\n`)).toBe(TOKEN);
  });

  it('survives a trailing slash', () => {
    expect(tokenFromInput(`https://parea.app/e/${TOKEN}/`)).toBe(TOKEN);
  });

  it('survives the tracking junk a chat app staples on', () => {
    // A link that has been through a group chat rarely arrives clean, and
    // this is the moment someone is standing at a party trying to join.
    expect(tokenFromInput(`https://parea.app/e/${TOKEN}?utm_source=whatsapp`)).toBe(
      TOKEN,
    );
  });

  it('refuses anything that is not a token', () => {
    for (const input of [
      '',
      '   ',
      'https://parea.app/',
      'https://parea.app/e/',
      'https://parea.app/event/3f1c9a2e',
      'short',
      `${TOKEN}x`,
      `${TOKEN.slice(0, 21)}`,
      'AbCdEfGhIjKlMnOpQrSt-v',
    ]) {
      expect(tokenFromInput(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('does not mistake a spoken code for a link token', () => {
    // The other door. Codes go to a different endpoint, and quietly treating
    // one as a token would 404 rather than resolve.
    expect(tokenFromInput('amber-fox')).toBeNull();
  });
});

describe('identity on the wire', () => {
  function capture(response: Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response.clone();
    });
    return calls;
  }

  it('sends nothing until there is an actor', async () => {
    // Identity is minted on first contribution, not first launch — a browsing
    // visitor should not be carrying one (design §3).
    const calls = capture(new Response('{}', { status: 200 }));
    await new Api('https://api.test').join({ linkToken: TOKEN });
    expect((calls[0]!.init.headers as Record<string, string>).authorization)
      .toBeUndefined();
  });

  it('carries the actor as a bearer token once there is one', async () => {
    // Same signed string the web keeps in a cookie; a native client has no
    // cookie jar worth relying on.
    const calls = capture(new Response('{}', { status: 200 }));
    await new Api('https://api.test', 'signed-actor').feed('ev', TOKEN);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer signed-actor',
    );
  });

  it('picks up the token minted mid-session', async () => {
    const calls = capture(
      new Response(JSON.stringify({ actorToken: 'fresh' }), { status: 200 }),
    );
    const api = new Api('https://api.test');
    expect(await api.startSession('Sam')).toBe('fresh');

    await api.report('photo-1');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer fresh',
    );
  });
});

describe('groups on the wire', () => {
  function respond(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  it('unwraps the list, so callers never see the envelope', async () => {
    respond({ groups: [{ id: 'g1', name: 'Climbing', role: 'admin' }] });
    expect(await new Api('https://api.test').myGroups()).toEqual([
      { id: 'g1', name: 'Climbing', role: 'admin' },
    ]);
  });

  it('escapes a search query rather than pasting it into the URL', async () => {
    // Group names are arbitrary text and people search for what they see.
    const calls = respond({ groups: [] });
    await new Api('https://api.test').searchGroups('Sunday roast & co');
    expect(calls[0]!.url).toBe(
      'https://api.test/api/groups/search?q=Sunday%20roast%20%26%20co',
    );
  });

  it('joins and asks to join through one call, because the client cannot tell which', async () => {
    // Whether this is a join or a request depends on whether the server
    // thinks you were at one of the group's events, which the client does
    // not know and should not guess.
    const calls = respond({ requested: true }, 201);
    expect(await new Api('https://api.test').joinGroup('g1')).toEqual({
      requested: true,
    });
    expect(calls[0]!.url).toBe('https://api.test/api/groups/g1/requests');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('sends an admin decision as a PATCH naming the request', async () => {
    const calls = respond({ resolved: 'approve' });
    await new Api('https://api.test').resolveRequest('g1', 'r1', 'approve');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      requestId: 'r1',
      action: 'approve',
    });
  });

  it('creates a group from an event, private by default', async () => {
    // Findability is asked once at creation and defaults closed — a friend
    // group is not a public entity because nobody said otherwise.
    const calls = respond({ id: 'g1', name: 'Sunday roast' }, 201);
    await new Api('https://api.test').createGroup('ev1', 'Sunday roast', false);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      fromEventId: 'ev1',
      name: 'Sunday roast',
      findable: false,
    });
  });

  it('surfaces the 404 that covers a private group', async () => {
    // One answer for "no such group", "private" and "not for you". The client
    // must not try to tell them apart.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    const err = await new Api('https://api.test').group('g1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });
});

describe('the things waiting on you, on the wire', () => {
  function respond(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  const request = (over: Partial<PendingRequest> = {}): PendingRequest => ({
    key: 'invite:r1',
    kind: 'invite',
    id: 'r1',
    eventId: 'ev1',
    title: 'Lisbon, in April',
    detail: 'Ines asked you',
    at: '2026-08-14T12:00:00.000Z',
    ...over,
  });

  it('unwraps the list, so the screen never sees the envelope', async () => {
    respond({ requests: [request()] });
    const list = await new Api('https://api.test').requests();
    expect(list).toEqual([request()]);
  });

  /*
   * Each kind goes to the route that already decides who may answer it, and
   * they disagree about the word for yes. Getting this wrong is silent in the
   * worst way: `approve` sent to the friends route is a 400 the person reads
   * as "it did not work", and `accept` sent to an event's access requests is
   * the same. There is no shared constant to lean on — the words are the
   * routes' own — so the mapping is pinned here.
   */
  it('answers an invitation where invitations are answered', async () => {
    const calls = respond({ ok: true });
    await new Api('https://api.test').answerRequest(request(), true);
    expect(calls[0]!.url).toBe('https://api.test/api/invites/r1');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ action: 'accept' });
  });

  it('answers a friend request by naming it, since the route takes no id', async () => {
    const calls = respond({ ok: true });
    await new Api('https://api.test').answerRequest(
      request({ kind: 'friend', key: 'friend:f1', id: 'f1', eventId: null }),
      false,
    );
    expect(calls[0]!.url).toBe('https://api.test/api/friends');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      requestId: 'f1',
      action: 'decline',
    });
  });

  it('approves somebody into the event they asked about, not into any other', async () => {
    // The event id in the path is what scopes it. A host administering two
    // events has a request id that is only answerable through one of them.
    const calls = respond({ ok: true });
    await new Api('https://api.test').answerRequest(
      request({ kind: 'join', key: 'join:j1', id: 'j1', eventId: 'ev9' }),
      true,
    );
    expect(calls[0]!.url).toBe('https://api.test/api/events/ev9/access-requests');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      requestId: 'j1',
      action: 'approve',
    });
  });
});

describe('an event cover, on the wire', () => {
  it('is a target rather than a call, because the bytes never touch JS', () => {
    /*
     * A cover is a photograph off the camera roll. Reading a few megabytes
     * into JavaScript to hand them straight back to the same operating system
     * is the version of this that runs out of memory on an old phone, so the
     * native uploader streams it from disk and this owns only the address and
     * the identity.
     */
    const target = new Api('https://api.test', 'tok').coverTarget('e1');
    expect(target.url).toBe('https://api.test/api/events/e1/cover');
    expect(target.headers.authorization).toBe('Bearer tok');
    expect(target.headers['content-type']).toBe('image/jpeg');
  });

  it('is taken off with a DELETE to the same place', async () => {
    // One endpoint owns covers, so there is one place that decides who may
    // change an event's face — and it is `administer`, not "can add photos".
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await new Api('https://api.test', 'tok').removeCover('e1');
    expect(calls[0]!.url).toBe('https://api.test/api/events/e1/cover');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('carries no bearer when there is nobody to be', () => {
    // The endpoint answers 404 to anyone who cannot administer the event, and
    // a header saying `Bearer null` would be a request claiming to be somebody.
    const target = new Api('https://api.test').coverTarget('e1');
    expect(target.headers.authorization).toBeUndefined();
  });
});

describe('a person, on the wire', () => {
  function respond(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  it('escapes the handle rather than pasting it into the path', async () => {
    // A handle in a URL has been tapped out of a search result, and the app
    // must not be the thing that turns one into a different request.
    const calls = respond({ person: {}, shared: [] });
    await new Api('https://api.test').person('a/b?c');
    expect(calls[0]!.url).toBe('https://api.test/api/people/a%2Fb%3Fc');
  });

  it('hands back the page whole, envelope and all', async () => {
    // Both halves come from one call because they are one decision: who this
    // is, and which events you are both in.
    respond({
      person: {
        actorId: 'a1',
        handle: 'wren',
        displayName: 'Wren',
        avatar: null,
        standing: 'none',
        requestId: null,
      },
      shared: [{ id: 'e1', name: 'Barcelona', caption: null, lastActiveAt: 'x', thumb: null }],
    });
    const body = await new Api('https://api.test').person('wren');
    expect(body.person).toMatchObject({ handle: 'wren', standing: 'none' });
    expect(body.shared).toHaveLength(1);
  });

  it('surfaces the 404 that covers everybody without a page', async () => {
    /*
     * No such handle, a device that never signed in, a merged actor, either
     * side of a block — one answer for all of them. The client must not try
     * to tell them apart, because telling them apart is how a screen becomes
     * a way to ask whether somebody exists.
     */
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    const err = await new Api('https://api.test').person('wren').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });

  it('asks by actor id, and says what is now true', async () => {
    // `accepted` comes back when the ask crossed with theirs: the endpoint
    // answers their open request rather than opening a second one.
    const calls = respond({ status: 'accepted' });
    expect(await new Api('https://api.test').askFriend('a1')).toEqual({
      status: 'accepted',
    });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ actorId: 'a1' });
  });

  it('answers by request id, the same PATCH the bubble sends', async () => {
    // Two screens, one endpoint. A second way to accept a friend request
    // would be a second place for "who may answer this" to live.
    const calls = respond({ ok: true });
    await new Api('https://api.test').answerFriend('r1', false);
    expect(calls[0]!.url).toBe('https://api.test/api/friends');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      requestId: 'r1',
      action: 'decline',
    });
  });

  it('escapes a handle search the same way the group one is escaped', async () => {
    const calls = respond({ people: [] });
    await new Api('https://api.test').findPeople('wren smith');
    expect(calls[0]!.url).toBe('https://api.test/api/people?q=wren%20smith');
  });
});

/**
 * A link to a private album, which resolves to a door rather than to a room.
 *
 * The failure this replaced was a lie the app told confidently: `/api/join`
 * refused every denial as 404, so a correct link to a private album came back
 * as "Couldn't find that. Check the link or the code and try again" — to
 * somebody holding exactly the right link. They check it, find it is right,
 * and try again.
 */
describe('a private album, on the wire', () => {
  it('carries the album along with the refusal, so a door can name it', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          error: 'approval_required',
          event: { id: 'ev7', name: 'Quiet weekend' },
        }),
        { status: 403 },
      ),
    );

    const err = await new Api('https://api.test')
      .join({ linkToken: TOKEN })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('approval_required');
    // The whole point of `body`: a door with no name on it is not a door.
    expect(err.body.event).toEqual({ id: 'ev7', name: 'Quiet weekend' });
  });

  it('asks by posting to the album, and sends nothing else', async () => {
    // No body at all. Who is asking is the bearer token, and the server reads
    // it there — a name in the body would be a second answer to that.
    const calls = respondTo({ status: 'open' });
    expect(await new Api('https://api.test').askToJoin('ev7')).toEqual({
      status: 'open',
    });
    expect(calls[0]!.url).toBe('https://api.test/api/events/ev7/access-requests');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('asks people in by id, and reports what the server accepted', async () => {
    /*
     * The count comes back from the route rather than from the length of what
     * was sent: it drops anybody it will not write — somebody either side of a
     * block, an actor with no account, a person already asked — and refuses to
     * say which, because that would report whether each one has blocked you.
     */
    const calls = respondTo({ invited: 2 });
    expect(await new Api('https://api.test').invite('ev7', ['a1', 'a2', 'a3'])).toEqual({
      invited: 2,
    });
    expect(calls[0]!.url).toBe('https://api.test/api/events/ev7/invites');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      actorIds: ['a1', 'a2', 'a3'],
    });
  });

  it('drops the friend requests that ride along with the friends', async () => {
    // `/api/friends` answers both in one payload. A guest list is not the
    // place for somebody who has not answered whether they know you.
    const calls = respondTo({
      friends: [{ actorId: 'a1', handle: 'wren', displayName: null }],
      requests: [{ actorId: 'a9', handle: 'nope', displayName: null }],
    });
    expect(await new Api('https://api.test').friends()).toEqual([
      { actorId: 'a1', handle: 'wren', displayName: null },
    ]);
    expect(calls[0]!.url).toBe('https://api.test/api/friends');
  });

  it('survives a friends payload with nothing in it', async () => {
    // The picker opens with this list and must not throw on an empty account.
    respondTo({});
    expect(await new Api('https://api.test').friends()).toEqual([]);
  });

  it('changes who can see it through the endpoint the web changes it through', async () => {
    const calls = respondTo({ ok: true });
    await new Api('https://api.test').setAccessPolicy('ev7', 'private');
    expect(calls[0]!.url).toBe('https://api.test/api/events/ev7');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      accessPolicy: 'private',
    });
  });

  function respondTo(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }
});

describe('failures', () => {
  it('keeps the status and the code, because the UI branches on both', async () => {
    // 404 is "no such event"; 403 blocked and 429 quota_exceeded both need
    // saying differently. A thrown string would lose that.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'blocked' }), { status: 403 }),
    );

    const err = await new Api('https://api.test')
      .join({ code: 'amber-fox' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('blocked');
  });

  it('does not fall over when the body is not JSON', async () => {
    // A proxy error page or a 502 from the edge is not going to be JSON.
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));

    const err = await new Api('https://api.test').feed('ev', TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('unknown');
  });
});

describe('no signal', () => {
  it('is an Offline error, not an ApiError', async () => {
    // The upload queue treats the two oppositely: an HTTP failure spends a
    // retry attempt, no network spends none and stops the run. Conflating
    // them is what marked two hundred photos permanently failed at a venue.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Network request failed');
    });

    const err = await new Api('https://api.test').feed('ev', TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(Offline);
    expect(err).not.toBeInstanceOf(ApiError);
  });

  it('leaves an HTTP failure as an ApiError', async () => {
    // The server answered. That is not an outage, and retrying is right.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'quota_exceeded' }), { status: 429 }),
    );

    const err = await new Api('https://api.test').feed('ev', TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(Offline);
    expect(err.status).toBe(429);
  });
});

describe('what the camera roll gets', () => {
  it('carries an original URL for every photo in the feed', async () => {
    // The product's headline is the full collection at full quality, and the
    // native terminal action is the camera roll. Saving `full` — a 2560px
    // rendition — is a downgrade nobody asked for and nothing announced.
    const route = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../web/app/api/events/[id]/photos/route.ts',
          import.meta.url,
        ).pathname,
        'utf8',
      ),
    );
    expect(route).toMatch(/original: await imageSrc\(photo, 'orig'/);
  });

  it('names the temp file so the photo library can read it', async () => {
    const platform = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/platform.ts', import.meta.url).pathname, 'utf8'),
    );
    // An extensionless HEIC is the kind of thing that works on one OS version
    // and is rejected on the next.
    expect(platform).toMatch(/extensionFor\(entry\.mime\)/);
    expect(platform).toContain("case 'image/heic'");
  });
});

describe('a success with no body', () => {
  /**
   * Asking for a sign-in code answers 204 on purpose: it answers the same
   * however it went, so it cannot be used to ask whether an address has an
   * account. The client parsed every success as JSON, so that 204 threw and
   * surfaced as "Could not ask for a code" — on the app's only route to an
   * account, for a request that had worked. Tapping again sent a second code
   * and invalidated the first, so the loop never ended.
   */
  const res = (status: number, body?: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return body;
      },
    }) as unknown as Response;

  it('does not throw on 204', async () => {
    const api = new Api('http://x', null);
    (globalThis as { fetch: unknown }).fetch = async () => res(204);
    await expect(api.requestSignIn('sam@example.com')).resolves.toBeUndefined();
  });

  it('still fails on a 200 whose body is not JSON', async () => {
    // The check is on the status, not on catching the parse error, so a
    // genuinely broken response is not quietly swallowed with it.
    const api = new Api('http://x', null);
    (globalThis as { fetch: unknown }).fetch = async () => res(200);
    await expect(api.join({ code: 'amber-quiet-lantern' })).rejects.toThrow();
  });
});
