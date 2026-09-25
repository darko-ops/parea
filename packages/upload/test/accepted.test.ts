/**
 * What may be uploaded, and the normalising that goes with it.
 *
 * The list itself is checked against reality in
 * `services/deriver/test/accepted.test.ts`, which decodes real bytes of every
 * entry with the same libvips ingest will use. What is left here is the string
 * handling, which is where the quiet bugs are: a client that sends
 * `IMAGE/JPEG` is not sending a different format, and a row whose `mime`
 * column holds a second spelling of a type is a row every later comparison has
 * to remember to normalise.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_MIME,
  ACCEPT_ATTRIBUTE,
  acceptedMime,
  sniffImageMime,
} from '../src/accepted';

describe('acceptedMime', () => {
  it.each(ACCEPTED_MIME)('accepts %s', (mime) => {
    expect(acceptedMime(mime)).toBe(mime);
  });

  it('refuses video, which nothing downstream can process', () => {
    // The specific bug this list exists to have fixed: accepted by the server,
    // stored, quota'd, then marked failed by the deriver with nobody told.
    expect(acceptedMime('video/mp4')).toBeNull();
    expect(acceptedMime('video/quicktime')).toBeNull();
  });

  it('refuses the rest of image/*, which is a superset of what works', () => {
    // Why the file input names concrete types instead of `image/*`.
    expect(acceptedMime('image/tiff')).toBeNull();
    expect(acceptedMime('image/bmp')).toBeNull();
    expect(acceptedMime('image/svg+xml')).toBeNull();
  });

  it('returns one spelling whatever the client sends', () => {
    // Browsers are inconsistent about case and about appending parameters.
    // The return value is what gets stored and presigned, so it has to be the
    // canonical form rather than whatever arrived.
    expect(acceptedMime('IMAGE/JPEG')).toBe('image/jpeg');
    expect(acceptedMime('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(acceptedMime('  image/HEIC  ')).toBe('image/heic');
  });

  it('refuses nonsense without throwing', () => {
    for (const value of ['', ';', 'image/', 'not a mime type', 'image/jpeg/extra']) {
      expect(acceptedMime(value)).toBeNull();
    }
  });
});

describe('the accept attribute', () => {
  it('offers exactly what the server will take', () => {
    // A picker that shows a file the next screen rejects is worse than one
    // that does not show it — and here it is worse still, because the presign
    // endpoint refuses the whole batch rather than the one file.
    expect(ACCEPT_ATTRIBUTE.split(',')).toEqual([...ACCEPTED_MIME]);
  });
});

/**
 * Reading the file rather than the claim.
 *
 * `acceptedMime` above is the claim; this is the file. The two routes that
 * upload a picture with no declared content type at all — the profile picture
 * and the event cover, which take a bare `arrayBuffer()` — have only this one,
 * and before it existed they had neither: bytes went straight to libvips,
 * which will open eighteen formats.
 *
 * Every sample here is a real header rather than a fixture file, because the
 * thing being tested is byte offsets and there is nothing else to get wrong.
 */
describe('sniffImageMime', () => {
  const header = (...bytes: number[]) => new Uint8Array([...bytes, ...new Array(24).fill(0)]);
  const ftyp = (brand: string) =>
    new Uint8Array([
      0, 0, 0, 0x18,
      ...[...'ftyp'].map((c) => c.charCodeAt(0)),
      ...[...brand].map((c) => c.charCodeAt(0)),
      ...new Array(12).fill(0),
    ]);

  it('reads a JPEG', () => {
    expect(sniffImageMime(header(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('reads a PNG', () => {
    expect(
      sniffImageMime(header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe('image/png');
  });

  it('reads a WebP, whose tag is split across the size field', () => {
    const webp = new Uint8Array([
      ...[...'RIFF'].map((c) => c.charCodeAt(0)),
      0x20, 0, 0, 0,
      ...[...'WEBP'].map((c) => c.charCodeAt(0)),
      ...new Array(12).fill(0),
    ]);
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it.each(['heic', 'heix', 'hevc', 'mif1', 'msf1'])(
    'reads the HEIF brand %s as heic',
    (brand) => {
      expect(sniffImageMime(ftyp(brand))).toBe('image/heic');
    },
  );

  it.each(['avif', 'avis'])('reads the AVIF brand %s', (brand) => {
    expect(sniffImageMime(ftyp(brand))).toBe('image/avif');
  });

  /*
   * The whole point, stated as its own case.
   *
   * These are the formats libvips will happily decode and this product has
   * never accepted. A `null` here is a parser that does not run.
   */
  it('refuses what the product does not accept', () => {
    // GIF — removed from the list, and its loader blocked with it.
    expect(sniffImageMime(header(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBeNull();
    // TIFF, little- and big-endian.
    expect(sniffImageMime(header(0x49, 0x49, 0x2a, 0x00))).toBeNull();
    expect(sniffImageMime(header(0x4d, 0x4d, 0x00, 0x2a))).toBeNull();
    // PDF.
    expect(sniffImageMime(header(0x25, 0x50, 0x44, 0x46))).toBeNull();
    // SVG is not even binary — it has no magic number to match.
    expect(sniffImageMime(new TextEncoder().encode('<svg xmlns="..."></svg>'))).toBeNull();
  });

  /*
   * An MP4 is an ISO-BMFF file exactly as a HEIC is, and the brand is the only
   * thing that separates them. Accepting one would store a video, count it
   * against somebody's quota, and hand it to a decoder that cannot read it.
   */
  it('refuses video brands in the same container family', () => {
    for (const brand of ['isom', 'mp42', 'qt  ']) {
      expect(sniffImageMime(ftyp(brand)), `${brand} is video`).toBeNull();
    }
  });

  it('refuses bytes too short to carry a header', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});
