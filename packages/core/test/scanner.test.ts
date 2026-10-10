/**
 * The hash-matching client both the deriver and the web app use.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hashEndpointFor,
  PHOTODNA_ENDPOINT,
  PHOTODNA_HASH_ENDPOINT,
  PhotoDnaHashScanner,
  PHOTODNA_LIMITS,
  PhotoDnaScanner,
  scannerFromEnv,
  ScanUnavailable,
} from '../src/scanner';

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

/**
 * Microsoft PhotoDNA Cloud Service, as it answers: PascalCase JSON, the image
 * itself as the body, and `Status.Code` 3000 as the only real answer.
 */
describe('PhotoDNA', () => {
  function photodna(body: unknown, status = 200) {
    const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
    vi.stubGlobal('fetch', async (url: URL | string, init: RequestInit) => {
      sent.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: init.body as Uint8Array,
      });
      return new Response(JSON.stringify(body), { status });
    });
    return sent;
  }
  const scanner = () => scannerFromEnv({ CSAM_SCANNER_PROVIDER: 'photodna', CSAM_SCANNER_KEY: 'sub-key' })!;

  it('is turned on by a key alone, and knows its own endpoint', () => {
    expect(scannerFromEnv({ CSAM_SCANNER_PROVIDER: 'photodna' })).toBeNull();
    expect(scanner()).toBeInstanceOf(PhotoDnaScanner);
    expect(scanner().limits).toBe(PHOTODNA_LIMITS);
  });

  it('sends the image as itself, with the subscription key', async () => {
    const sent = photodna({ Status: { Code: 3000, Description: 'OK' }, IsMatch: false, TrackingId: 't' });
    await expect(scanner().scan(input)).resolves.toEqual({ match: false });
    expect(sent[0]!.url).toBe(`${PHOTODNA_ENDPOINT}?enhance=false`);
    expect(sent[0]!.headers['Ocp-Apim-Subscription-Key']).toBe('sub-key');
    expect(sent[0]!.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(sent[0]!.body).equals(input.bytes)).toBe(true);
  });

  it('moves to a regional host when told', async () => {
    const sent = photodna({ Status: { Code: 3000 }, IsMatch: false });
    const uk = scannerFromEnv({
      CSAM_SCANNER_PROVIDER: 'photodna',
      CSAM_SCANNER_KEY: 'k',
      CSAM_SCANNER_URL: 'https://uk-api.microsoftmoderator.com/photodna/v1.0/Match',
    })!;
    await uk.scan(input);
    expect(sent[0]!.url).toMatch(/^https:\/\/uk-api\.microsoftmoderator\.com\//);
  });

  it('reports a match with what it matched and the tracking id', async () => {
    photodna({
      Status: { Code: 3000, Description: 'OK' },
      IsMatch: true,
      MatchDetails: { MatchFlags: [{ Source: 'NCMEC', Violations: ['A1'] }] },
      TrackingId: 'track-1',
    });
    await expect(scanner().scan(input)).resolves.toEqual({
      match: true,
      classification: 'A1',
      providerReference: 'track-1',
    });
  });

  it('reads the fields whatever their case', async () => {
    photodna({ status: { code: 3000 }, isMatch: true, matchDetails: { matchFlags: [{ source: 'S' }] } });
    await expect(scanner().scan(input)).resolves.toMatchObject({ match: true, classification: 'S' });
  });

  it('never takes anything but 3000 as an answer', async () => {
    for (const code of [3002, 3004, 3206, 3208]) {
      photodna({ Status: { Code: code, Description: 'nope' }, IsMatch: false });
      await expect(scanner().scan(input)).rejects.toBeInstanceOf(ScanUnavailable);
    }
    photodna({ Status: { Code: 3000 } });
    await expect(scanner().scan(input)).rejects.toBeInstanceOf(ScanUnavailable);
    photodna({ Status: { Code: 3000 }, IsMatch: false }, 429);
    await expect(scanner().scan(input)).rejects.toBeInstanceOf(ScanUnavailable);
  });

  it('refuses to send what it cannot read, rather than pass it', async () => {
    const sent = photodna({ Status: { Code: 3000 }, IsMatch: false });
    await expect(scanner().scan({ ...input, mime: 'image/heic' })).rejects.toBeInstanceOf(ScanUnavailable);
    await expect(
      scanner().scan({ ...input, bytes: Buffer.alloc(PHOTODNA_LIMITS.maxBytes + 1) }),
    ).rejects.toBeInstanceOf(ScanUnavailable);
    expect(sent).toHaveLength(0);
  });
});

