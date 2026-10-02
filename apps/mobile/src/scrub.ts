/**
 * What a crash report from the phone is allowed to say.
 *
 * The server's rule (`apps/web/src/redact.ts`), held on the device too: in
 * this product a link is a key. `/e/<token>` is the credential to an album
 * and the app carries the same token as `?t=` on every album call, so a
 * breadcrumb holding either would hand the album to anyone who can read the
 * crash dashboard. Blunt on purpose — every query string goes, `/e/…` keeps
 * only its shape, known secret-bearing keys are blanked whole, and anything
 * that looks like an email address or a phone number is masked wherever it
 * turns up, including inside an error message.
 *
 * Kept apart from the Sentry setup so a test can hold it to account without
 * loading a native SDK.
 */

const SECRET_KEYS = /^(link_?token|token|t|code|words|authorization|cookie|set-cookie|password|email|phone|body|data_url)$/i;
const URL_IN_TEXT = /\b((?:https?|parea):\/\/[^\s"'<>]+|\/(?:api|e|event|events|group|groups)\/[^\s"'<>]*)/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/** One URL or path, reduced to its shape: no query, no fragment, no link token. */
export function scrubUrl(url: string): string {
  const bare = url.split(/[?#]/)[0]!;
  return bare.replace(/\/e\/[^/\s]+/gi, '/e/[token]');
}

/** Any free text: URLs inside it scrubbed, emails and phone numbers masked. */
export function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (u) => scrubUrl(u))
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[number]');
}

/**
 * Walk a report — an event or a breadcrumb — and scrub every string in it.
 *
 * Key-driven and recursive rather than a list of paths into the SDK's event
 * shape, which is theirs and moves between versions. Depth-limited, because
 * a crash report is never worth a hang.
 */
export function scrub<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key) && item !== null && typeof item !== 'object') {
      out[key] = '[redacted]';
    } else if (key === 'user') {
      // Never who. The SDK leaves this empty unless told; this keeps it so.
      continue;
    } else {
      out[key] = scrub(item, depth + 1);
    }
  }
  return out as T;
}
