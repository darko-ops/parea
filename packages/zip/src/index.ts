/**
 * A streaming ZIP writer for archives whose contents are known in advance.
 *
 * docs/design.md §10. The download of everything is the product's terminal
 * action, and it has one property worth engineering for: because the deriver
 * records each photo's size and CRC-32 at ingest, the entire archive layout is
 * computable before a single byte is read.
 *
 * That buys three things:
 *   - an exact `Content-Length`, so a 1GB download shows a real progress bar
 *     and time estimate instead of an indeterminate spinner;
 *   - no staging: nothing is assembled on disk or in memory, the response is
 *     written as objects stream through;
 *   - a deterministic byte layout, which is what makes `Range` resume
 *     implementable later without changing the format.
 *
 * STORE only — no compression. JPEG and HEIC are already compressed, so
 * deflate would burn CPU for roughly nothing, and it would also destroy the
 * property above by making sizes unknowable in advance.
 *
 * Portable by design: Web Streams and no dependencies, so it runs in a
 * Cloudflare Worker and under Node in tests.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
const ZIP64_EOCD_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;

/** Anything at or above this cannot be expressed in a 32-bit ZIP field. */
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

const UTF8_FLAG = 0x0800; // general purpose bit 11
const METHOD_STORE = 0;
const VERSION_BASE = 20;
const VERSION_ZIP64 = 45;

export type ZipEntry = {
  /** Path inside the archive. Encoded UTF-8; the writer sets the UTF-8 flag. */
  name: string;
  /** Exact byte length. If the source disagrees at stream time, the archive is corrupt. */
  size: number;
  /** CRC-32 of the same bytes, precomputed at ingest. */
  crc32: number;
  modified: Date;
};

type PlannedEntry = ZipEntry & {
  nameBytes: Uint8Array;
  localHeaderOffset: number;
  /** Sizes need 64-bit fields — only for a single member of 4GB or more. */
  zip64Sizes: boolean;
  /** The member starts beyond 4GB, so the central directory needs 64-bit offsets. */
  zip64Offset: boolean;
  dosTime: number;
  dosDate: number;
};

export type ArchivePlan = {
  entries: PlannedEntry[];
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  /** Exactly what the response's Content-Length must be. */
  totalBytes: number;
};

export class ZipError extends Error {}

/**
 * Works out the complete byte layout without reading any content.
 *
 * @param options.forceZip64 emit 64-bit fields on every entry regardless of
 *        size. Only useful for exercising the Zip64 encoding in tests without
 *        materialising 4GB.
 */
export function planArchive(
  entries: ZipEntry[],
  options: { forceZip64?: boolean } = {},
): ArchivePlan {
  const planned: PlannedEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new ZipError(`invalid size for ${entry.name}`);
    }
    if (seen.has(entry.name)) {
      // Duplicate names produce an archive that silently loses files on
      // extraction, so refuse rather than emit one.
      throw new ZipError(`duplicate entry name: ${entry.name}`);
    }
    seen.add(entry.name);

    const nameBytes = new TextEncoder().encode(entry.name);
    if (nameBytes.length > U16_MAX) throw new ZipError('entry name too long');

    const zip64Sizes = Boolean(options.forceZip64) || entry.size >= U32_MAX;
    const zip64Offset = Boolean(options.forceZip64) || offset >= U32_MAX;

    const item: PlannedEntry = {
      ...entry,
      nameBytes,
      localHeaderOffset: offset,
      zip64Sizes,
      zip64Offset,
      ...dosDateTime(entry.modified),
    };
    planned.push(item);

    offset +=
      LOCAL_HEADER_BYTES +
      nameBytes.length +
      (zip64Sizes ? 20 : 0) +
      entry.size;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const entry of planned) {
    centralDirectorySize +=
      CENTRAL_HEADER_BYTES + entry.nameBytes.length + centralExtraBytes(entry);
  }

  return {
    entries: planned,
    centralDirectoryOffset,
    centralDirectorySize,
    totalBytes:
      centralDirectoryOffset +
      centralDirectorySize +
      ZIP64_EOCD_BYTES +
      ZIP64_LOCATOR_BYTES +
      EOCD_BYTES,
  };
}

