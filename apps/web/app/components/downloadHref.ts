/**
 * A photo link that saves rather than opens.
 *
 * Photos come from the image host (img.parea.photos), not from this page's
 * origin, and browsers ignore `<a download>` on a link to another host: the
 * Download button opened the photo in a new page instead. The image Worker
 * sends it as an attachment when the URL carries `download=1` — outside the
 * signature, so the signed URL still verifies. A link that is not absolute
 * (a blob, or the same origin) is left as it is, where `download` works.
 */
export function downloadHref(src: string): string;
export function downloadHref(src: string | null | undefined): string | undefined;
export function downloadHref(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (!/^https?:\/\//.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}download=1`;
}
