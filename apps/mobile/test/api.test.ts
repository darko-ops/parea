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
   * as "it did not work", and `accept` sent to an album's access requests is
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

  it('approves somebody into the album they asked about, not into any other', async () => {
    // The event id in the path is what scopes it. A host administering two
    // albums has a request id that is only answerable through one of them.
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
