/**
 * Which objects go into a download, and under what names — design §10.
 *
 * Separate from the route because this is the part with the interesting
 * decisions in it, and because the route around it is authorization and
 * signing, neither of which a test of archive contents should have to stand
 * up. The zip Worker never sees any of this reasoning: it receives a list of
 * keys, sizes and CRCs, and streams.
 *
 * The two formats (§7.7) differ only here.
 */

import { schema } from '@parea/core';
import { archiveEntryName } from '@parea/zip';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

export type ArchiveFormat = 'original' | 'jpeg';

export type ArchiveEntry = {
  key: string;
  name: string;
  size: number;
  crc32: number;
  takenAt: string;
};

export type ArchiveResult =
  | {
      ok: true;
      entries: ArchiveEntry[];
      /** Originals swapped for a JPEG rendition. Zero means the two formats agree. */
      converted: number;
      totalBytes: number;
    }
  | { ok: false; error: 'not_ready' | 'jpeg_unavailable'; count: number };

/**
 * @param selection 'all', or the photo ids the caller ticked. Ids that are not
 *        visible in this event are silently absent rather than an error — the
 *        grid the selection came from may be a few seconds stale, and failing
 *        a 400-photo download because one was removed mid-scroll helps nobody.
 */
export async function resolveArchive(
  db: any,
  eventId: string,
  { selection, format }: { selection: 'all' | string[]; format: ArchiveFormat },
): Promise<ArchiveResult> {
  const wantsJpeg = format === 'jpeg';

  // The `full` derivative is joined on every request rather than only the JPEG
  // ones. It is one index lookup per row, and branching the query shape would
  // mean two orderings, two null-checks, and two chances for the archive
  // layout to drift apart between the paths.
  const rows = await db
    .select({
      id: schema.photos.id,
      storageKey: schema.photos.storageKey,
      byteSize: schema.photos.byteSize,
      crc32: schema.photos.crc32,
      mime: schema.photos.mime,
      capturedAt: schema.photos.capturedAt,
      uploadedAt: schema.photos.uploadedAt,
      jpegKey: schema.derivatives.storageKey,
      jpegBytes: schema.derivatives.byteSize,
      jpegCrc32: schema.derivatives.crc32,
    })
    .from(schema.photos)
    .leftJoin(
      schema.derivatives,
      and(
        eq(schema.derivatives.photoId, schema.photos.id),
        eq(schema.derivatives.kind, 'full'),
        // A size can exist in several encodings (§11), and the primary key
        // permits it, so this has to name one. Without it the join fans out
        // the moment `full` gains a second format and every archive silently
        // doubles — the kind of bug that shows up as a corrupt download.
        eq(schema.derivatives.format, 'jpeg'),
      ),
    )
    .where(
      and(
        eq(schema.photos.eventId, eventId),
        eq(schema.photos.status, 'ready'),
        isNull(schema.photos.deletedAt),
        selection === 'all' ? undefined : inArray(schema.photos.id, selection),
      ),
    )
    .orderBy(
      asc(sql`coalesce(${schema.photos.capturedAt}, ${schema.photos.uploadedAt})`),
    );

  const members = rows.map((row: any) => {
    // An original that is already JPEG stands in for its own derivative. The
    // ask is "give me files that open", not "give me smaller files", and the
    // original answers it at full resolution — handing back a 2560px re-encode
    // instead would be a downgrade bought for nothing.
    const substituted = wantsJpeg && row.mime !== 'image/jpeg';
    return {
      key: substituted ? row.jpegKey : row.storageKey,
      size: substituted ? row.jpegBytes : row.byteSize,
      crc32: substituted ? row.jpegCrc32 : row.crc32,
      mime: substituted ? 'image/jpeg' : row.mime,
      takenAt: (row.capturedAt ?? row.uploadedAt) as Date,
      substituted,
    };
  });

  // Nothing enters an archive whose size and CRC are not both known. The exact
  // Content-Length is the whole point of the format, and quietly dropping a
  // photo hands someone an incomplete download with no way to notice — so the
  // whole archive is refused, and the two gaps are named apart because their
  // remedies differ: waiting fixes one, and only the other button fixes the
  // other.
  const missing = members.filter(
    (m: any) => m.key == null || m.size == null || m.crc32 == null,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: missing.some((m: any) => m.substituted) ? 'jpeg_unavailable' : 'not_ready',
      count: missing.length,
    };
  }

  const entries: ArchiveEntry[] = members.map((member: any, index: number) => ({
    key: member.key,
    name: archiveEntryName(index, member.takenAt, member.mime),
    size: Number(member.size),
    crc32: Number(member.crc32),
    takenAt: member.takenAt.toISOString(),
  }));

  return {
    ok: true,
    entries,
    converted: members.filter((m: any) => m.substituted).length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}
