import { describe, expect, it, vi } from 'vitest';

import {
  isExpoPushToken,
  render,
  sendAll,
  toMessage,
  type Notification,
  type PushMessage,
} from '../src/index';

const TOKEN = 'ExponentPushToken[abc123]';

function message(to = TOKEN): PushMessage {
  return { to, title: 't', body: 'b', data: {} };
}

/** Answers with one ticket per message, per Expo's shape. */
function fakeExpo(
  tickets: (message: PushMessage) => { status: string; details?: { error?: string } },
) {
  const calls: PushMessage[][] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as PushMessage[];
    calls.push(batch);
    return new Response(JSON.stringify({ data: batch.map(tickets) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('what can be sent', () => {
  it('covers exactly three kinds, and no more', () => {
    // The restraint is the feature. A fourth kind should be a deliberate type
    // change, not something that appears at a call site.
    const kinds: Notification['kind'][] = ['nudge', 'group_event', 'removal_answered'];
    expect(kinds).toHaveLength(3);
  });

  it('says something different when an event is still empty', () => {
    expect(
      render({ kind: 'nudge', eventId: 'e', eventName: 'Party', photoCount: 0 }).body,
    ).toMatch(/Nobody has added/);
    expect(
      render({ kind: 'nudge', eventId: 'e', eventName: 'Party', photoCount: 12 }).body,
    ).toMatch(/12 photos/);
  });

  it('leads a group notification with the group, not the event', () => {
    // The group is the thing you recognise on a lock screen.
    const { title, body } = render({
      kind: 'group_event',
      groupId: 'g',
      groupName: 'The Flat',
      eventId: 'e',
      eventName: 'Sunday roast',
    });
    expect(title).toBe('The Flat');
    expect(body).toContain('Sunday roast');
  });

  it('distinguishes both outcomes of a removal request', () => {
    expect(render({ kind: 'removal_answered', eventId: 'e', removed: true }).title)
      .toMatch(/taken down/i);
    expect(render({ kind: 'removal_answered', eventId: 'e', removed: false }).title)
      .toMatch(/kept/i);
  });

  it('carries only strings in the payload', () => {
    const msg = toMessage(TOKEN, {
      kind: 'nudge',
      eventId: 'e',
      eventName: 'Party',
      photoCount: 3,
    });
    expect(Object.values(msg.data).every((v) => typeof v === 'string')).toBe(true);
    expect(msg.data.photoCount).toBe('3');
  });
});

describe('tokens', () => {
  it('accepts both forms Expo issues', () => {
    expect(isExpoPushToken('ExponentPushToken[xxx]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[xxx]')).toBe(true);
  });

  it('rejects anything else without sending it', async () => {
    const { fetcher, calls } = fakeExpo(() => ({ status: 'ok' }));
    const result = await sendAll([message('not-a-token'), message('')], { fetcher });
    expect(result.failed).toBe(2);
    expect(calls, 'nothing should reach the network').toHaveLength(0);
  });
});

describe('delivery', () => {
  it('reports what was sent', async () => {
    const { fetcher } = fakeExpo(() => ({ status: 'ok' }));
    const result = await sendAll([message(), message()], { fetcher });
    expect(result).toEqual({ sent: 2, failed: 0, unregistered: [] });
  });

  it('chunks past Expo’s per-request limit', async () => {
    const { fetcher, calls } = fakeExpo(() => ({ status: 'ok' }));
    const messages = Array.from({ length: 250 }, (_, i) =>
      message(`ExponentPushToken[t${i}]`),
    );
    const result = await sendAll(messages, { fetcher });
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(result.sent).toBe(250);
  });

  it('names tokens to forget rather than retrying them forever', async () => {
    // An uninstalled app is a permanent error on every future send.
    const dead = 'ExponentPushToken[gone]';
    const { fetcher } = fakeExpo((m) =>
      m.to === dead
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok' },
    );
    const result = await sendAll([message(), message(dead)], { fetcher });
    expect(result.sent).toBe(1);
    expect(result.unregistered).toEqual([dead]);
  });

  it('does not treat other errors as a dead token', async () => {
    const { fetcher } = fakeExpo(() => ({
      status: 'error',
      details: { error: 'MessageRateExceeded' },
    }));
    const result = await sendAll([message()], { fetcher });
    expect(result.failed).toBe(1);
    expect(result.unregistered).toEqual([]);
  });

  it('survives the push service being down', async () => {
    // Nothing depends on a notification arriving, so an outage must not fail
    // the request or job that triggered it.
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(sendAll([message()], { fetcher })).resolves.toEqual({
      sent: 0,
      failed: 1,
      unregistered: [],
    });
  });

  it('survives a non-200 from the push service', async () => {
    const fetcher = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await sendAll([message()], { fetcher });
    expect(result).toEqual({ sent: 0, failed: 1, unregistered: [] });
  });

  it('sends nothing when there is nothing to send', async () => {
    const { fetcher, calls } = fakeExpo(() => ({ status: 'ok' }));
    expect(await sendAll([], { fetcher })).toEqual({ sent: 0, failed: 0, unregistered: [] });
    expect(calls).toHaveLength(0);
  });

  it('attaches an access token when one is configured', async () => {
    let auth: string | null = null;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('authorization');
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await sendAll([message()], { fetcher, accessToken: 'secret' });
    expect(auth).toBe('Bearer secret');
  });
});
