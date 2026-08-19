/**
 * What a crash report is allowed to say.
 *
 * Errors are reported to Sentry from the server, and an error report is mostly
 * a URL. In this product a URL is not a description of a page — it is
 * sometimes the key to one. `/e/<token>` *is* the credential (design §3): the
 * whole access model is that holding that link is what lets you in. A stack
 * trace carrying it into a third-party dashboard would put the album behind it
 * within reach of everyone who can read that dashboard, and it would do so
 * quietly, on the one path most likely to be throwing errors in the first
 * place — the one strangers arrive on.
 *
 * Presigned storage URLs are the same shape of mistake. They carry a signature
 * in the query string and are good for an hour, so one in a breadcrumb is an
 * hour's access to somebody's photograph.
 *
 * So this module is the single answer to "what may appear in a report", and it
 * is deliberately blunt: a path is reduced to its shape, and query strings are
 * dropped entirely rather than filtered key by key. An allowlist of safe
 * parameters would have to be updated every time a route gains one, and the
 * update that gets forgotten is the leak. Nothing here needs a query string to
 * be debuggable — knowing that `/e/[token]` threw is the whole signal, and
 * *which* token threw would not help anybody fix it.
 *
 * Kept in `src/` rather than beside the Sentry config because it is a rule
 * about this product's URLs, not a detail of a reporting vendor, and because a
 * test can then hold it to account without loading the SDK.
 */

/**
 * Path segments that are credentials rather than identifiers.
 *
 * `/e/<token>` only. `/event/<id>` is deliberately absent: an event id is not
 * a secret — every route behind one checks access again — and keeping ids
 * legible is most of what makes a report worth reading.
 */
const SECRET_PREFIXES = ['/e/'];

/** Anything with a signature in it, wherever it came from. */
const SIGNED = /[?&](x-amz-signature|x-amz-credential|signature|sig|token)=/i;

/**
 * One URL, reduced to what is safe to write down.
 *
 * Accepts absolute and relative URLs because reports contain both — a request
 * URL is absolute, a breadcrumb is often a path. Anything unparseable is
 * dropped rather than guessed at: a string this function does not understand
 * is a string it cannot promise anything about.
 */
export function redactUrl(url: string): string {
  if (!url) return url;

  // Parsed against a placeholder origin so a relative path is handled by the
  // same code as an absolute one; the placeholder is put back only if the
  // input had no origin of its own.
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://redacted.invalid');
  } catch {
    return '[unparseable]';
  }

  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
  let path = parsed.pathname;

  for (const prefix of SECRET_PREFIXES) {
    if (path.startsWith(prefix)) {
      // The shape, not the value. `/e/[token]` reads as a route rather than as
      // a redaction, which is what somebody scanning a list of errors wants.
      path = `${prefix}[token]`;
      break;
    }
  }

  // Every query string, not the signed ones only. See the header.
  return relative ? path : `${parsed.origin}${path}`;
}

/** Whether a string is a presigned storage URL, for callers that must drop it whole. */
export function isSignedUrl(url: string): boolean {
  return SIGNED.test(url);
}

/**
 * Walk a report and redact every URL-shaped value in it.
 *
 * Recursive and key-driven rather than a fixed list of paths into the event
 * shape, because the SDK's event schema is theirs and changes between
 * versions. A rule expressed as "wherever a key is called `url`" survives an
 * upgrade that moves where those keys live; a rule expressed as
 * `event.request.url` does not, and its failure is silent.
 *
 * Depth-limited so a cyclic or pathological object cannot hang the reporter —
 * a crash report is never worth a hung process.
 */
export function redactEvent<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactEvent(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && URLISH.test(key)) {
      out[key] = redactUrl(item);
    } else {
      out[key] = redactEvent(item, depth + 1);
    }
  }
  return out as T;
}

/**
 * Keys whose values are URLs.
 *
 * `referrer` is in here and matters: the site sends `Referrer-Policy:
 * no-referrer` precisely so a link token does not ride along to third parties,
 * and a report that carried one would be going around the header the rest of
 * the product relies on.
 */
const URLISH = /^(url|uri|referrer|referer|href|location|origin_url)$/i;
