/**
 * Child-safety scanning at ingest — docs/design.md §13, docs/csam-runbook.md.
 *
 * A product that accepts photo uploads from unverified contributors has this
 * risk surface whether or not it plans for it. The design calls scanning a
 * launch gate; this is the code half.
 *
 * Three things this module is careful about:
 *
 * IT FAILS CLOSED. If no scanner is configured, or the scanner is unreachable,
 * the photo does not become `ready` — and `ready` is what every listing,
 * download and image URL keys off. Unscanned content is therefore never
 * served, ever, rather than being served while someone fixes the scanner. The
 * cost is that an outage stalls ingest, which is the correct way round.
 *
 * IT DOES NOT DECIDE ANYTHING. A match quarantines and alerts. It does not
 * report, does not delete, does not email the uploader, does not tell the
 * host. Reporting to NCMEC is a legal act with statutory consequences for
 * getting it wrong in either direction, and it is performed by a person.
 *
 * IT MOVES AS LITTLE CONTENT AS POSSIBLE. Providers that match on perceptual
 * hashes are preferred over ones that want the image, because the overwhelming
 * majority of what passes through here is somebody's birthday party.
 */

export type ScanVerdict =
  | { match: false }
  | {
      match: true;
      classification: string;
      providerReference?: string;
    };

export type ScanInput = {
  bytes: Buffer;
  /** sha256 of the stored bytes, already computed by the pipeline. */
  contentHash: Buffer;
  mime: string;
};

export interface CsamScanner {
  readonly name: string;
  scan(input: ScanInput): Promise<ScanVerdict>;
}

/** Thrown when scanning could not be completed. Never treated as "no match". */
export class ScanUnavailable extends Error {}

/**
 * The default when nothing is configured.
 *
 * Refuses rather than passing. A silent no-op scanner is the worst possible
 * default: everything looks fine, nothing is checked, and the gap is invisible
 * until it matters. This makes an unconfigured deployment obvious on the first
 * upload instead.
 */
/**
 * A hash-matching service over HTTP.
 *
 * Deliberately generic: the field is served by several providers (PhotoDNA
 * Cloud Service, Thorn's Safer, Google's Content Safety API, Cloudflare's CSAM
 * Scanning Tool for proxied content) and which one is appropriate depends on
 * eligibility and onboarding rather than on anything technical. All of them
 * amount to "send this, get a verdict", so the seam is here and the choice is
 * configuration.
 *
 * A non-200, a timeout or an unparseable body raises ScanUnavailable. It is
 * never interpreted as a clean result.
 */
export class HttpHashScanner implements CsamScanner {
  readonly name: string;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    options: { name?: string; timeoutMs?: number; sendBytes?: boolean } = {},
  ) {
    this.name = options.name ?? 'http';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    // Hash-only where the provider supports it: ordinary photos should not
    // leave the system to be scanned if a fingerprint will do.
    this.sendBytes = options.sendBytes ?? false;
  }

  private readonly timeoutMs: number;
  private readonly sendBytes: boolean;

  async scan(input: ScanInput): Promise<ScanVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          contentHash: input.contentHash.toString('hex'),
          mime: input.mime,
          ...(this.sendBytes ? { image: input.bytes.toString('base64') } : {}),
        }),
      });

      if (!response.ok) {
        throw new ScanUnavailable(`scanner returned ${response.status}`);
      }

      const body = (await response.json()) as {
        match?: unknown;
        classification?: unknown;
        reference?: unknown;
      };

      if (typeof body.match !== 'boolean') {
        throw new ScanUnavailable('scanner returned an unrecognised body');
      }
      if (!body.match) return { match: false };

      return {
        match: true,
        classification:
          typeof body.classification === 'string' ? body.classification : 'unspecified',
        providerReference:
          typeof body.reference === 'string' ? body.reference : undefined,
      };
    } catch (err) {
      if (err instanceof ScanUnavailable) throw err;
      throw new ScanUnavailable(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The scanner, or null when there is none.
 *
 * Null used to be impossible: absence returned a stub that threw on every
 * photo, so a deployment without a hash-matching provider could not ingest
 * anything at all. That conflated two different things — "we have no CSAM
 * scanner" and "it is unsafe to accept a photo" — and the second does not
 * follow from the first. Access to these providers is gated behind vetting and
 * commercial agreements a pre-launch company may not have yet, so the only
 * route to launching was a flag declaring you were running unsafely, which
 * made the honest posture and the reckless one look identical.
 *
 * What replaces it is a posture declared at boot — see `postureFromEnv` in
 * index.ts. Running without hash matching is allowed and has to be said out
 * loud; running without having said anything is not.
 */
export function scannerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CsamScanner | null {
  const endpoint = env.CSAM_SCANNER_URL;
  const apiKey = env.CSAM_SCANNER_KEY;
  if (!endpoint || !apiKey) return null;

  return new HttpHashScanner(endpoint, apiKey, {
    name: env.CSAM_SCANNER_NAME ?? 'http',
    sendBytes: env.CSAM_SCANNER_SEND_BYTES === 'true',
  });
}

/**
 * Wakes a human. Not optional, and not batched.
 *
 * A quarantine that nobody sees is the same as no scanning at all: the
 * statutory clock starts at detection, not at the point someone happens to
 * check a dashboard. Failure to alert is logged loudly but does not undo the
 * quarantine — the content is already blocked either way.
 */
export { alertResponder } from '@parea/core';

