/**
 * Derivative generation — docs/design.md §7.7.
 *
 * Unlike the original, derivatives are re-encoded — that is what they are for.
 * Three sizes, and the largest one earns its place twice: it backs the lightbox
 * *and* it is the "download as JPEG" option, so an Android recipient handed a
 * folder of iPhone HEICs has something their gallery can open.
 *
 * The two grid sizes are encoded twice, AVIF and JPEG. Both are stored and the
 * browser picks with `<picture>`; see §11 for why that beats negotiating on
 * `Accept`. `full` stays JPEG-only — it is an archive member, and it has to
 * stay one.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

import { MIME, formatsFor } from '@parea/urls';

const run = promisify(execFile);

export const DERIVATIVES = [
  { kind: 'thumb', edge: 320, quality: 72 },
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
 */
const MAX_INPUT_PIXELS = 400_000_000;

export type Derivative = {
  kind: DerivativeKind;
  format: 'jpeg' | 'avif';
  bytes: Buffer;
  width: number;
  height: number;
  mime: string;
};

export async function buildDerivatives(input: Buffer): Promise<Derivative[]> {
  try {
    return await encodeAll(input);
  } catch (err) {
    // sharp's prebuilt libvips parses the HEIF container but has no HEVC
    // decoder, so `metadata()` succeeds on an iPhone photo and decoding it
    // fails with "bad seek". libheif with libde265 can decode it, so convert
    // to a raster sharp can definitely read and retry once.
    const raster = await heifConvert(input).catch(() => null);
    if (!raster) throw err;
    return encodeAll(raster);
  }
}

async function encodeAll(input: Buffer): Promise<Derivative[]> {
  const out: Derivative[] = [];

  for (const spec of DERIVATIVES) {
    for (const format of formatsFor(spec.kind)) {
      const resized = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
        // Bakes in EXIF orientation, so viewers do not have to honour it, and
        // strips metadata from the derivative entirely — a thumbnail has no
        // business carrying the original's tags.
        .rotate()
        .resize({
          width: spec.edge,
          height: spec.edge,
          fit: 'inside',
          withoutEnlargement: true,
        });

      const encoded =
        format === 'avif'
          ? resized.avif({
              quality: spec.quality - AVIF_QUALITY_OFFSET,
              effort: AVIF_EFFORT,
            })
          : resized.jpeg({ quality: spec.quality, mozjpeg: true });

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
