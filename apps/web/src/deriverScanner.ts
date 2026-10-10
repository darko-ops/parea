/**
 * The web app's images checked by the deriver, which hashes them — so only a
 * PhotoDNA Edge Hash leaves for Microsoft, as the service was approved for.
 *
 * Moments, group photos, profile pictures and covers are stored by this app,
 * and it used to send each one to PhotoDNA itself, whole, at `/Match`. Making
 * the hash needs Microsoft's Edge Hash library, which cannot live in git, and
 * Vercel builds from git; the deriver's image carries it. So this asks the
 * deriver's `/scan` (see `SCAN_PATH` in services/deriver/src/http.ts) and
 * reads back the same verdict PhotoDNA would have given.
 *
 * Fail-closed exactly as before: anything but a 200 with a well-formed verdict
 * — the deriver asleep past the timeout, a 503 because PhotoDNA could not be
 * asked, a wrong token, a body that is not a verdict — is `ScanUnavailable`,
 * and `screenUpload` refuses the upload. What a match means for the image
 * (preserved, quarantined, someone woken) is still decided here.
 */

import { type CsamScanner, PHOTODNA_LIMITS, type ScanInput, ScanUnavailable, type ScanVerdict } from '@parea/core';

/**
 * Long enough for a machine that was asleep: Fly starts it on the request,
 * and it checks itself before serving — about four seconds — then hashes in
 * milliseconds and asks Microsoft.
 */
const TIMEOUT_MS = 25_000;

export class DeriverScanner implements CsamScanner {
  /** Recorded on incidents. PhotoDNA is what checked it, through the deriver. */
  readonly name = 'photodna';
  /** The deriver hashes what PhotoDNA would have taken, so the copy is made to the same limits. */
  readonly limits = PHOTODNA_LIMITS;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  async scan(input: ScanInput): Promise<ScanVerdict> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': input.mime },
        body: new Uint8Array(input.bytes),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer in ${this.timeoutMs}ms` : String(err);
      throw new ScanUnavailable(`deriver scan: ${why}`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new ScanUnavailable(`deriver scan answered ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return readVerdict(await response.json().catch(() => null));
  }
}

/** Only these two shapes are a verdict; anything else is not an answer. */
export function readVerdict(body: unknown): ScanVerdict {
  const v = body as { match?: unknown; classification?: unknown; providerReference?: unknown } | null;
  if (v?.match === false) return { match: false };
  if (v?.match === true && typeof v.classification === 'string') {
    return {
      match: true,
      classification: v.classification,
      providerReference: typeof v.providerReference === 'string' ? v.providerReference : undefined,
    };
  }
  throw new ScanUnavailable('deriver scan answered something that is not a verdict');
}

/**
 * On when both are set: `DERIVER_SCAN_URL`, the deriver's `/scan`, and
 * `DERIVER_SCAN_TOKEN`, shared with it, 32 characters or more. Off, the
 * caller falls back to asking PhotoDNA itself, as before.
 */
export function deriverScannerFromEnv(env: Record<string, string | undefined> = process.env): DeriverScanner | null {
  const url = env.DERIVER_SCAN_URL?.trim();
  const token = env.DERIVER_SCAN_TOKEN?.trim();
  if (!url || !token || token.length < 32) return null;
  return new DeriverScanner(url, token);
}