/**
 * Streams the archive.
 *
 * `open(index)` supplies each member's bytes, called one at a time in archive
 * order — so at most one object is in flight and memory stays flat regardless
 * of how large the event is.
 *
 * If a source yields a different number of bytes than the plan promised, this
 * throws mid-stream rather than emitting a corrupt archive. The client sees a
 * truncated download, which is recoverable; a silently wrong archive is not.
 */
export function streamArchive(
  plan: ArchivePlan,
  open: (index: number, entry: ZipEntry) => Promise<ReadableStream<Uint8Array>>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < plan.entries.length; i++) {
          const entry = plan.entries[i]!;
          controller.enqueue(localHeader(entry));

          const source = await open(i, entry);
          const reader = source.getReader();
          let written = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            written += value.byteLength;
            if (written > entry.size) {
              throw new ZipError(
                `${entry.name}: source longer than planned ${entry.size}`,
              );
            }
            controller.enqueue(value);
          }
          if (written !== entry.size) {
            throw new ZipError(
              `${entry.name}: expected ${entry.size} bytes, got ${written}`,
            );
          }
        }

        for (const entry of plan.entries) {
          controller.enqueue(centralHeader(entry));
        }
        controller.enqueue(endRecords(plan));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// --- record encoding -------------------------------------------------------

