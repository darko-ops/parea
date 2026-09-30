/**
 * Mint a download — screen 4 of design §3, and the app half of §10.
 *
 * Authorization happens here, once. The zip Worker holds no database
 * credentials and makes no access decision; it verifies a signature and
 * streams. So this route does the work the Worker cannot: check the caller may
 * download, resolve exactly which objects belong in the archive, and sign that
 * list.
 *
 * POST rather than GET because a selection can be hundreds of ids — too many
 * for a URL. The response is a plain URL the browser can then navigate to, so
 * the download itself is an ordinary navigation the OS can own, with progress,
 * a real filename, and no tab that has to stay open.
 */

import { signManifestToken, type DownloadManifest } from '@parea/zip';
import { NextResponse } from 'next/server';
import { dedicatedSecret } from '@/env';

import { findEventById, guard, toResponse } from '@/access';
import { resolveArchive, type ArchiveFormat } from '@/archive';
import { getDb } from '@/db';
import { viewerContext } from '@/moderation';
import { clientOf, observe } from '@/observe';
import { currentActorId, requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

const TOKEN_TTL_SECONDS = 900;
const MAX_SELECTION = 5000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    photoIds?: unknown;
    linkToken?: unknown;
    code?: unknown;
    format?: unknown;
  };

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    await guard(db, event, 'download', requester);
  } catch (err) {
    return toResponse(err);
  }

  const selection = parseSelection(body.photoIds);
  if (selection === 'invalid') {
    return NextResponse.json({ error: 'invalid_selection' }, { status: 400 });
  }

  // "download originals" versus "download as JPEG". The second exists because
  // an Android recipient handed a folder of iPhone HEICs may not be able to
  // open any of them (design §7.7).
  const format: ArchiveFormat = body.format === 'jpeg' ? 'jpeg' : 'original';

  /*
   * Whose download this is, and not merely who is allowed to have one.
   *
   * `guard` above answered the second question. This answers the first, and
   * they are different: an archive is built for a person, so a photograph they
   * have blocked has no more business in their zip than on their screen — and
   * a photograph hidden by an unanswered removal request has no business in
   * anybody's. `resolveArchive` takes the viewer rather than assuming one
   * precisely so that this line has to be written.
   */
  const actorId = await currentActorId();
  const archive = await resolveArchive(db, event.id, {
    selection,
    format,
    viewer: await viewerContext(db, actorId),
  });
  if (!archive.ok) {
    // 409 rather than 500: nothing is broken, the archive just cannot be built
    // exactly right now, and the client has something useful to say about it.
    return NextResponse.json(
      archive.error === 'jpeg_unavailable'
        ? { error: archive.error, missing: archive.count }
        : { error: archive.error, pending: archive.count },
      { status: 409 },
    );
  }

  const manifest: DownloadManifest = {
    version: 1,
    eventId: event.id,
    // Distinct filenames so downloading both does not leave someone with
    // "Party.zip" and "Party (1).zip" and no way to tell which is which.
    archiveName: `${safeName(event.name)}${format === 'jpeg' ? ' JPEG' : ''}.zip`,
    createdAt: new Date().toISOString(),
    entries: archive.entries,
  };

  const secret = dedicatedSecret('MANIFEST_SECRET');
  const base = process.env.ZIP_BASE_URL;
  if (!secret || !base) {
    return NextResponse.json({ error: 'download_not_configured' }, { status: 503 });
  }

  // Manifests are written under a prefix with a short R2 lifecycle rule, so
  // they expire on their own; the token expiry is the real control.
  const manifestKey = `tmp/manifest/${crypto.randomUUID()}.json`;
  await getStorage().putSmall(
    manifestKey,
    new TextEncoder().encode(JSON.stringify(manifest)),
    'application/json',
  );

  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  const token = await signManifestToken(secret, manifestKey, expiresAt);

  // The only trace that anyone left with the photos. The zip Worker streams
  // without a database, so if this is not recorded here it is not recorded —
  // and an event nobody downloads has delivered nothing, whatever went into
  // it (§18). Minting the URL rather than the bytes leaving is the honest
  // approximation available: close enough, and it costs no egress to know.
  await observe(db, {
    kind: 'download',
    eventId: event.id,
    actorId,
    client: clientOf(request),
    count: archive.entries.length,
  });

  return NextResponse.json({
    url: `${base.replace(/\/$/, '')}/zip?m=${encodeURIComponent(token)}`,
    format,
    count: archive.entries.length,
    // How many originals were swapped for a rendition — the honest number
    // behind "download as JPEG", and what a client needs in order to say
    // whether this archive differs from the originals at all.
    converted: archive.converted,
    totalBytes: archive.totalBytes,
    expiresAt: expiresAt.toISOString(),
  });
}

function parseSelection(value: unknown): 'all' | string[] | 'invalid' {
  if (value === undefined || value === null) return 'all';
  if (!Array.isArray(value) || value.length === 0) return 'invalid';
  if (value.length > MAX_SELECTION) return 'invalid';
  if (!value.every((v) => typeof v === 'string' && v.length < 64)) return 'invalid';
  return value as string[];
}

/**
 * Event names reach a filesystem here, so strip anything path-shaped — and
 * anything that is not printable, which is the `\x00-\x1f` range.
 *
 * Those five characters are an escape sequence and must stay one. They were
 * written as the raw bytes they stand for, which works — the regex engine sees
 * the same range either way — and has a cost nothing in the language surfaces:
 * a NUL in the first 8000 bytes is how git decides a file is binary, so this
 * route showed up in every diff as `Bin 5663 -> 6314 bytes` and in no code
 * review as anything at all. `grep` skipped it silently too. A filename
 * sanitiser is a poor thing to have made unreadable by the tools people use to
 * read code.
 *
 * The hyphen is the range operator here, not a character being stripped, which
 * is why an event called "Naxos - August" keeps its dash.
 */
function safeName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'photos';
}
