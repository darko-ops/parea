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
export class UnconfiguredScanner implements CsamScanner {
  readonly name = 'unconfigured';

  async scan(): Promise<ScanVerdict> {
    throw new ScanUnavailable(
      'No child-safety scanner configured. Set CSAM_SCANNER_URL and ' +
        'CSAM_SCANNER_KEY, or CSAM_SCANNER=disabled to run without ingest ' +
        '(development only). See docs/csam-runbook.md.',
    );
  }
}

/**
 * Explicitly disabled.
 *
 * Separate from unconfigured so that "we chose to run without scanning" is a
 * deliberate, greppable act rather than something achieved by forgetting an
 * environment variable.
 *
 * Free in development. In production it additionally requires
 * `PAREA_ALLOW_UNSCANNED=private-deployment`, which exists for one situation:
 * a real deployment that only its author can reach, before launch, to shake
 * out the infrastructure. That is a reasonable thing to want, and the
 * alternative — telling someone to set NODE_ENV=development on a production
 * box — is worse, because it silently relaxes every other guard keyed off the
 * same variable.
 *
 * It is a named flag rather than a quiet one so that it shows up in a
 * deployment's environment, in `grep`, and in the boot banner below. The
 * moment anyone but the author can reach the deployment, it has to go.
 */
export const UNSCANNED_ACK = 'private-deployment';

export class DisabledScanner implements CsamScanner {
  readonly name = 'disabled';

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV === 'production' && env.PAREA_ALLOW_UNSCANNED !== UNSCANNED_ACK) {
      throw new Error(
        'CSAM_SCANNER=disabled needs PAREA_ALLOW_UNSCANNED=private-deployment ' +
          'in production, and is only appropriate for a deployment nobody else ' +
          'can reach. See docs/csam-runbook.md.',
      );
    }
    if (env.NODE_ENV === 'production') {
      console.warn(
        '\n' +
          '  ┌────────────────────────────────────────────────────────────┐\n' +
          '  │  RUNNING WITHOUT CHILD-SAFETY SCANNING                     │\n' +
          '  │  Every upload is published unchecked.                      │\n' +
          '  │  Only valid while nobody but you can reach this.           │\n' +
          '  └────────────────────────────────────────────────────────────┘\n',
      );
    }
  }

  async scan(): Promise<ScanVerdict> {
    return { match: false };
  }
}

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

export function scannerFromEnv(): CsamScanner {
  const mode = process.env.CSAM_SCANNER;
  if (mode === 'disabled') return new DisabledScanner();

  const endpoint = process.env.CSAM_SCANNER_URL;
  const apiKey = process.env.CSAM_SCANNER_KEY;
  if (endpoint && apiKey) {
    return new HttpHashScanner(endpoint, apiKey, {
      name: process.env.CSAM_SCANNER_NAME ?? 'http',
      sendBytes: process.env.CSAM_SCANNER_SEND_BYTES === 'true',
    });
  }
  return new UnconfiguredScanner();
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

