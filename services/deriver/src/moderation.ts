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
 * The provider table.
 *
 * Same shape as the mail providers in @parea/core: each entry says how to ask
 * and how to read the answer, so choosing one is configuration and adding one
 * is an entry rather than a class. Nothing about this pipeline is specific to
 * a vendor, and the vendor most likely to change is this one — the market is
 * young and the product is not built on any of them.
 */
export type ModeratorProvider = {
  endpoint: string;
  /** `key` is whatever that provider's credential looks like. */
  request(input: ModerationInput, key: string): RequestInit;
  parse(body: unknown, threshold: number): ModerationVerdict;
};

export const MODERATORS: Record<string, ModeratorProvider> = {
  /**
   * The shape this seam was written against: JSON in, labels and a score out.
   * Kept because it is what a self-hosted classifier or a small wrapper would
   * naturally speak, and it is what the tests exercise.
   */
  generic: {
    endpoint: '',
    request: (input, key) => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        image: input.bytes.toString('base64'),
        mime: input.mime,
      }),
    }),
    parse: (body, threshold) => {
      const b = body as { labels?: unknown; score?: unknown };
      const labels = Array.isArray(b.labels)
        ? b.labels.filter((l): l is string => typeof l === 'string')
        : [];
      const score = typeof b.score === 'number' ? b.score : undefined;
      return {
        flagged: labels.length > 0 || (score !== undefined && score >= threshold),
        labels,
        score,
      };
    },
  },

  /**
   * Sightengine's nudity-2.1 model.
   *
   * Multipart rather than JSON, and the credential is `user:secret` because
   * that is what they issue. Confidences come back 0-1 per class and are
   * scaled to the 0-100 the column stores.
   *
   * Only the explicit classes count toward flagging. `suggestive` covers
   * bikinis, cleavage and bare male chests, which at an event photo product is
   * a beach holiday and a swimming pool — flagging those would bury the queue
   * in exactly the photos people are here to share. They are still recorded as
   * labels, so the decision can be revisited from real data rather than from
   * a guess.
   */
  sightengine: {
    endpoint: 'https://api.sightengine.com/1.0/check.json',
    request: (input, key) => {
      const [user, secret] = key.split(':');
      const form = new FormData();
      form.append('media', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'photo');
      form.append('models', 'nudity-2.1');
      form.append('api_user', user ?? '');
      form.append('api_secret', secret ?? '');
      // No content-type header: fetch sets the multipart boundary itself, and
      // setting it by hand produces a body the other end cannot parse.
      return { method: 'POST', body: form };
    },
    parse: (body, threshold) => {
      const nudity = (body as { nudity?: Record<string, unknown> }).nudity ?? {};
      const EXPLICIT = ['sexual_activity', 'sexual_display', 'erotica', 'sextoy'];
      const labels: string[] = [];
      let top = 0;
      for (const [name, value] of Object.entries(nudity)) {
        if (typeof value !== 'number' || name === 'none') continue;
        const score = Math.round(value * 100);
        if (score >= threshold && EXPLICIT.includes(name)) {
          labels.push(name);
          top = Math.max(top, score);
        }
      }
      return { flagged: labels.length > 0, labels, score: top || undefined };
    },
  },
};

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

  private readonly provider: ModeratorProvider;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    options: {
      name?: string;
      timeoutMs?: number;
      threshold?: number;
      provider?: string;
    } = {},
  ) {
    this.name = options.name ?? 'http-moderator';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.threshold = options.threshold ?? 80;
    this.provider = MODERATORS[options.provider ?? 'generic'] ?? MODERATORS.generic!;
  }

  async review(input: ModerationInput): Promise<ModerationVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        ...this.provider.request(input, this.apiKey),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ModerationUnavailable(`moderator returned ${response.status}`);
      }

      return this.provider.parse(await response.json(), this.threshold);
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
  // A named provider carries its own endpoint, so MODERATOR_URL is only
  // required for `generic` — and overrides the built-in one when set, which is
  // what a staging endpoint or a regional host needs.
  const named = MODERATORS[env.MODERATOR_PROVIDER ?? ''];
  const endpoint = env.MODERATOR_URL || named?.endpoint;
  const apiKey = env.MODERATOR_KEY;
  if (!endpoint || !apiKey) return null;

  const threshold = Number(env.MODERATOR_THRESHOLD);
  const provider = env.MODERATOR_PROVIDER ?? 'generic';
  return new HttpContentModerator(endpoint, apiKey, {
    name: env.MODERATOR_NAME ?? provider,
    provider,
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
