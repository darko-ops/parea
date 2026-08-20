/**
 * Names — docs/design.md §11.
 *
 * The vocabulary of image references and the rules for turning one into an
 * object key. Split from the signing half so that callers who only need to
 * *name* an object — the deriver, which writes them — do not drag Web Crypto
 * types into a plain Node build.
 *
 * There is exactly one copy of the key convention and both sides import it.
 * A private copy in the deriver would be a 404 nobody could explain.
 */

/*
 * `card` sits between `thumb` and `grid`, and it exists because of the gap
 * between them. A gallery tile is drawn around 240–290 CSS pixels, which on a
 * 2× screen is 480–580 device pixels: too big for the 320 and a quarter of the
 * 1280. Every album was fetching a 1280 to fill 540, or a 320 upscaled half
 * again, and neither is the picture at the size it is being shown.
 */
export const IMAGE_KINDS = ['thumb', 'card', 'grid', 'full', 'orig'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * The encoding, carried in the URL rather than negotiated on `Accept`.
 *
 * Content negotiation is the textbook answer and it is the wrong one here.
 * A response that varies by `Accept` needs the edge to key its cache on that
 * header, and if it does not, one viewer's AVIF is served to the next viewer
 * whose browser cannot decode it — an empty grid, for the ~6% of people on
 * iOS 15 or an old in-app webview. This product's links live in group chats,
 * so in-app webviews are not a rounding error.
 *
 * Distinct URLs make the cache key explicit and put the choice in the browser,
 * which is the only party that knows the truth about its own decoder.
 * `<source type="image/avif">` does the picking; nothing here or at the edge
 * does.
 */
export const IMAGE_FORMATS = ['jpeg', 'avif'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

const EXTENSION: Record<ImageFormat, string> = { jpeg: 'jpg', avif: 'avif' };
export const MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  avif: 'image/avif',
};

/**
 * Which sizes exist as AVIF.
 *
 * `full` deliberately does not. It is the member of the "download as JPEG"
 * archive (§7.7), so it has to be a JPEG — and it is a lightbox image seen one
 * at a time, where the bytes saved matter far less than in a 200-image grid.
 *
 * `card` does, and it is the one that matters most: it is what a gallery of
 * two hundred photographs actually serves.
 */
export const AVIF_KINDS: readonly ImageKind[] = ['thumb', 'card', 'grid'];

export function formatsFor(kind: ImageKind): readonly ImageFormat[] {
  return AVIF_KINDS.includes(kind) ? (['avif', 'jpeg'] as const) : (['jpeg'] as const);
}

export type ImageRef = {
  eventId: string;
  /** Hex content hash. The object key is derived from it, not carried. */
  hash: string;
  kind: ImageKind;
  /**
   * Encoding of the derivative. Ignored for `orig`, which is whatever the
   * camera produced; defaulted to jpeg so callers that predate AVIF still
   * name the object they always named.
   */
  format?: ImageFormat;
  /** The event's cap_epoch at mint time — see the note on rotation in ./index. */
  capEpoch: number;
};

/** The format a ref actually resolves to. `orig` is never re-encoded. */
export function formatOf(ref: ImageRef): ImageFormat {
  return ref.kind === 'orig' ? 'jpeg' : (ref.format ?? 'jpeg');
}

/** The URL path segment for a ref's encoding. */
export function extensionOf(ref: ImageRef): string {
  return EXTENSION[formatOf(ref)];
}

/** Reverses `extensionOf`. Null for anything this codebase does not write. */
export function formatFromExtension(ext: string): ImageFormat | null {
  return (
    (Object.keys(EXTENSION) as ImageFormat[]).find((f) => EXTENSION[f] === ext) ?? null
  );
}

/**
 * Where an event's current cap_epoch is recorded.
 *
 * The image Worker has no database, so rotation has to leave a trace it can
 * read. A dotted name cannot collide with a photo key, since those are always
 * a 64-character hex hash.
 *
 * Absent means "never rotated", i.e. epoch 1 — which is correct for every
 * event created before rotation existed, so no backfill is needed.
 */
export function epochMarkerKey(eventId: string): string {
  return `ev/${eventId}/.epoch`;
}

/**
 * Object key for a reference. Must match what the deriver writes.
 *
 * Derivatives are siblings of the original (`<key>.thumb.jpg`) rather than
 * children (`<key>/thumb.jpg`), because the latter makes the original's key a
 * directory prefix as well as an object — fine on S3, impossible on a
 * filesystem.
 */
export function objectKeyFor(ref: ImageRef): string {
  const base = `ev/${ref.eventId}/${ref.hash}`;
  if (ref.kind === 'orig') return base;
  return derivativeKeyFrom(base, ref.kind, formatOf(ref));
}

/** The same, for the deriver, which holds the parts loose rather than as a ref. */
export function derivativeKey(
  eventId: string,
  hash: string,
  kind: ImageKind,
  format: ImageFormat,
): string {
  return objectKeyFor({ eventId, hash, kind, format, capEpoch: 0 });
}

/**
 * A derivative's key given the original's, which is what callers holding a
 * `photo.storage_key` have. The single place the suffix is spelled.
 */
export function derivativeKeyFrom(
  originalKey: string,
  kind: ImageKind,
  format: ImageFormat,
): string {
  return `${originalKey}.${kind}.${EXTENSION[format]}`;
}

/**
 * Every derivative an original can own — what a purge has to delete.
 *
 * Derived from the format table rather than listed, because a hand-kept list
 * silently stopped covering AVIF the day AVIF was added, and the symptom of
 * an incomplete purge is a storage bill with no explanation attached.
 */
export function allDerivativeKeysFor(originalKey: string): string[] {
  return IMAGE_KINDS.filter((kind) => kind !== 'orig').flatMap((kind) =>
    formatsFor(kind).map((format) => derivativeKeyFrom(originalKey, kind, format)),
  );
}
