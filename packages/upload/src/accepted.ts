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
 * ## Why these six
 *
 * Everything sharp can decode that a phone or a camera actually produces. HEIC
 * and HEIF because that is what an iPhone shoots; AVIF and WebP because that
 * is what modern Android increasingly shoots and what we ourselves emit.
 *
 * Adding to this list is not free: `services/deriver/test/accepted.test.ts`
 * checks every entry against sharp's own list of formats it can decode, in the
 * build that will actually run, so a type sharp cannot read fails there rather
 * than in production.
 *
 * ## GIF was the seventh, and it was removed for a reason worth keeping
 *
 * It was here "because it costs nothing to accept and someone will send one,
 * accepting that an animation becomes a still". That stopped being true.
 * libvips decodes GIF through its own `VipsForeignLoadNsgif`, and that loader
 * is one of three named in GHSA-f88m-g3jw-g9cj — where blocking it is the
 * advisory's *own* suggested workaround. So the price of the format was a
 * decoder kept alive for the least valuable thing on the list: a still frame
 * of an animation nobody asked us to keep animated.
 *
 * Dropping it is what lets `DECODERS` below be four names instead of five.
 */

export const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/avif',
] as const;

export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

/**
 * The libvips loaders that back `ACCEPTED_MIME`, and nothing else — §7.5.
 *
 * ## The problem this exists for
 *
 * `acceptedMime` above checks what a client *claims* it is sending. Nothing
 * checks what actually arrives: the presign route stores the declared type,
 * the bytes go straight to storage, and the deriver hands them to sharp. So
 * "we accept six formats" was a statement about a string in a JSON body, and
 * the real answer was "we decode whatever libvips can" — which in the prebuilt
 * binary is eighteen formats:
 *
 *     jpeg png webp tiff magick openslide dz ppm fits gif svg heif pdf
 *     vips jp2k jxl rad dcraw raw
 *
 * `magick` is the ImageMagick delegate. `svg` is librsvg, which parses XML.
 * `pdf` is poppler. None of them has ever had a path into this product, and
 * every one of them is a parser reachable by anybody who can upload a file
 * with a lying content type. Two of the four CVEs in the libvips advisory that
 * prompted this are in loaders — TIFF and VIPS — for formats we have never
 * accepted.
 *
 * ## Why a root to block and a list to unblock, rather than a list to block
 *
 * `sharp.block` blocks an operation *and its subclasses*, so blocking the base
 * class shuts every loader at once and the allow-list is what reopens four of
 * them. That direction is the whole point: a list of things to block is a list
 * that has to be updated when libvips gains a nineteenth format, and nobody
 * will. Blocking the root fails closed on a loader nobody has heard of yet,
 * which is the same rule `authorize()` applies to an unrecognised policy.
 *
 * AVIF is not missing from this list. It is HEIF — the container is the same
 * and `VipsForeignLoadHeif` is what reads both, which is also why dropping
 * AVIF support would not remove a decoder.
 */
export const DECODER_ROOT = 'VipsForeignLoad';

export const DECODERS = [
  'VipsForeignLoadJpeg',
  'VipsForeignLoadPng',
  'VipsForeignLoadWebp',
  // heic, heif and avif, all three.
  'VipsForeignLoadHeif',
] as const;

/**
 * The narrow interface this needs from sharp, so this package never imports it.
 *
 * `@parea/upload` is shared with the native client and is "deliberately free of
 * any platform import" — a `require('sharp')` here would put a native module in
 * a React Native bundle. Taking the two functions as an argument keeps the
 * *policy* in one place, next to the list it is derived from, and leaves the
 * importing to the two processes that actually decode.
 */
export type DecoderRegistry = {
  block(options: { operation: string[] }): void;
  unblock(options: { operation: string[] }): void;
};

/**
 * Shut every libvips loader, then reopen the four `ACCEPTED_MIME` needs.
 *
 * Call once per process, before anything decodes. Both callers do it at module
 * load rather than from a start-up hook: a hook is a thing that can be skipped
 * on a code path nobody thought about, and the cost of skipping it is the whole
 * decoder surface quietly back open.
 *
 * Ordering is the only subtlety, and it is not optional — the unblock has to
 * follow the block, because blocking the base class after reopening the leaves
 * would shut them again.
 *
 * Encoding is untouched. Blocking runs against `VipsForeignLoad`, and the save
 * path is `VipsForeignSave`, so the JPEG and AVIF this product writes are not
 * affected. Neither are the two non-loader inputs the deriver relies on —
 * `sharp({ create })` and raw pixel buffers reach libvips without a loader at
 * all. Both are asserted in `decoders.test.ts`.
 */
