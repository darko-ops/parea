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

/**
 * What a provider will take, when it is particular about it.
 *
 * Callers turn an image that falls outside these into one that does not — a
 * JPEG, within the size bounds — before scanning, because a provider that
 * refuses the format is a provider that never checked the photo. Absent means
 * the provider takes what it is given.
 */
export type ScanLimits = {
  /** MIME types sent as they are. Anything else is converted first. */
  types: readonly string[];
  maxBytes: number;
  /** Neither side may be shorter than this. */
  minSide: number;
};

export interface CsamScanner {
  readonly name: string;
  readonly limits?: ScanLimits;
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

/** Microsoft's Match endpoint. A regional host replaces it via CSAM_SCANNER_URL. */
export const PHOTODNA_ENDPOINT = 'https://api.microsoftmoderator.com/photodna/v1.0/Match';

/**
 * What PhotoDNA accepts: these five formats, up to 4 MB, at least 160 pixels a
 * side. Not HEIC — every iPhone photograph — and not WebP or AVIF, so those
 * are converted to JPEG before they are sent (see `ScanLimits`).
 */
export const PHOTODNA_LIMITS: ScanLimits = {
  types: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'],
  maxBytes: 4 * 1024 * 1024,
  minSide: 160,
};

/** Reads a field whatever its case: the service's JSON is PascalCase, and has not always been. */
function field(body: unknown, name: string): unknown {
  if (!body || typeof body !== 'object') return undefined;
  const key = Object.keys(body).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (body as Record<string, unknown>)[key];
}

/**
 * One PhotoDNA answer, read the same way from either endpoint.
 *
 * Only `Status.Code` 3000 is an answer; anything else is `ScanUnavailable`.
 * `fallbackTracking` is the request's own `TrackingId`, for an answer that
 * sits inside a list and carries none of its own.
 */
function readMatch(body: unknown, fallbackTracking?: unknown): ScanVerdict {
  const status = field(body, 'Status');
  const code = field(status, 'Code');
  if (code !== 3000) {
    const said = field(status, 'Description');
    throw new ScanUnavailable(
      `photodna status ${String(code)}${typeof said === 'string' ? `: ${said}` : ''}`,
    );
  }
  const isMatch = field(body, 'IsMatch');
  if (typeof isMatch !== 'boolean') {
    throw new ScanUnavailable('photodna answered 3000 without IsMatch');
  }
  if (!isMatch) return { match: false };

  // Which list it matched, and what it is — what the incident and the
  // NCMEC report need. `TrackingId` is the reference Microsoft asks for.
  const flags = field(field(body, 'MatchDetails'), 'MatchFlags');
  const list = Array.isArray(flags) ? flags : [];
  const violations = list.flatMap((f) => {
    const v = field(f, 'Violations');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  });
  const sources = list
    .map((f) => field(f, 'Source'))
    .filter((x): x is string => typeof x === 'string');
  const tracking = field(body, 'TrackingId') ?? fallbackTracking;
  return {
    match: true,
    classification:
      [...new Set(violations)].join(', ') || [...new Set(sources)].join(', ') || 'photodna match',
    providerReference: typeof tracking === 'string' ? tracking : undefined,
  };
}

/**
 * Microsoft PhotoDNA Cloud Service.
 *
 * The image itself goes in the body, as its own content type, with the
 * subscription key in `Ocp-Apim-Subscription-Key`. PhotoDNA hashes it on
 * Microsoft's side, perceptually, so a re-encoded or resized copy still
 * matches — which is what lets callers send a JPEG of a HEIC.
 *
 * Only `Status.Code` 3000 is an answer. Everything else — 3002 a bad request,
 * 3004 their error, 3206 not an image, 3208 out of size, an HTTP error, the
 * five-a-second rate limit, a body that is not what was expected — is
 * `ScanUnavailable`, which leaves the photo unpublished and retried rather
 * than waved through.
 */
export class PhotoDnaScanner implements CsamScanner {
  readonly name = 'photodna';
  readonly limits = PHOTODNA_LIMITS;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string = PHOTODNA_ENDPOINT,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async scan(input: ScanInput): Promise<ScanVerdict> {
    // The caller's job, checked here so a slip is a retry rather than a pass.
    if (!this.limits.types.includes(input.mime)) {
      throw new ScanUnavailable(`photodna does not accept ${input.mime}`);
    }
    if (input.bytes.length > this.limits.maxBytes) {
      throw new ScanUnavailable(`photodna limit is ${this.limits.maxBytes} bytes`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(this.endpoint);
      if (!url.searchParams.has('enhance')) url.searchParams.set('enhance', 'false');
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': input.mime,
          'Ocp-Apim-Subscription-Key': this.apiKey,
        },
        body: new Uint8Array(input.bytes),
      });
      if (!response.ok) {
        throw new ScanUnavailable(`photodna returned HTTP ${response.status}`);
      }

