/**
 * Everything the server accepts, this build can actually decode.
 *
 * The presign endpoint's allow-list is a promise about what will work, made in
 * `apps/web` by code that has never met an image. The deriver is where it comes
 * true or does not, and the gap between the two is silent in the worst way: an
 * upload that the server accepted is stored, counted against the event's
 * quota, and marked `failed` minutes later by a process nobody is watching.
 * The photo never appears and nobody is told. That is exactly how video
 * survived in the allow-list — accepted by the server, undecodable here, and
 * invisible from both ends.
 *
 * So this decodes real bytes of every accepted type rather than consulting
 * `sharp.format`. The table is not the same question: it reports `heif: true`
 * for a build that reads AVIF and not HEVC, and HEVC is what every iPhone
 * shoots. `HEVC_HEIC_SAMPLE` exists for that reason and is reused here.
 *
 * A type added to `ACCEPTED_MIME` that this build cannot read fails here, in
 * CI, on the same libvips the deriver will run — which is the only place the
 * answer is real. It also fails if a deployment loses HEIC support, which is
 * the operational version of the same fault.
 */

import { ACCEPTED_MIME } from '@parea/upload';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { canDecode, canDecodeViaHeifConvert } from '../src/derivatives';
import { HEVC_HEIC_SAMPLE } from '../src/fixture';

/**
 * A small image of each accepted type.
 *
 * Synthesised where sharp can write the format, and taken from the fixture
 * where it cannot: HEVC encoding needs x265, which is not in any prebuilt
 * libvips, so a genuine `.heic` has to be a committed sample rather than
 * something this makes. `image/heif` shares it — the container is the same and
 * the coding is what differs, so a build that reads one reads the other.
 */
async function sample(mime: string): Promise<Buffer> {
  if (mime === 'image/heic' || mime === 'image/heif') return HEVC_HEIC_SAMPLE;

  const format = mime.slice('image/'.length);
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .toFormat(format as keyof sharp.FormatEnum)
    .toBuffer();
}

describe('accepted types', () => {
  it.each(ACCEPTED_MIME)('can be decoded: %s', async (mime) => {
    const bytes = await sample(mime);

    // The same two routes ingest uses, in the same order — sharp directly, or
    // libheif's converter for the HEVC that libvips will not touch. Asserting
    // sharp alone would fail on a correct deployment.
    const decoded =
      (await canDecode(bytes)) || (await canDecodeViaHeifConvert(bytes));

    expect(decoded, `${mime} is accepted by the server and cannot be read here`).toBe(
      true,
    );
  });

  it('does not accept anything the deriver has no pipeline for', () => {
    // Video is the specific thing that was here. Design §"Video" keeps it out
    // until photos work, because transcoding is a second pipeline — and until
    // there is one, accepting an MP4 is accepting bytes to store and never
    // show.
    for (const mime of ACCEPTED_MIME) {
      expect(mime.startsWith('image/'), `${mime} is not an image`).toBe(true);
    }
  });
});
