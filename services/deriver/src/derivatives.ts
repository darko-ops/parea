/**
 * Derivative generation — docs/design.md §7.7.
 *
 * Unlike the original, derivatives are re-encoded — that is what they are for.
 * Four sizes, and the largest one earns its place twice: it backs the lightbox
 * *and* it is the "download as JPEG" option, so an Android recipient handed a
 * folder of iPhone HEICs has something their gallery can open.
 *
 * The three smaller sizes are encoded twice, AVIF and JPEG. Both are stored and
 * the browser picks with `<picture>`; see §11 for why that beats negotiating on
 * `Accept`. `full` stays JPEG-only — it is an archive member, and it has to
 * stay one.
 *
 * `card` is the newest and the one the gallery actually serves. Adding it cost
 * two encodes per photograph at ingest; what it saved is every event fetching
 * a 1280 to fill a 540-pixel slot.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp, { type Sharp } from 'sharp';

import { MIME, formatsFor, type ImageFormat } from '@parea/urls';
import { MAX_INPUT_PIXELS, restrictDecoders } from '@parea/upload';

/*
 * Shut every decoder this product does not accept, before anything decodes.
 *
 * At module load rather than from the entrypoint, because this file is the one
 * that owns sharp: every command — `probe`, `once`, `watch`, `serve`,
 * `backfill` — reaches a decode through here, and a call sited in `index.ts`
 * would be a call that a fifth command could be written without. The list and
 * the reasoning are in `@parea/upload`, next to the MIME types they are
 * derived from.
 */
restrictDecoders(sharp);

const run = promisify(execFile);

export const DERIVATIVES = [
  { kind: 'thumb', edge: 320, quality: 72 },
  /*
   * The gallery's own size. A tile is 240–290 CSS pixels, so a 2× screen wants
   * 480–580 and a 3× phone in a two-column grid wants about 570 — 640 covers
   * all of them without the 1280 they were being sent instead.
   *
   * Quality a notch above `thumb`: this one is looked at rather than glanced
   * at, and it is the size at which most people ever see most photographs in
   * this product.
   */
  { kind: 'card', edge: 640, quality: 76 },
  { kind: 'grid', edge: 1280, quality: 78 },
  { kind: 'full', edge: 2560, quality: 85 },
] as const;

export type DerivativeKind = (typeof DERIVATIVES)[number]['kind'];

/**
 * AVIF quality runs lower than JPEG for comparable output — the scales are not
 * the same scale — so this is a subtraction rather than a second table, which
 * would drift the moment someone tuned one and not the other.
 */
const AVIF_QUALITY_OFFSET = 12;

/**
 * How hard libaom searches. Measured, not guessed.
 *
 * At libvips' default of 4, a 1280px AVIF encode took ~5.6s against ~185ms for
 * the JPEG of the same image on the CI machine. The deriver is a single
 * machine that cannot be scaled out yet (two would race on the same pending
 * rows), so a 250-photo event would spend an extra twenty-odd minutes in
 * ingest — for a file the viewer sees only after ingest completes.
 *
 * At effort 2 the same encode took ~0.7s. Slower than JPEG, cheap enough to
 * pay per photo. If the deriver ever scales out, raising this is the first
 * thing worth revisiting.
 */
const AVIF_EFFORT = 2;

/**
 * Which quality metric the AVIF encoder is tuned against. Named, because it
 * used to be nobody's decision and is now somebody's.
 *
 * sharp 0.35 retuned lossy AVIF to SSIMULACRA2-based `iq` metrics and made
 * that the default. The number in `AVIF_QUALITY_OFFSET` was picked against the
 * old scale, so the upgrade would have kept the same code, the same constant
 * and the same comment, and quietly changed what all three meant.
 *
 * Measured on the upgrade, encoding one 1600×1200 source at the three sizes
 * this product actually emits, at the qualities it actually uses:
 *
 *   size        0.34.5     auto / iq      psnr       ssim
 *   thumb 320     6537     6835  (+5%)    6591       6606
 *   card  640    26197    29995 (+14%)   26228      26196
 *   grid 1280   100128   120550 (+20%)  100131      99879
 *
 * `auto` is not a small change. A fifth more bytes on the size the gallery
 * serves is a fifth more R2 storage and a fifth more of every grid, bought
 * without anybody choosing it — and bought during a security patch, which is
 * the worst moment to also change what the output looks like.
 *
 * So `psnr` holds the calibration the offset was chosen against, to within one
 * percent at every size. That makes this upgrade a security upgrade and
 * nothing else.
 *
 * Revisiting it is real work and worth doing separately: `iq` is a better
 * metric, and the honest version of adopting it is re-deriving the three
 * quality numbers against it rather than keeping numbers that were tuned for
 * a different scale. Until then the offset below keeps meaning what it says.
 */
const AVIF_TUNE = 'psnr' as const;

