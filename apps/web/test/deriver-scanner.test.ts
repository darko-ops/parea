/**
 * The web app's images, checked through the deriver: a verdict only from a
 * well-formed 200, and "could not check" from everything else.
 */

import { ScanUnavailable } from '@parea/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeriverScanner, deriverScannerFromEnv, readVerdict } from '@/deriverScanner';
import { hashMatchingLive } from '@/legal';

const TOKEN = 't'.repeat(40);
const input = { bytes: Buffer.from('jpeg bytes'), contentHash: Buffer.alloc(32), mime: 'image/jpeg' };

function deriver(status: number, body: unknown) {
  const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return sent;
}
afterEach(() => vi.unstubAllGlobals());

const scanner = () => new DeriverScanner('https://deriver.test/scan', TOKEN);

describe('the deriver scanner', () => {
  it('sends the image with the token, and reads the verdict', async () => {
    const sent = deriver(200, { match: false });
    await expect(scanner().scan(input)).resolves.toEqual({ match: false });
    expect(sent[0]!.url).toBe('https://deriver.test/scan');
    expect(sent[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent[0]!.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(sent[0]!.body).equals(input.bytes)).toBe(true);

    deriver(200, { match: true, classification: 'A1', providerReference: 'tr-1' });
    await expect(scanner().scan(input)).resolves.toEqual({ match: true, classification: 'A1', providerReference: 'tr-1' });
  });

  it('never reads a failure as clean', async () => {
    for (const [status, body] of [
      [503, { error: 'scan_unavailable' }],
      [401, 'unauthorised'],
      [200, { match: 'maybe' }],
      [200, 'not json'],
      [200, { match: true }],
    ] as const) {
      deriver(status, body);
      await expect(scanner().scan(input)).rejects.toThrow(ScanUnavailable);
    }
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(scanner().scan(input)).rejects.toThrow(ScanUnavailable);
  });

  it('gives up on a deriver that does not answer, as could-not-check', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    );
    await expect(new DeriverScanner('https://deriver.test/scan', TOKEN, 20).scan(input)).rejects.toThrow(/no answer in 20ms/);
  });

  it('reads only the two shapes a verdict comes in', () => {
    expect(readVerdict({ match: false, extra: 1 })).toEqual({ match: false });
    expect(() => readVerdict(null)).toThrow(ScanUnavailable);
  });
});

describe('configuration', () => {
  it('is on with a URL and a long enough token, and off otherwise', () => {
    expect(deriverScannerFromEnv({ DERIVER_SCAN_URL: 'https://d/scan', DERIVER_SCAN_TOKEN: TOKEN })).toBeInstanceOf(DeriverScanner);
    expect(deriverScannerFromEnv({ DERIVER_SCAN_URL: 'https://d/scan' })).toBeNull();
    expect(deriverScannerFromEnv({ DERIVER_SCAN_URL: 'https://d/scan', DERIVER_SCAN_TOKEN: 'short' })).toBeNull();
  });

  it('counts as scanning on the privacy page, without a PhotoDNA key here', () => {
    expect(hashMatchingLive({ DERIVER_SCAN_URL: 'https://d/scan', DERIVER_SCAN_TOKEN: TOKEN })).toBe(true);
    expect(hashMatchingLive({})).toBe(false);
  });
});
