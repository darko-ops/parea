/**
 * The decoder allow-list, asserted against the build that will actually run.
 *
 * `accepted.test.ts` next door proves that everything the server accepts can be
 * decoded here. This is the other direction and the one that was missing:
 * everything the server does *not* accept must not be decodable here either.
 *
 * The gap it closes was real and quiet. `acceptedMime` checks a string in a
 * JSON body; nothing checked the bytes. So a client could declare `image/jpeg`,
 * upload a TIFF, an SVG or a PDF, and the deriver would hand it to libvips —
 * which in the prebuilt binary carries eighteen format loaders, including the
 * ImageMagick delegate and poppler. Two of the four CVEs in the libvips
 * advisory that prompted this work are in loaders for formats this product has
 * never accepted.
 *
 * Importing `../src/derivatives` is what applies the restriction: it calls
 * `restrictDecoders` at module load, which is the property being tested as
 * much as the list is. If that call is ever moved somewhere a command can skip,
 * these refusals become decodes.
 */

import { ACCEPTED_MIME, DECODERS, DECODER_ROOT } from '@parea/upload';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

// Side-effecting import. `restrictDecoders(sharp)` runs at the top of this
// module, and every assertion below depends on it having done so.
import '../src/derivatives';

const px = (format: 'jpeg' | 'png' | 'webp' | 'tiff' | 'gif') =>
  sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .toFormat(format)
    .toBuffer();

async function decodes(bytes: Buffer): Promise<boolean> {
  try {
    await sharp(bytes).metadata();
    return true;
  } catch {
    return false;
  }
}

describe('decoder allow-list', () => {
  /*
   * Encoding is not affected, and this is asserted first because everything
   * below depends on being able to make a sample.
   *
   * The block runs against `VipsForeignLoad`; saving is `VipsForeignSave` and
   * is a different class tree. If that ever stopped being true the product
   * would lose the ability to write a derivative, which is a far louder
   * failure than losing the ability to read a TIFF — so it is worth its own
   * line rather than being implied by the tests passing.
   */
  it('still encodes every format this product writes', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      await expect(px(format)).resolves.toBeInstanceOf(Buffer);
    }
  });

  it('decodes the formats the server accepts', async () => {
    // AVIF and HEIC are covered by `accepted.test.ts`, which has a real HEVC
    // sample; they share `VipsForeignLoadHeif` with each other and there is no
    // way to encode one here without x265.
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      expect(await decodes(await px(format)), `${format} must decode`).toBe(true);
    }
  });

  it('refuses TIFF and GIF, whose loaders the advisory names', async () => {
    // Both samples are made before the refusal is checked, and both encode
    // fine — which is the point: these are valid files of their format, and
    // the refusal is a policy rather than a parse failure.
    for (const format of ['tiff', 'gif'] as const) {
      expect(await decodes(await px(format)), `${format} must not decode`).toBe(false);
    }
  });

  it('refuses SVG, which is an XML parser reachable by upload', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
        '<rect width="8" height="8" fill="#888"/></svg>',
    );
    expect(await decodes(svg)).toBe(false);
  });

  /*
   * The two ways bytes reach libvips without a loader, both of which ingest
   * depends on and neither of which may be caught by the block.
   *
   * `decodeShared` turns the original into raw pixels once and builds every
   * derivative from that buffer; `canEncodeAvif` in the boot probe synthesises
   * an image with `create`. Blocking the loader root must not touch either,
   * and the failure if it did would be every photograph failing to derive.
   */
  it('leaves the non-loader input paths alone', async () => {
    const raw = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#888' },
    })
      .raw()
      .toBuffer({ resolveWithObject: true });

    await expect(
      sharp(raw.data, {
        raw: { width: raw.info.width, height: raw.info.height, channels: 3 },
      })
        .jpeg()
        .toBuffer(),
    ).resolves.toBeInstanceOf(Buffer);
  });

  /*
   * The list and the allow-list cannot drift apart.
   *
   * Not a decode test — a spelling test. `sharp.block` silently accepts an
   * operation name that names nothing, so a typo in `DECODERS` would leave
   * that loader blocked and the symptom would be every photograph of that
   * type failing in production with "unsupported image format". Checking the
   * count against `ACCEPTED_MIME` catches the other direction: a seventh type
   * added to the list without a decoder to read it.
   */
  it('has one decoder for each family the server accepts', () => {
    const families = new Set(
      ACCEPTED_MIME.map((mime) =>
        mime === 'image/heic' || mime === 'image/heif' || mime === 'image/avif'
          ? 'heif'
          : mime.slice('image/'.length),
      ),
    );
    expect(DECODERS).toHaveLength(families.size);
    for (const name of DECODERS) {
      expect(name.startsWith(DECODER_ROOT), `${name} is not a ${DECODER_ROOT}`).toBe(
        true,
      );
    }
  });
});