/**
 * Apply this product's encoder settings to a resized pipeline.
 *
 * Exported, and that is the point of it existing rather than being three lines
 * inline. `derivatives.test.ts` builds a reference encode to compare the shared
 * decode against, and it was restating these settings as literals — `quality:
 * spec.quality - 12, effort: 2` — which is the same numbers written down twice
 * and the failure this repository keeps finding.
 *
 * It found it again here. Adding `tune` above changed production and not the
 * copy, so the test compared a psnr-tuned encode against an iq-tuned one and
 * reported the difference as the *shared decode* drifting — an assertion about
 * one thing failing because of another, which is the worst kind of red test to
 * be handed. The tolerance was not the problem and raising it would have hidden
 * a real comparison.
 *
 * So there is one statement of what an encode is, and both callers make it.
 */
export function encodeAs(
  pipeline: Sharp,
  quality: number,
  format: ImageFormat,
): Sharp {
  return format === 'avif'
    ? pipeline.avif({
        quality: quality - AVIF_QUALITY_OFFSET,
        effort: AVIF_EFFORT,
        tune: AVIF_TUNE,
      })
    : pipeline.jpeg({ quality, mozjpeg: true });
}

/**
 * How large an image may be before it is refused as a decompression bomb.
 *
 * sharp defaults to 268,402,689 pixels, and a real upload hit it: a 17000×17000
 * PNG, 1.7MB on the wire and 289 megapixels once decoded, which failed with
 * `Input image exceeds pixel limit` and stayed failed. That file is not an
 * attack — a highly compressible image at absurd dimensions is what a poster
 * export or a stitched panorama looks like — but the ratio is exactly what an
 * attack looks like too, which is why the limit exists and why it stays.
 *
 * 400MP rather than `false`: a ceiling that can be reasoned about beats none.
 * The number is bounded by memory, not by taste — see the machine size in
 * fly.toml, which had to grow alongside it. libvips streams and works in
 * tiles, so a resize does not hold the full raster, but the decoders do not
 * all stream and the headroom has to exist.
 *
 * Raising this without raising the machine turns a clean per-photo failure
 * into an OOM kill, which takes ingest down for every photo rather than one.
 *
 * The number moved to `@parea/upload` when the two web routes that decode an
 * uploaded picture — the avatar and the event cover — turned out to set no
 * limit at all. The reasoning above is still this file's; the value is now
 * shared so there is one of it.
 */
export { MAX_INPUT_PIXELS };

export type Derivative = {
  kind: DerivativeKind;
  format: 'jpeg' | 'avif';
  bytes: Buffer;
  width: number;
  height: number;
  mime: string;
};

export async function buildDerivatives(
  input: Buffer,
  /**
   * Which sizes to make. Every one by default, which is what ingest wants.
   *
   * Narrowed only by the backfill, which is filling a gap in a photograph that
   * already has the others — re-encoding the three it has would rewrite three
   * objects to change nothing.
   */
  only?: readonly DerivativeKind[],
): Promise<Derivative[]> {
  try {
    return await encodeAll(input, only);
  } catch (err) {
    // sharp's prebuilt libvips parses the HEIF container but has no HEVC
    // decoder, so `metadata()` succeeds on an iPhone photo and decoding it
    // fails with "bad seek". libheif with libde265 can decode it, so convert
    // to a raster sharp can definitely read and retry once.
    const raster = await heifConvert(input).catch(() => null);
    if (!raster) throw err;
    return encodeAll(raster, only);
  }
}

/**
 * How large a decoded original may be held in memory to share between sizes.
 *
 * Sharing the decode is worth about a third of the encode time of a phone
 * photograph — 2.2s against 1.5s for one 12MP JPEG's seven derivatives,
 * interleaved best-of-three on the machine this was written on — and it costs
 * holding the raster for as long as they take. 36MB for that photo is the
 * trade worth taking.
 *
 * `MAX_INPUT_PIXELS` is 400MP, and 1.2GB of raster to save a second is not.
 * libvips streams and works in tiles, so decoding per derivative never holds
 * the whole thing; for the stitched panoramas and poster exports up at that
 * limit it is the only way that fits on the machine at all.
 */
const MAX_SHARED_RAW_BYTES = 128 * 1024 * 1024;

/**
 * The original decoded once, or null when it must not be.
 *
 * `encodeAll` built a fresh `sharp(input)` per derivative, so the original was
 * decoded seven times over — and for an iPhone HEIC that has been through
 * `heifConvert`, the thing being decoded seven times is a full-size PNG.
 *
 * Raw pixels rather than `clone()`, which shares the input but still re-runs
 * the loader. The result is pixel-for-pixel what decoding per derivative
 * produced — checked against sRGB, Display P3, RGBA, greyscale and
 * EXIF-rotated sources — because sharp neither imports nor embeds an ICC
 * profile on this path either way, and `rotate()` reads the orientation of the
 * original, which is where it still happens.
 *
 * Two sources are not equivalent through a raw round trip, and they are why
 * this returns null rather than always sharing:
 *
 *   - deeper than 8 bits a channel. `.raw()` writes `uchar` and raw input
 *     cannot be told otherwise, so a 16-bit PNG would lose its low bits before
 *     the resize instead of after it. No phone produces one, and a rounding
 *     difference is not worth a second.
 *   - too large to hold — see `MAX_SHARED_RAW_BYTES`.
 */