export function restrictDecoders(sharp: DecoderRegistry): void {
  sharp.block({ operation: [DECODER_ROOT] });
  sharp.unblock({ operation: [...DECODERS] });
}

/**
 * How large an image may be before it is refused as a decompression bomb.
 *
 * Shared, because it was one process's number and two processes needed it. The
 * deriver has always set it; `/api/account/avatar` and the event cover route
 * decode uploaded bytes in the web tier and set nothing, so they inherited
 * sharp's 268-megapixel default — roughly a gigabyte of raster inside a request
 * handler, for a picture that is about to be resized to 512 pixels.
 *
 * The number is the deriver's, and its reasoning is measured rather than
 * guessed — see `MAX_INPUT_PIXELS` at its old home in `derivatives.ts`, which
 * now imports this. A real upload arrived at 17000×17000: 289 megapixels, 1.7MB
 * on the wire, which is what a stitched panorama or a poster export looks like
 * and also exactly what an attack looks like. 400MP is bounded by the machine
 * the deriver runs on, not by taste.
 *
 * It is a ceiling rather than a target. A caller with a tighter bound of its
 * own should use that; nothing should use a looser one.
 */
export const MAX_INPUT_PIXELS = 400_000_000;

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

/**
 * What these bytes actually are, from their own header — or null.
 *
 * `acceptedMime` reads a claim. This reads the file. They answer the same
 * question from opposite ends, and the two routes that upload an image without
 * any claim at all — the avatar and the event cover, which take a bare
 * `arrayBuffer()` — have only this one.
 *
 * Deliberately a handful of byte comparisons rather than a decode. The point is
 * to refuse before libvips is handed anything: a magic-number check is a dozen
 * array reads in JavaScript, and everything it rejects is a parser that never
 * ran. `DECODERS` above is the second line, for a file whose header says JPEG
 * and whose body is something else — that one libvips has to open to discover,
 * and it will open it as a JPEG because that is all it is allowed to be.
 *
 * Not a validity check. A truncated JPEG passes here and fails in the decoder,
 * which is the right division: this says what kind of thing it claims to be by
 * construction, and sharp says whether it is a good one.
 */
export function sniffImageMime(bytes: Uint8Array): AcceptedMime | null {
  const at = (offset: number, ...expected: number[]): boolean =>
    expected.every((byte, i) => bytes[offset + i] === byte);

  // FF D8 FF. Every JPEG variant starts SOI followed by a marker.
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';

  // The eight-byte PNG signature, chosen by its designers to survive exactly
  // the transfer accidents that would otherwise corrupt it silently.
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';

  // RIFF....WEBP — a container with the size between the two tags.
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'image/webp';
  }

  /*
   * ISO base media format, which is HEIC, HEIF and AVIF all three.
   *
   * The brand at offset 8 is what separates them, and it is the only thing
   * that does — the container is identical, and an iPhone writes several
   * different brands depending on how the photograph was taken. Anything in
   * the family that is not an AVIF brand is reported as HEIC, because the
   * distinction downstream is which decoder reads it and that answer is the
   * same for all of them.
   */
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (HEIF_BRANDS.has(brand)) return 'image/heic';
    return null;
  }

  return null;
}

/**
 * The `ftyp` brands that mean "a still image libheif can read".
 *
 * Not every ISO-BMFF file is one — `isom` and `mp42` are video, and accepting
 * them here would hand an MP4 to a decoder that cannot read it and count the
 * bytes against somebody's quota on the way. Design §"Video" keeps video out
 * until there is a pipeline for it.
 */
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
]);


/**
 * How many files may be presigned in one request.
 *
 * Here for the same reason the mime list is here, and it is the same failure
 * one level along: the presign route bounded a batch at fifty and the queue
 * that calls it sent "the whole pending batch" in a single call, with no idea
 * a bound existed. Choose fifty-one photographs and the request was refused
 * whole — `parseFiles` answers null rather than a short list, before any row
 * is written — so every item failed, nothing reached storage, and the album
 * had no pending photographs to show for it. The person saw an album with a
 * cover and nothing in it.
 *
 * A rule stated in one place and enforced in another is a rule the two ends
 * eventually disagree about. Now the queue chunks by this and the route
 * refuses by this, and they cannot drift apart without the test noticing.
 *
 * Fifty is the route's own number, kept: it is an anti-catastrophe bound
 * rather than a product limit, and nothing about a person choosing two
 * hundred photographs should change it — that is what chunking is for.
 */
export const MAX_FILES_PER_PRESIGN = 50;
