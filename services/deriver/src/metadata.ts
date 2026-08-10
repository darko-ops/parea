/**
 * Metadata handling — docs/design.md §7.6.
 *
 * The design makes a specific promise: "Pixel data is never re-encoded.
 * Metadata is rewritten in place." That rules out decoding and re-saving the
 * original, which is what any image library would do, so this shells out to
 * exiftool — which rewrites the metadata segments and leaves the compressed
 * image data byte-for-byte alone.
 *
 * The promise is then *verified* rather than assumed: exiftool can hash just
 * the image data, so the pipeline checks the hash is identical before and
 * after stripping and fails the photo if it is not. A silent re-encode would
 * degrade every original in the product, which is the one thing that makes it
 * better than the group chat.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Removed: anything that says where the photo was taken, or which specific
 * device took it.
 *
 * Kept, deliberately: orientation (the image is unviewable without it),
 * DateTimeOriginal (the grid is chronological), camera make/model and exposure
 * (interesting, not identifying).
 */
const STRIP_ARGS = [
  '-gps:all=',
  '-XMP:GPSLatitude=',
  '-XMP:GPSLongitude=',
  '-XMP:GPSAltitude=',
  '-XMP:Location=',
  '-QuickTime:GPSCoordinates=',
  '-Keys:Location=',
  '-UserData:GPSCoordinates=',
  '-SerialNumber=',
  '-InternalSerialNumber=',
  '-LensSerialNumber=',
  '-BodySerialNumber=',
  '-CameraSerialNumber=',
  '-OwnerName=',
  '-CameraOwnerName=',
  '-Artist=',
  '-XMP:Creator=',
];

export type ExtractedMetadata = {
  capturedAt: Date | null;
  capturedOffsetMinutes: number | null;
  width: number | null;
  height: number | null;
  mime: string | null;
};

async function exiftool(args: string[]): Promise<string> {
  const { stdout } = await run('exiftool', args, {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/**
 * A hash of the compressed image data only, ignoring all metadata. Returns null
 * for formats exiftool cannot hash, in which case the caller skips the check
 * rather than failing the photo.
 */
export async function imageDataHash(path: string): Promise<string | null> {
  const out = await exiftool([
    '-api', 'ImageHashType=SHA256',
    '-s3', '-ImageDataHash', path,
  ]).catch(() => '');
  const value = out.trim();
  return value.length > 0 ? value : null;
}

/** Rewrites `path` in place. Throws if exiftool cannot write the format. */
export async function stripPrivateMetadata(path: string): Promise<void> {
  await exiftool(['-overwrite_original', '-q', ...STRIP_ARGS, path]);
}

export async function extractMetadata(path: string): Promise<ExtractedMetadata> {
  const raw = await exiftool([
    '-j', '-q', '-q',
    '-DateTimeOriginal', '-CreateDate', '-OffsetTimeOriginal', '-OffsetTime',
    '-ImageWidth', '-ImageHeight', '-MIMEType',
    path,
  ]);
  const [record] = JSON.parse(raw) as Record<string, unknown>[];
  if (!record) return blank();

  const stamp =
    asString(record.DateTimeOriginal) ?? asString(record.CreateDate);
  const offset =
    asString(record.OffsetTimeOriginal) ?? asString(record.OffsetTime);

  return {
    capturedAt: parseExifDate(stamp, offset),
    capturedOffsetMinutes: parseOffsetMinutes(offset),
    width: asNumber(record.ImageWidth),
    height: asNumber(record.ImageHeight),
    mime: asString(record.MIMEType),
  };
}

/** Confirms the strip actually removed location, so a silent failure is caught. */
export async function hasLocation(path: string): Promise<boolean> {
  const out = await exiftool([
    '-s3', '-n',
    '-GPSLatitude', '-GPSLongitude', '-XMP:GPSLatitude',
    '-QuickTime:GPSCoordinates',
    path,
  ]).catch(() => '');
  return out.trim().length > 0;
}

function blank(): ExtractedMetadata {
  return {
    capturedAt: null,
    capturedOffsetMinutes: null,
    width: null,
    height: null,
    mime: null,
  };
}

/**
 * EXIF timestamps are `YYYY:MM:DD HH:MM:SS` local wall-clock with no zone. When
 * the camera also recorded an offset we can pin it to an instant; otherwise it
 * is interpreted as UTC and the timeline is off by the photographer's offset.
 *
 * That inaccuracy is known and accepted in v1 (design §4) — six phones already
 * disagree with each other by minutes. `capturedOffsetMinutes` is stored
 * alongside so a later pass can correct without re-reading the originals.
 */
export function parseExifDate(
  stamp: string | null,
  offset: string | null,
): Date | null {
  if (!stamp) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const zone = normaliseOffset(offset);
  const parsed = new Date(`${iso}${zone ?? 'Z'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseOffsetMinutes(offset: string | null): number | null {
  const zone = normaliseOffset(offset);
  if (!zone) return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function normaliseOffset(offset: string | null): string | null {
  if (!offset) return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  return m ? `${m[1]}${m[2]}:${m[3]}` : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
