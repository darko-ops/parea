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

import { Api, ApiError, tokenFromInput } from '../src/api';

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
