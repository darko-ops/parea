/**
 * Streaming archive download — docs/design.md §10.
 *
 * A Cloudflare Worker that turns a signed manifest into a zip, reading objects
 * from R2 as it writes the response. Nothing is staged, no job is queued, and
 * memory stays flat regardless of how large the event is.
 *
 * Why this is a Worker rather than a Next.js route: reading from R2 into a
 * Worker is free and never leaves Cloudflare's network, whereas proxying the
 * same bytes through the app origin bills every one of them. A 250-photo event
 * is ~1GB and twenty people taking the full set is 20GB, so this distinction is
 * the difference between a cheap product and an expensive one.
 *
 * It holds no database credentials and makes no access decision. The app tier
 * authorizes, resolves the object list, and signs it; this verifies the
 * signature and streams. See @parea/zip's manifest module.
 */

import {
  contentDisposition,
  parseManifest,
  planArchive,
  streamArchive,
  verifyManifestToken,
  type DownloadManifest,
} from '@parea/zip';

export type Env = {
  BUCKET: R2Bucket;
  MANIFEST_SECRET: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }

    const token = new URL(request.url).searchParams.get('m');
    if (!token) return notFound();

    const check = await verifyManifestToken(env.MANIFEST_SECRET, token);
    if (!check.ok) {
      // An expired token is worth distinguishing: the client can mint a new one
      // and retry, which is a normal thing to happen on a slow connection.
      return check.reason === 'expired'
        ? new Response('this download link has expired', { status: 410 })
        : notFound();
    }

    const stored = await env.BUCKET.get(check.manifestKey);
    if (!stored) return notFound();

    const manifest = parseManifest(await stored.text());
    if (!manifest) return new Response('bad manifest', { status: 500 });

    return archive(manifest, env, request.method === 'HEAD');
  },
};

async function archive(
  manifest: DownloadManifest,
  env: Env,
  headOnly: boolean,
): Promise<Response> {
  const plan = planArchive(
    manifest.entries.map((entry) => ({
      name: entry.name,
      size: entry.size,
      crc32: entry.crc32,
      modified: new Date(entry.takenAt),
    })),
  );

  const headers = new Headers({
    'content-type': 'application/zip',
    // The reason the CRCs are computed at ingest: a real length here means a
    // real progress bar on a 1GB download instead of a spinner.
    'content-length': String(plan.totalBytes),
    'content-disposition': contentDisposition(manifest.archiveName),
    // The layout is deterministic, so ranges are implementable — but not
    // implemented yet, and advertising support we lack would break resumption
    // rather than enable it.
    'accept-ranges': 'none',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });

  // HEAD gives a client the exact size without moving a byte, which is what
  // makes "this will be 1.2 GB, continue?" answerable before starting.
  if (headOnly) return new Response(null, { headers });

  const body = streamArchive(plan, async (index, entry) => {
    const key = manifest.entries[index]!.key;
    const object = await env.BUCKET.get(key);
    if (!object) {
      // Better to break the download than to hand someone an archive that is
      // quietly missing photos they think they have.
      throw new Error(`missing object for ${entry.name}`);
    }
    return object.body as ReadableStream<Uint8Array>;
  });

  return new Response(body, { headers });
}

function notFound(): Response {
  // Never distinguishes "no such manifest" from "bad signature": the response
  // must not become an oracle for probing manifest keys.
  return new Response('not found', { status: 404 });
}
