/**
 * The hash-matching client both the deriver and the web app use.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { scannerFromEnv, ScanUnavailable } from '../src/scanner';

const input = { bytes: Buffer.from('a photograph'), contentHash: Buffer.alloc(32, 7), mime: 'image/jpeg' };

function respond(body: unknown, status = 200) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(body), { status });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('scannerFromEnv', () => {
  it('is null with no provider, which callers read as "no matching here"', () => {
    expect(scannerFromEnv({})).toBeNull();
    expect(scannerFromEnv({ CSAM_SCANNER_URL: 'https://x.test' })).toBeNull();
  });

  it('sends the image unless told not to', async () => {
    /*
     * The pipeline's own hash is a SHA-256 of stripped bytes, which no
     * known-material list is keyed on — so a fingerprint-only request could
     * never match. It used to be the default.
     */
    const sent = respond({ match: false });
    const scanner = scannerFromEnv({ CSAM_SCANNER_URL: 'https://x.test', CSAM_SCANNER_KEY: 'k' })!;
    await scanner.scan(input);
    expect(sent[0]!.image).toBe(input.bytes.toString('base64'));

    const hashOnly = scannerFromEnv({
      CSAM_SCANNER_URL: 'https://x.test',
      CSAM_SCANNER_KEY: 'k',
      CSAM_SCANNER_SEND_BYTES: 'false',
    })!;
    await hashOnly.scan(input);
    expect(sent[1]!.image).toBeUndefined();
  });

  it('never reads an outage or a strange answer as a clean result', async () => {
    const scanner = scannerFromEnv({ CSAM_SCANNER_URL: 'https://x.test', CSAM_SCANNER_KEY: 'k' })!;
    respond({ error: 'down' }, 503);
    await expect(scanner.scan(input)).rejects.toBeInstanceOf(ScanUnavailable);
    respond({ verdict: 'fine' });
    await expect(scanner.scan(input)).rejects.toBeInstanceOf(ScanUnavailable);
  });

  it('reports a match with what the provider called it', async () => {
    respond({ match: true, classification: 'A1', reference: 'r-1' });
    const scanner = scannerFromEnv({ CSAM_SCANNER_URL: 'https://x.test', CSAM_SCANNER_KEY: 'k', CSAM_SCANNER_NAME: 'provider' })!;
    expect(scanner.name).toBe('provider');
    await expect(scanner.scan(input)).resolves.toEqual({ match: true, classification: 'A1', providerReference: 'r-1' });
  });
});
