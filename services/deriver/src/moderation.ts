/**
 * Automated content classification — the other half of docs/csam-runbook.md.
 *
 * Deliberately not the same thing as the CSAM scanner beside it, and kept in
 * its own file so nobody reaches for one thinking they have the other.
 *
 * A classifier answers "does this look explicit?" with a probability, about
 * ordinary adult content, and its output routes a human's attention. A CSAM
 * scanner answers "does this match known child sexual abuse material?" against
 * curated hash lists, and its output starts a statutory clock. Nudity models
 * do not detect CSAM; a photo can be flagrant to one and invisible to the
 * other, in both directions. Substituting either for the other is the mistake
 * this separation exists to make impossible.
 *
 * Consequences differ accordingly. A scanner match quarantines immediately and
 * writes to `safety_incident`. A classifier flag writes to `moderation_flag`,
 * hides nothing, and waits for a person — because hiding on a probability
 * takes down swimwear at a rate no small team can review, and because a
 * classifier is here to order a queue rather than to decide anything.
 */

export type ModerationVerdict = {
  flagged: boolean;
  /** The provider's own labels. Recorded, never interpreted here. */
  labels: string[];
  /** 0-100 where the provider gives one, so rows stay comparable. */
  score?: number;
};

export type ModerationInput = {
  bytes: Buffer;
  mime: string;
};

export interface ContentModerator {
  readonly name: string;
  review(input: ModerationInput): Promise<ModerationVerdict>;
}

/**
 * Unlike a scanner outage, a classifier outage does not stop ingest.
 *
 * The distinction is deliberate. Failing closed on the CSAM scanner is what
 * stops unscanned material being served; failing closed on a nudity model
 * would stop a birthday party because a third-party endpoint was slow, and buy
 * nothing in exchange. A failed review is logged and the photo proceeds
 * unflagged, which is the same position as having no classifier at all.
 */
export class ModerationUnavailable extends Error {}

/**
 * A classifier over HTTP.
 *
 * Bytes, not hashes — the opposite of the CSAM path, and for a reason rather
 * than by oversight: a perceptual hash matches material someone has already
 * catalogued, while a classifier has to look at pixels it has never seen. There
 * is no fingerprint that would do.
 */
export class HttpContentModerator implements ContentModerator {
  readonly name: string;
  private readonly timeoutMs: number;
  private readonly threshold: number;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    options: { name?: string; timeoutMs?: number; threshold?: number } = {},
  ) {
    this.name = options.name ?? 'http-moderator';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.threshold = options.threshold ?? 80;
  }

  async review(input: ModerationInput): Promise<ModerationVerdict> {
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
          image: input.bytes.toString('base64'),
          mime: input.mime,
        }),
      });

      if (!response.ok) {
        throw new ModerationUnavailable(`moderator returned ${response.status}`);
      }

      const body = (await response.json()) as {
        labels?: unknown;
        score?: unknown;
      };

      const labels = Array.isArray(body.labels)
        ? body.labels.filter((l): l is string => typeof l === 'string')
        : [];
      const score = typeof body.score === 'number' ? body.score : undefined;

      // Flagged on either signal: a provider that returns labels without a
      // score, or a score without labels, must not read as clean.
      return {
        flagged: labels.length > 0 || (score !== undefined && score >= this.threshold),
        labels,
        score,
      };
    } catch (err) {
      if (err instanceof ModerationUnavailable) throw err;
      throw new ModerationUnavailable(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Null when none is configured, which is a supported way to run. */
export function contentModeratorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ContentModerator | null {
  const endpoint = env.MODERATOR_URL;
  const apiKey = env.MODERATOR_KEY;
  if (!endpoint || !apiKey) return null;

  const threshold = Number(env.MODERATOR_THRESHOLD);
  return new HttpContentModerator(endpoint, apiKey, {
    name: env.MODERATOR_NAME ?? 'http-moderator',
    threshold: Number.isFinite(threshold) ? threshold : undefined,
  });
}

/**
 * How this deployment reviews what people upload.
 *
 * One of these has to be true before a watcher will start, and the check
 * exists so that "we have not decided" cannot be the answer in production:
 *
 *   - `automated`  — a classifier is configured and flags for a human queue
 *   - `manual`     — a person reviews reports, on a documented SLA
 *
 * Hash matching is orthogonal and reported separately: it catches catalogued
 * material and says nothing about everything else, so having it does not
 * relieve a deployment of the question and lacking it does not stop one.
 */
export function postureFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; detail: string } {
  const declared = env.PAREA_MODERATION;
  const moderator = Boolean(env.MODERATOR_URL && env.MODERATOR_KEY);

  if (declared === 'automated') {
    return moderator
      ? { ok: true, detail: 'automated — classifier flags to a review queue' }
      : {
          ok: false,
          detail: 'FAILED — PAREA_MODERATION=automated but MODERATOR_URL/KEY are unset',
        };
  }
  if (declared === 'manual') {
    return {
      ok: true,
      detail: 'manual — reports reviewed by a person, SLA in docs/csam-runbook.md',
    };
  }
  return {
    ok: false,
    detail:
      'FAILED — set PAREA_MODERATION to automated or manual. See docs/csam-runbook.md.',
  };
}
