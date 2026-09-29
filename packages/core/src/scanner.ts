/**
 * Child-safety hash matching: the one client both the deriver and the web app
 * use — docs/design.md §13, docs/csam-runbook.md.
 *
 * It lived in the deriver, which was the only thing that scanned. The web app
 * stores four kinds of image itself — moments, group photos, profile pictures
 * and roll covers — and none of them passed through any check at all. Moving
 * the client here is what lets those routes ask the same provider the same
 * question, with the same refusal to read an outage as a clean result.
 *
 * Absent configuration is still a supported way to run: `scannerFromEnv`
 * returns null, and every caller treats null as "no hash matching in this
 * deployment", which the boot posture and the privacy page both say out loud.
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
    // With the image unless told otherwise. See `scannerFromEnv` for why the
    // fingerprint alone is not enough.
    this.sendBytes = options.sendBytes ?? true;
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
    /*
     * The image goes with the fingerprint unless someone says otherwise.
     *
     * This defaulted the other way, on the principle that a birthday party
     * should not leave the system if a fingerprint will do — and the principle
     * is right about *which* fingerprint. What the pipeline has is a SHA-256 of
     * the stripped bytes, and no known-CSAM list is keyed on that: a
     * cryptographic hash changes if a single byte does, and stripping metadata
     * changes several. So hash-only mode checked every photo against a list it
     * could never match, and said "no match" each time. The runbook said so;
     * the default ignored it. A provider that takes perceptual hashes computed
     * here is the way back to not sending bytes, and `false` is how to say so.
     */
    sendBytes: env.CSAM_SCANNER_SEND_BYTES !== 'false',
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
