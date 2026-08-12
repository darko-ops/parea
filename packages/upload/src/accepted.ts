/**
 * What may be uploaded — one list, because there were three.
 *
 * The server's presign allow-list, the web file input's `accept` attribute and
 * the native picker's media types are all answers to the same question, and
 * they had drifted into three different answers. That is the failure this
 * repository keeps finding: a rule stated in several places is a rule that is
 * eventually enforced in one of them.
 *
 * ## Photos only
 *
 * All three used to permit video, and nothing downstream can process one. The
 * deriver builds AVIF, WebP and JPEG renditions with sharp; handed an MP4 it
 * marks the photo `failed`, so the upload succeeds, the bytes are paid for and
 * stored, the row counts against the event's quota, and the photo simply never
 * appears. Nobody is told. Refusing in the picker — and refusing again here,
 * for a client that did not — is the difference between "you cannot choose
 * that" and a photo that quietly does not exist.
 *
 * Design §"Video" is where this is settled: video is a candidate paywall, and
 * "transcoding is a second pipeline and should stay out until photos work".
 * The bounds in the presign route still assume video (200MB a file, and an
 * event byte cap sized so it "binds first for anyone uploading video"), which
 * is fine — they are anti-catastrophe bounds, not a promise.
 *
 * ## Why these seven
 *
 * Everything sharp can decode that a phone or a camera actually produces. HEIC
 * and HEIF because that is what an iPhone shoots; AVIF and WebP because that
 * is what modern Android increasingly shoots and what we ourselves emit; GIF
 * because it costs nothing to accept and someone will send one, accepting that
 * an animation becomes a still.
 *
 * Adding to this list is not free: `services/deriver/test/accepted.test.ts`
 * checks every entry against sharp's own list of formats it can decode, in the
 * build that will actually run, so a type sharp cannot read fails there rather
 * than in production.
 */

export const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

/**
 * For a file input's `accept`.
 *
 * The concrete types rather than `image/*`, because `image/*` is a superset of
 * this list — it offers TIFF, BMP and SVG, each of which the presign endpoint
 * then refuses. A picker that lets you choose a file the next screen rejects
 * is worse than one that does not show it.
 */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME.join(',');

/**
 * The canonical form of an accepted type, or null.
 *
 * Returns the normalised string rather than a boolean because the caller
 * always wants it: whatever the client sent is stored on the row and handed to
 * the presigner as the object's content type, and `IMAGE/JPEG` or
 * `image/jpeg; charset=binary` stored verbatim is a value every later
 * comparison has to remember to normalise too. Normalising once, here, means
 * the database only ever holds one spelling of each type.
 *
 * Case-insensitive and parameter-tolerant because browsers are not consistent
 * about either.
 */
export function acceptedMime(type: string): AcceptedMime | null {
  const bare = type.split(';')[0]!.trim().toLowerCase();
  return (ACCEPTED_MIME as readonly string[]).includes(bare)
    ? (bare as AcceptedMime)
    : null;
}