describe('PhotoDNA with Edge Hashes', () => {
  // The approval letter's quick-start hash, which the live service answers as
  // a match from the source "Test". Truncated: only its passage is tested here.
  const TEST_HASH = 'UEROQQABAgAIT58oAAAAAAAAAADgAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw4A';
  const hasher = (value = TEST_HASH) => ({ seen: [] as string[], async hash(i: { mime: string }) { this.seen.push(i.mime); return value; } });

  function service(body: unknown, status = 200) {
    const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: URL | string, init: RequestInit) => {
      sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status });
    });
    return sent;
  }
  const scanner = (h = hasher()) =>
    scannerFromEnv({ CSAM_SCANNER_PROVIDER: 'photodna', CSAM_SCANNER_KEY: 'sub-key' }, { edgeHasher: h })!;

  it('is chosen when the SDK is there, and the image client when it is not', () => {
    expect(scanner()).toBeInstanceOf(PhotoDnaHashScanner);
    expect(scannerFromEnv({ CSAM_SCANNER_PROVIDER: 'photodna', CSAM_SCANNER_KEY: 'k' })).toBeInstanceOf(PhotoDnaScanner);
    expect(scannerFromEnv({ CSAM_SCANNER_PROVIDER: 'photodna' }, { edgeHasher: hasher() })).toBeNull();
  });

  it('sends the hash, never the image, to MatchHash in the shape the letter gives', async () => {
    const sent = service([{ Status: { Code: 3000 }, IsMatch: false }]);
    await expect(scanner().scan(input)).resolves.toEqual({ match: false });
    expect(sent[0]!.url).toBe(PHOTODNA_HASH_ENDPOINT);
    expect(sent[0]!.headers['Ocp-Apim-Subscription-Key']).toBe('sub-key');
    expect(sent[0]!.headers['content-type']).toBe('application/json');
    expect(sent[0]!.body).toEqual([{ DataRepresentation: 'PreHashV2', Value: TEST_HASH }]);
    expect(JSON.stringify(sent[0]!.body)).not.toContain(input.bytes.toString('base64'));
  });

  it('reads a match from a list, from a list inside an object, or from one result', async () => {
    const match = { Status: { Code: 3000 }, IsMatch: true, MatchDetails: { MatchFlags: [{ Source: 'Test' }] } };
    service([match]);
    await expect(scanner().scan(input)).resolves.toMatchObject({ match: true, classification: 'Test' });
    service({ TrackingId: 'tr-9', MatchResults: [match] });
    await expect(scanner().scan(input)).resolves.toEqual({ match: true, classification: 'Test', providerReference: 'tr-9' });
    service(match);
    await expect(scanner().scan(input)).resolves.toMatchObject({ match: true });
  });

  it('never reads an outage, an odd answer or a failed hash as clean', async () => {
    service({ Status: { Code: 3002, Description: 'Invalid request' } });
    await expect(scanner().scan(input)).rejects.toThrow(/3002: Invalid request/);
    service([{ Status: { Code: 3000 } }]);
    await expect(scanner().scan(input)).rejects.toThrow(/without IsMatch/);
    service([]);
    await expect(scanner().scan(input)).rejects.toThrow(/0 results for one hash/);
    service({}, 429);
    await expect(scanner().scan(input)).rejects.toThrow(/HTTP 429/);
    const broken = { async hash(): Promise<string> { throw new Error('sdk not loaded'); } };
    await expect(scanner(broken as never).scan(input)).rejects.toThrow(ScanUnavailable);
    await expect(scanner(hasher('')).scan(input)).rejects.toThrow(/empty/);
  });

  it('keeps a regional host when it moves to the hash endpoint', () => {
    expect(hashEndpointFor(undefined)).toBe(PHOTODNA_HASH_ENDPOINT);
    expect(hashEndpointFor('https://uk-api.microsoftmoderator.com/photodna/v1.0/Match')).toBe(
      'https://uk-api.microsoftmoderator.com/photodna/v1.0/MatchHash',
    );
  });
});