function localHeader(entry: PlannedEntry): Uint8Array {
  const extra = entry.zip64Sizes ? 20 : 0;
  const buf = new Uint8Array(LOCAL_HEADER_BYTES + entry.nameBytes.length + extra);
  const view = new DataView(buf.buffer);

  view.setUint32(0, LOCAL_SIG, true);
  view.setUint16(4, entry.zip64Sizes ? VERSION_ZIP64 : VERSION_BASE, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, METHOD_STORE, true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  view.setUint32(14, entry.crc32 >>> 0, true);
  // With Zip64 the real sizes live in the extra field and these carry the
  // sentinel; without it they carry the sizes directly.
  view.setUint32(18, entry.zip64Sizes ? U32_MAX : entry.size, true);
  view.setUint32(22, entry.zip64Sizes ? U32_MAX : entry.size, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, extra, true);
  buf.set(entry.nameBytes, LOCAL_HEADER_BYTES);

  if (entry.zip64Sizes) {
    const at = LOCAL_HEADER_BYTES + entry.nameBytes.length;
    view.setUint16(at, 0x0001, true);
    view.setUint16(at + 2, 16, true);
    view.setBigUint64(at + 4, BigInt(entry.size), true);
    view.setBigUint64(at + 12, BigInt(entry.size), true);
  }
  return buf;
}

function centralExtraBytes(entry: PlannedEntry): number {
  if (!entry.zip64Sizes && !entry.zip64Offset) return 0;
  // Zip64 extra fields are positional: sizes first, then the offset. Emitting
  // the offset alone still requires the sizes ahead of it.
  return 4 + (entry.zip64Sizes ? 16 : 0) + (entry.zip64Offset ? 8 : 0);
}

function centralHeader(entry: PlannedEntry): Uint8Array {
  const extra = centralExtraBytes(entry);
  const buf = new Uint8Array(
    CENTRAL_HEADER_BYTES + entry.nameBytes.length + extra,
  );
  const view = new DataView(buf.buffer);
  const needsZip64 = entry.zip64Sizes || entry.zip64Offset;

  view.setUint32(0, CENTRAL_SIG, true);
  view.setUint16(4, needsZip64 ? VERSION_ZIP64 : VERSION_BASE, true);
  view.setUint16(6, needsZip64 ? VERSION_ZIP64 : VERSION_BASE, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, METHOD_STORE, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32 >>> 0, true);
  view.setUint32(20, entry.zip64Sizes ? U32_MAX : entry.size, true);
  view.setUint32(24, entry.zip64Sizes ? U32_MAX : entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, extra, true);
  view.setUint16(32, 0, true); // comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, 0, true); // external attributes
  view.setUint32(
    42,
    entry.zip64Offset ? U32_MAX : entry.localHeaderOffset,
    true,
  );
  buf.set(entry.nameBytes, CENTRAL_HEADER_BYTES);

  if (needsZip64) {
    let at = CENTRAL_HEADER_BYTES + entry.nameBytes.length;
    view.setUint16(at, 0x0001, true);
    view.setUint16(at + 2, extra - 4, true);
    at += 4;
    if (entry.zip64Sizes) {
      view.setBigUint64(at, BigInt(entry.size), true);
      view.setBigUint64(at + 8, BigInt(entry.size), true);
      at += 16;
    }
    if (entry.zip64Offset) {
      view.setBigUint64(at, BigInt(entry.localHeaderOffset), true);
    }
  }
  return buf;
}

/**
 * Zip64 EOCD, its locator, and the classic EOCD — always all three.
 *
 * The Zip64 records are emitted unconditionally rather than only past 4GB.
 * Events crossing that are ordinary once video exists, and a writer that
 * changes format under load is a bug that only appears on the largest, least
 * reproducible downloads. Always-on costs 76 bytes and removes the branch.
 */
function endRecords(plan: ArchivePlan): Uint8Array {
  const count = plan.entries.length;
  const buf = new Uint8Array(ZIP64_EOCD_BYTES + ZIP64_LOCATOR_BYTES + EOCD_BYTES);
  const view = new DataView(buf.buffer);

  view.setUint32(0, ZIP64_EOCD_SIG, true);
  view.setBigUint64(4, BigInt(ZIP64_EOCD_BYTES - 12), true);
  view.setUint16(12, VERSION_ZIP64, true);
  view.setUint16(14, VERSION_ZIP64, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);
  view.setBigUint64(24, BigInt(count), true);
  view.setBigUint64(32, BigInt(count), true);
  view.setBigUint64(40, BigInt(plan.centralDirectorySize), true);
  view.setBigUint64(48, BigInt(plan.centralDirectoryOffset), true);

  let at = ZIP64_EOCD_BYTES;
  view.setUint32(at, ZIP64_LOCATOR_SIG, true);
  view.setUint32(at + 4, 0, true);
  view.setBigUint64(at + 8, BigInt(plan.centralDirectoryOffset + plan.centralDirectorySize), true);
  view.setUint32(at + 16, 1, true);

  at += ZIP64_LOCATOR_BYTES;
  view.setUint32(at, EOCD_SIG, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, Math.min(count, U16_MAX), true);
  view.setUint16(at + 10, Math.min(count, U16_MAX), true);
  view.setUint32(at + 12, Math.min(plan.centralDirectorySize, U32_MAX), true);
  view.setUint32(at + 16, Math.min(plan.centralDirectoryOffset, U32_MAX), true);
  view.setUint16(at + 20, 0, true);

  return buf;
}

/** MS-DOS date/time. Two-second resolution, and nothing before 1980 exists. */
function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = date.getUTCFullYear();
  if (year < 1980) return { dosTime: 0, dosDate: (1 << 5) | 1 };
  return {
    dosTime:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    dosDate:
      ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/**
 * A filesystem-safe, collision-free, chronologically sortable name.
 *
 * Photos have no stored original filename — the client sends one at presign
 * time and it is deliberately not kept. Uploaded names are attacker-controlled
 * and would be written straight into an archive that people extract, and they
 * collide constantly (every camera roll has an IMG_0001). Generating them
 * removes both problems, and an index prefix keeps extraction order matching
 * the grid order people just looked at.
 */
export function archiveEntryName(
  index: number,
  takenAt: Date,
  mime: string,
): string {
  const stamp = takenAt.toISOString().slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
  return `${String(index + 1).padStart(4, '0')}_${stamp}.${extensionFor(mime)}`;
}

function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/heic':
    case 'image/heif': return 'heic';
    case 'image/webp': return 'webp';
    case 'image/avif': return 'avif';
    case 'video/mp4': return 'mp4';
    case 'video/quicktime': return 'mov';
    default: return 'bin';
  }
}

export {
  MANIFEST_VERSION,
  contentDisposition,
  parseManifest,
  signManifestToken,
  verifyManifestToken,
  type DownloadManifest,
  type ManifestEntry,
  type TokenCheck,
} from './manifest';