      return readMatch(await response.json());
    } catch (err) {
      if (err instanceof ScanUnavailable) throw err;
      throw new ScanUnavailable(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Microsoft's hash endpoint — the one the cloud service is approved for. */
export const PHOTODNA_HASH_ENDPOINT = 'https://api.microsoftmoderator.com/photodna/v1.0/MatchHash';

/**
 * Makes a PhotoDNA Edge Hash of an image, here, with Microsoft's SDK.
 *
 * The hash is what leaves this system instead of the photograph: about a
 * kilobyte, and not reversible into the image. Returns the base64 `PreHashV2`
 * value the service takes.
 *
 * Null for one answer only: the library's "Image is flat" (-7009). A
 * featureless picture — all black, all white, a lens cap — has no edges to
 * fingerprint, so there is nothing a hash list could match, and Microsoft's
 * own library declines to represent it. Every other failure throws, which the
 * scanner turns into `ScanUnavailable`: a photo that could not be hashed for
 * any other reason was not checked, and is not published.
 */
export interface EdgeHasher {
  hash(input: ScanInput): Promise<string | null>;
}

/**
 * The approved way to call PhotoDNA: an Edge Hash made here, sent to
 * `/MatchHash` as `[{ DataRepresentation: 'PreHashV2', Value }]` with the same
 * subscription key. The approval letter says the service is to be used this
 * way rather than with images.
 *
 * One hash per request, though five are allowed: each upload is scanned on
 * its own and must be decided on its own.
 *
 * The answer's shape is read leniently and decided strictly. It may be one
 * result, a list, or a list inside an object (`MatchResults`); whichever, the
 * one result for our one hash must say 3000 and carry `IsMatch`, or it is
 * `ScanUnavailable`. Confirm against the live service with the test hash in
 * the approval letter before relying on a new reading.
 */
export class PhotoDnaHashScanner implements CsamScanner {
  readonly name = 'photodna';
  readonly limits = PHOTODNA_LIMITS;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    private readonly hasher: EdgeHasher,
    private readonly endpoint: string = PHOTODNA_HASH_ENDPOINT,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async scan(input: ScanInput): Promise<ScanVerdict> {
    let value: string | null;
    try {
      value = await this.hasher.hash(input);
    } catch (err) {
      throw new ScanUnavailable(`photodna edge hash failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (value === null) {
      // Flat: nothing to fingerprint, so nothing to match. Said out loud, so a
      // run of them is visible rather than a quiet hole in the scanning.
      console.warn('photodna: image is flat (-7009); nothing to match, not sent');
      return { match: false };
    }
    if (!value) throw new ScanUnavailable('photodna edge hash was empty');
    return this.matchHash(value);
  }

  /** Asks about one hash already made — what the test hash in the approval letter is sent through. */
  async matchHash(value: string): Promise<ScanVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.apiKey,
        },
        body: JSON.stringify([{ DataRepresentation: 'PreHashV2', Value: value }]),
      });
      if (!response.ok) {
        throw new ScanUnavailable(`photodna returned HTTP ${response.status}`);
      }
      const body: unknown = await response.json();

      // A request-level failure, when the service says so outside the list.
      const outer = field(body, 'Status');
      if (outer !== undefined && field(outer, 'Code') !== 3000) return readMatch(body);

      const results = Array.isArray(body)
        ? body
        : (Object.values(body as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined);
      const one = results ? results[0] : body;
      if (results && results.length !== 1) {
        throw new ScanUnavailable(`photodna answered ${results.length} results for one hash`);
      }
      return readMatch(one, field(body, 'TrackingId'));
    } catch (err) {
      if (err instanceof ScanUnavailable) throw err;
      throw new ScanUnavailable(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The hash endpoint on the same host as `endpoint`, for a regional `CSAM_SCANNER_URL`. */
export function hashEndpointFor(endpoint: string | undefined): string {
  if (!endpoint) return PHOTODNA_HASH_ENDPOINT;
  return endpoint.replace(/\/Match(Hash)?\/?$/, '/MatchHash');
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
  /**
   * Microsoft's Edge Hash SDK, where this process has it. With one, PhotoDNA is
   * asked with a hash at `/MatchHash`, as approved; without, with the image at
   * `/Match`, which is how it ran before the SDK was wired in.
   */
  options: { edgeHasher?: EdgeHasher } = {},
): CsamScanner | null {
  const endpoint = env.CSAM_SCANNER_URL;
  const apiKey = env.CSAM_SCANNER_KEY;

  // PhotoDNA knows its own endpoint; CSAM_SCANNER_URL only moves it to a
  // regional host. A key alone is enough to turn it on.
  if (env.CSAM_SCANNER_PROVIDER === 'photodna') {
    if (!apiKey) return null;
    if (options.edgeHasher) return new PhotoDnaHashScanner(apiKey, options.edgeHasher, hashEndpointFor(endpoint));
    return new PhotoDnaScanner(apiKey, endpoint || PHOTODNA_ENDPOINT);
  }

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
