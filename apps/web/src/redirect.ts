/**
 * Where to go after signing in, if `next` says somewhere on this site.
 *
 * The check was "starts with one slash, not two", which the URL parser does
 * not agree with: `/\evil.com` and `/\t/evil.com` both start with a single
 * slash and both resolve to another host, because a backslash is read as a
 * slash and tabs are stripped. So a link that really was ours could deliver
 * somebody, freshly signed in, to a page made to look like it.
 *
 * Resolved the way the browser will resolve it, then kept only if it is still
 * here — and handed back as a path, so the answer cannot name a host at all.
 */
export function sameOriginPath(next: string | null, origin: string): string | null {
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
