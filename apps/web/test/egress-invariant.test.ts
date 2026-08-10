/**
 * The egress invariant — docs/design.md §16.1.
 *
 * "No photo bytes through the Next.js origin." A 250-photo event is ~1GB and
 * twenty people pulling the full set is 20GB, so a single route handler that
 * proxies storage reads turns a cheap product into an expensive one. The
 * failure is silent, gradual, and unrecoverable after the fact — you find out
 * from a bill, and by then the bytes have already moved.
 *
 * The primary defence is structural: the Storage interface has no method that
 * returns a body. This test catches the ways around that — importing the S3
 * client directly in a route, or reaching into the local driver's byte
 * accessors, which exist only for the dev endpoint.
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'app');

/** The one file allowed to move bytes, because it cannot run in production. */
const DEV_BLOB_ROUTE = 'app/api/dev/blob/route.dev.ts';

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * Comments are documentation, not code. These files quote the very
 * anti-patterns being scanned for — `r2.get(key).body` appears verbatim in the
 * Storage interface's header as the thing not to do — so scanning raw source
 * would flag the warning against the mistake as the mistake.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not `://`, so URLs in string literals survive.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function readCode(path: string): Promise<string> {
  return stripComments(await readFile(path, 'utf8'));
}

async function appFiles(): Promise<{ path: string; source: string }[]> {
  const paths = await walk(APP);
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(ROOT, path),
      source: await readCode(path),
    })),
  );
}

describe('egress invariant', () => {
  it('the Storage interface exposes no way to read a body', async () => {
    const source = await readCode(join(ROOT, 'src/storage/index.ts'));
    // If someone adds one, they have to delete this test to get green, which
    // is a much louder act than adding a method.
    expect(source).not.toMatch(/\b(get|read|fetch|download)(Object|Bytes|Body|Stream)?\s*\(/);
    expect(source).toMatch(/presignGet/);
    expect(source).toMatch(/presignPut/);
  });

  it('no route or page pulls object bytes out of S3', async () => {
    const offenders: string[] = [];
    for (const { path, source } of await appFiles()) {
      if (/GetObjectCommand|@aws-sdk\/client-s3/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders, 'S3 reads belong behind the Storage interface').toEqual([]);
  });

  it('no route or page reads bytes off the local driver', async () => {
    const offenders: string[] = [];
    for (const { path, source } of await appFiles()) {
      if (path === DEV_BLOB_ROUTE) continue;
      if (/\.(readBytes|writeBytes)\s*\(/.test(source)) offenders.push(path);
    }
    expect(offenders, `only ${DEV_BLOB_ROUTE} may move bytes`).toEqual([]);
  });

  it('the dev blob route is not a route at all in a production build', async () => {
    // Stronger than refusing to serve: `pageExtensions` drops `.dev.ts` in
    // production, so the endpoint is absent from the build rather than present
    // and guarded. A guard can be reached; a file that was never compiled cannot.
    const config = await readCode(join(ROOT, 'next.config.ts'));
    expect(config).toMatch(/pageExtensions/);
    expect(config).toMatch(/NODE_ENV === 'production'[\s\S]*?\['ts', 'tsx'\]/);
    expect(DEV_BLOB_ROUTE.endsWith('route.dev.ts')).toBe(true);
  });

  it('the dev blob route also refuses to load if it ever is built', async () => {
    const source = await readCode(join(ROOT, DEV_BLOB_ROUTE));
    expect(source).toMatch(
      /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*'production'\s*\)\s*\{\s*\n?\s*throw/,
    );
  });

  it('production without R2 refuses to start rather than using local disk', async () => {
    const source = await readCode(join(ROOT, 'src/storage/factory.ts'));
    expect(source).toMatch(/NODE_ENV === 'production'/);
    expect(source).toMatch(/throw new Error/);
  });
});