async function decodeShared(input: Buffer): Promise<{
  data: Buffer;
  raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
} | null> {
  // Header only, and tolerant: anything this cannot read is something the
  // per-derivative path should have its own go at — including the HEVC HEIC
  // that `buildDerivatives` rescues with libheif.
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null);
  if (!meta || meta.depth !== 'uchar') return null;
  if (!meta.width || !meta.height || !meta.channels) return null;
  if (meta.width * meta.height * meta.channels > MAX_SHARED_RAW_BYTES) return null;

  const { data, info } = await sharp(input, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    // Bakes in EXIF orientation, so viewers do not have to honour it. Raw
    // pixels carry no orientation tag, which is the point.
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels as 1 | 2 | 3 | 4,
    },
  };
}

async function encodeAll(
  input: Buffer,
  only?: readonly DerivativeKind[],
): Promise<Derivative[]> {
  const out: Derivative[] = [];
  const shared = await decodeShared(input);

  for (const spec of DERIVATIVES) {
    if (only && !only.includes(spec.kind)) continue;
    for (const format of formatsFor(spec.kind)) {
      const source = shared
        ? sharp(shared.data, { raw: shared.raw, limitInputPixels: MAX_INPUT_PIXELS })
        : sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
            // Bakes in EXIF orientation, so viewers do not have to honour it;
            // `decodeShared` does the same on its way to raw pixels. Either
            // way the derivative carries no metadata of its own — a thumbnail
            // has no business holding the original's tags.
            .rotate();

      const resized = source.resize({
        width: spec.edge,
        height: spec.edge,
        fit: 'inside',
        withoutEnlargement: true,
      });

      const encoded = encodeAs(resized, spec.quality, format);

      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      out.push({
        kind: spec.kind,
        format,
        bytes: data,
        width: info.width,
        height: info.height,
        mime: MIME[format],
      });
    }
  }

  return out;
}

/**
 * Decode via libheif's CLI. The intermediate PNG is lossless, so derivatives
 * are no worse than if sharp had decoded directly; it costs one extra process
 * and one temp file per HEIC.
 *
 * Requires `libheif-examples` and an HEVC decoder plugin
 * (`libheif-plugin-libde265`) — see the Dockerfile.
 */
async function heifConvert(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'heif-'));
  try {
    const src = join(dir, 'in.heic');
    const dst = join(dir, 'out.png');
    await writeFile(src, input);
    await run('heif-convert', [src, dst], { maxBuffer: 8 * 1024 * 1024 });
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readDimensions(
  input: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    // Post-rotation dimensions: a portrait photo tagged as rotated should not
    // report itself as landscape to the grid.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = meta.width ?? null;
    const height = meta.height ?? null;
    return swap ? { width: height, height: width } : { width, height };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Whether this build of sharp can actually decode what people will upload.
 *
 * iPhone photos are HEVC-coded HEIC, and sharp's prebuilt libvips can be built
 * without an HEVC decoder — in which case every HEIC upload fails at ingest.
 * That is a deployment property of the container image, not of this code, so
 * the service probes it at boot rather than discovering it one photo at a time.
 */
export async function decodeCapabilities(): Promise<Record<string, boolean>> {
  const formats = sharp.format as unknown as Record<
    string,
    { input?: { buffer?: boolean } } | undefined
  >;
  return {
    jpeg: Boolean(formats.jpeg?.input?.buffer),
    png: Boolean(formats.png?.input?.buffer),
    webp: Boolean(formats.webp?.input?.buffer),
    heif: Boolean(formats.heif?.input?.buffer),
  };
}

/**
 * Proves decode against real bytes, by actually decoding them.
 *
 * `sharp(input).metadata()` is NOT sufficient and is an easy mistake to make:
 * it parses the container header and returns `{ format: 'heif', width: … }`
 * for a build that cannot decode a single HEVC pixel. Only rasterising tells
 * the truth, which is why this pays for a full decode.
 */
export async function canDecode(input: Buffer): Promise<boolean> {
  try {
    await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).jpeg().toBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this build can *write* AVIF, which is a different question from
 * whether it can read HEIF.
 *
 * `sharp.format.heif.output` reports the container, and libvips aliases avif
 * onto it — so the table says yes for a build with no AV1 encoder, in exactly
 * the way it says yes to HEIF for a build with no HEVC decoder. Every ingest
 * would fail at the first thumbnail, so the boot probe encodes real pixels.
 */
export async function canEncodeAvif(): Promise<boolean> {
  try {
    const pixel = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#888' },
    })
      .avif({ quality: 50, effort: AVIF_EFFORT })
      .toBuffer();
    // ftyp box, then the avif brand. A zero-length buffer would also "succeed".
    return pixel.length > 0 && pixel.subarray(4, 12).toString('latin1') === 'ftypavif';
  } catch {
    return false;
  }
}

/** Whether the libheif fallback is installed and works on these bytes. */
export async function canDecodeViaHeifConvert(input: Buffer): Promise<boolean> {
  try {
    const raster = await heifConvert(input);
    await sharp(raster, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    return true;
  } catch {
    return false;
  }
}
