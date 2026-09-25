/**
 * The web tier's one door to an image decoder — design §7.6.
 *
 * Two routes in this app turn bytes somebody uploaded into pixels: the profile
 * picture and the event cover. Neither goes through the deriver, and the
 * reasons are good ones written down where they happen — an avatar has one
 * size and no lightbox, and a cover chosen while making an event cannot wait
 * behind a queue of two hundred photographs.
 *
 * What they inherited by not going through the deriver was every protection
 * the deriver has. Both called `sharp()` directly with:
 *
 *   - no type check of any kind. `request.arrayBuffer()` went straight to the
 *     decoder, so `ACCEPTED_MIME` — the list whose own comment is about not
 *     being stated in more than one place — had no say here at all, and the
 *     real answer to "what can be uploaded to Parea" was "anything libvips can
 *     open", including TIFF, SVG, PDF and the ImageMagick delegate;
 *   - no `limitInputPixels`, so sharp's 268-megapixel default applied: about a
 *     gigabyte of raster inside a request handler, for a picture on its way to
 *     being 512 pixels wide. The deriver sets this on all eight of its calls
 *     and has a paragraph about why.
 *
 * So the two routes no longer import sharp. They import this, and this is the
 * only file in `apps/web` that is allowed to — `imaging-chokepoint.test.ts` fails
 * the build if that stops being true, for the same reason
 * `access-chokepoint.test.ts` exists: a rule that is only a comment is a rule
 * that gets forgotten by the next route, and the next route will not look
 * broken.
 */

import { MAX_INPUT_PIXELS, restrictDecoders, sniffImageMime } from '@parea/upload';
import type { AcceptedMime } from '@parea/upload';
import sharp, { type Sharp } from 'sharp';

/*
 * At module load, and this is the whole reason the routes import from here.
 *
 * The tempting home is `instrumentation.ts`, which is Next's hook for exactly
 * this. It is the wrong one: a hook runs if the runtime calls it, and what is
 * being protected here is the first decode on a cold serverless instance. Tying
 * it to the module the decoder lives in makes "sharp is loaded" and "sharp is
 * restricted" the same event, with no ordering to get wrong.
 */
restrictDecoders(sharp);

export { MAX_INPUT_PIXELS };

/** Why a decode was refused, in the form the routes answer with. */
export type DecodeRefusal =
  | { ok: false; error: 'empty'; status: 400 }
  | { ok: false; error: 'too_large'; status: 413 }
  | { ok: false; error: 'unsupported_type'; status: 415 };

export type DecodeAccepted = { ok: true; bytes: Buffer; mime: AcceptedMime };

/**
 * Everything that must be true before bytes reach a decoder.
 *
 * Size, then shape, in that order and deliberately: the cheapest refusal comes
 * first, and the type sniff reads a dozen bytes of a buffer that is already
 * known not to be absurd.
 *
 * The sniff is the part that matters. It reads the file's own header rather
 * than a declared content type, because these two routes have no declared
 * content type to read — and a header check is a handful of array comparisons
 * in JavaScript, so everything it refuses is a parser that never ran at all.
 * `restrictDecoders` above is the second line, for bytes that claim to be a
 * JPEG and are not: libvips has to open those to find out, and this is what
 * makes sure the only thing it is allowed to open them as is a JPEG.
 *
 * Returns the sniffed type as well as the bytes, because both callers want it
 * — one stores it, and both are better off naming the thing they accepted than
 * re-deriving it later.
 */
export function admit(
  incoming: Buffer,
  maxBytes: number,
): DecodeAccepted | DecodeRefusal {
  if (incoming.byteLength === 0) return { ok: false, error: 'empty', status: 400 };
  if (incoming.byteLength > maxBytes) {
    return { ok: false, error: 'too_large', status: 413 };
  }

  const mime = sniffImageMime(incoming);
  // 415 rather than 400: the request was well formed and the file was not the
  // kind of thing this accepts, which is a different sentence and one a client
  // can turn into "that is not a photo we can read".
  if (!mime) return { ok: false, error: 'unsupported_type', status: 415 };

  return { ok: true, bytes: incoming, mime };
}

/**
 * A sharp instance with this tier's bounds already on it.
 *
 * The single place `sharp()` is constructed in `apps/web`, so the two options
 * that must never be forgotten cannot be. `failOn: 'error'` matches what both
 * routes already passed; `limitInputPixels` is what neither did.
 *
 * `limitInputChannels` is not set and does not need to be — sharp 0.35 gives it
 * a default of 5, which is more than any photograph has and fewer than a
 * crafted multi-band TIFF would like.
 */
export function decode(bytes: Buffer): Sharp {
  return sharp(bytes, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  });
}
