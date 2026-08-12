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

import { ACCEPTED_MIME, ACCEPT_ATTRIBUTE, acceptedMime } from '../src/accepted';

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
