/**
 * Derivative generation — docs/design.md §7.7.
 *
 * Unlike the original, derivatives are re-encoded — that is what they are for.
 * Three sizes, and the largest one earns its place twice: it backs the lightbox
 * *and* it is the "download as JPEG" option, so an Android recipient handed a
 * folder of iPhone HEICs has something their gallery can open.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

export const DERIVATIVES = [
  { kind: 'thumb', edge: 320, quality: 72 },
  { kind: 'grid', edge: 1280, quality: 78 },
  { kind: 'full', edge: 2560, quality: 85 },
] as const;

export type DerivativeKind = (typeof DERIVATIVES)[number]['kind'];

export type Derivative = {
  kind: DerivativeKind;
  bytes: Buffer;
  width: number;
  height: number;
  mime: string;
};

/**
 * JPEG for every size, for now.
 *
 * The design specifies AVIF with a JPEG fallback for thumb and grid, which is
 * meaningfully smaller. That means storing two encodings per size and picking
 * by Accept header at the edge — work that belongs with the image Worker,
 * which does not exist yet. Serving JPEG until then is a bandwidth cost, not a
 * correctness one, and R2 egress is free.
 */
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
    const pipeline = sharp(input, { failOn: 'error' })
      // Bakes in EXIF orientation, so viewers do not have to honour it, and
      // strips metadata from the derivative entirely — a thumbnail has no
      // business carrying the original's tags.
      .rotate()
      .resize({
        width: spec.edge,
        height: spec.edge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: spec.quality, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    out.push({
      kind: spec.kind,
      bytes: data,
      width: info.width,
      height: info.height,
      mime: 'image/jpeg',
    });
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
    const meta = await sharp(input).metadata();
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
    await sharp(input).jpeg().toBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Whether the libheif fallback is installed and works on these bytes. */
export async function canDecodeViaHeifConvert(input: Buffer): Promise<boolean> {
  try {
    const raster = await heifConvert(input);
    await sharp(raster).metadata();
    return true;
  } catch {
    return false;
  }
}
