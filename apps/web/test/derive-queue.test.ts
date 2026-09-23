/**
 * Waking the deriver, and the one character that stopped it.
 *
 * `publishDerive` had no test at all. Everything about it is correct except a
 * separator in a string, and that separator made every upload fail: QStash
 * answers `{"error":"DeduplicationId cannot contain ':'"}`, the publish throws
 * inside `complete`, `complete` answers 503, the row never gets its `bytesAt`,
 * the deriver will not claim a row without one, and the photograph stays
 * 'pending' forever while the client retries a request that cannot succeed.
 *
 * What made it invisible everywhere but production: the failure is a remote
 * service's validation rule. Development has no QStash — `publishDerive`
 * returns `not-configured` and the deriver polls instead — so the line never
 * ran until it ran against the real thing, and then it ran on every upload.
 *
 * So these hold the shape of the value rather than the behaviour around it.
 * The behaviour was never wrong.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { __setQueueForTests, deduplicationKey, publishDerive } from '../src/queue';

afterEach(() => {
  __setQueueForTests(null);
  vi.unstubAllEnvs();
});

/**
 * What QStash accepts, as far as this repository is allowed to assume.
 *
 * Deliberately conservative: the documented refusal is the colon, and a test
 * that checked only for a colon would pass the day somebody reaches for `@`
 * or `/` or a space instead.
 */
const SAFE = /^[A-Za-z0-9_-]+$/;

describe('the deduplication id', () => {
  it('carries no colon, which is the refusal that stranded every upload', () => {
    expect(deduplicationKey('0f870694-9e30-4f18-9201-8854445556b6')).not.toContain(':');
  });

  it('is safe for a photo id, which is a uuid', () => {
    // The real input, unchanged by the guard: this is not a transformation of
    // the ids the product actually has.
    const id = '0f870694-9e30-4f18-9201-8854445556b6';
    expect(deduplicationKey(id)).toBe(`derive-${id}`);
    expect(deduplicationKey(id)).toMatch(SAFE);
  });

  it('is safe for anything a future caller might hand it', () => {
    for (const odd of ['a:b', 'a/b', 'a b', 'ph://x/L0/001', 'é', 'a\tb', '']) {
      expect(deduplicationKey(odd), odd).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(deduplicationKey(odd), odd).not.toContain(':');
    }
  });

  it('still tells two photographs apart', () => {
    // A guard that collapsed distinct ids would trade a stranded upload for a
    // dropped one, inside the ten-minute window and just as quietly.
    expect(deduplicationKey('photo-a')).not.toBe(deduplicationKey('photo-b'));
  });
});

describe('what publishDerive sends', () => {
  it('publishes with a key the queue will accept', async () => {
    const publishJSON = vi.fn().mockResolvedValue({ messageId: 'm1' });
    __setQueueForTests({ publishJSON } as never);
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.stubEnv('DERIVER_JOB_URL', 'https://deriver.example/job');

    await expect(publishDerive('0f870694-9e30-4f18-9201-8854445556b6')).resolves.toBe(
      'published',
    );

    const sent = publishJSON.mock.calls[0]![0] as { deduplicationId: string; body: unknown };
    expect(sent.deduplicationId).toMatch(SAFE);
    expect(sent.body).toEqual({ photoId: '0f870694-9e30-4f18-9201-8854445556b6' });
  });

  it('lets a refusal through rather than swallowing it', async () => {
    /*
     * The half that was right all along, and the reason the bug was loud in
     * the logs rather than silent: after this there is nothing else looking,
     * so a failed publish has to fail the request. Answering 200 and hoping
     * would have made the same bug invisible instead of merely unexplained.
     */
    const publishJSON = vi
      .fn()
      .mockRejectedValue(new Error('{"error":"DeduplicationId cannot contain \':\'"}'));
    __setQueueForTests({ publishJSON } as never);
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.stubEnv('DERIVER_JOB_URL', 'https://deriver.example/job');

    await expect(publishDerive('photo-1')).rejects.toThrow(/DeduplicationId/);
  });

  it('is not a failure where there is no queue to publish to', async () => {
    // Development, where the deriver polls instead. Absent configuration means
    // "something else will find this", which is true there and false in
    // production — where the health check reports it missing.
    vi.stubEnv('QSTASH_TOKEN', '');
    await expect(publishDerive('photo-1')).resolves.toBe('not-configured');
  });
});
