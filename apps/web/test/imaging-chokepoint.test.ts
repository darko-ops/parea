/**
 * One door to the decoder — `src/imaging.ts`, and why a comment was not enough.
 *
 * Two routes in this app decode bytes somebody uploaded: the profile picture
 * and the event cover. Both called `sharp()` directly, and both were missing
 * the same two things — a check on what the file actually is, and a ceiling on
 * how many pixels it may expand to. Neither omission looks like a bug. The
 * routes work, the tests pass, the pictures appear; what is wrong is only
 * visible to somebody who uploads a TIFF that is not a TIFF.
 *
 * That is the same shape as the authorization problem next door in
 * `access-chokepoint.test.ts`, so it gets the same answer: the rule is a test
 * rather than a paragraph. `imaging.ts` is the only file in `apps/web` allowed
 * to import sharp, and a third route that needs to decode something has to go
 * through it — which means it cannot forget the two options, because it never
 * names them.
 *
 * The scan is over `app/` and `src/`. Tests are deliberately outside it:
 * `cover-framing.test.ts` and `icon-dark.test.ts` both import sharp to read
 * pixels back out of a rendered image, which is what a test should do and has
 * nothing to do with decoding an upload.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The one file permitted to import sharp, relative to the app root. */
const DOOR = 'src/imaging.ts';

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...(await walk(full)));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function sources(): Promise<{ path: string; source: string }[]> {
  const paths = [
    ...(await walk(join(ROOT, 'app'))),
    ...(await walk(join(ROOT, 'src'))),
  ];
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(ROOT, path),
      // Comments first, exactly as the other scans do: this file and
      // `imaging.ts` both quote `from 'sharp'` in their own headers, and a
      // scan of raw source would flag the explanation as the violation.
      source: stripComments(await readFile(path, 'utf8')),
    })),
  );
}

const IMPORTS_SHARP = /(^|\s)(import|require)\s*\(?\s*.*['"]sharp['"]/m;

describe('the decoder chokepoint', () => {
  it('is the only file in the app that imports sharp', async () => {
    const offenders = (await sources())
      .filter(({ path, source }) => path !== DOOR && IMPORTS_SHARP.test(source))
      .map(({ path }) => path);

    expect(
      offenders,
      `these import sharp directly and so decode without the type check and ` +
        `pixel ceiling in ${DOOR}; import { admit, decode } from '@/imaging' ` +
        `instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  /*
   * The door itself has to keep doing the two things it exists for.
   *
   * Asserted on the source rather than by calling it, because what is being
   * pinned is that the options are present at the single construction site —
   * a behavioural test would pass just as well against a `decode()` that had
   * quietly lost `limitInputPixels`, as long as the image it was given was
   * small.
   */
  it('bounds every decode it constructs', async () => {
    const source = stripComments(await readFile(join(ROOT, DOOR), 'utf8'));

    expect(source).toMatch(/limitInputPixels:\s*MAX_INPUT_PIXELS/);
    expect(source).toMatch(/failOn:\s*'error'/);
    // The restriction is applied at module load, not from a start-up hook
    // that a cold serverless instance could reach a decode without running.
    expect(source).toMatch(/^restrictDecoders\(sharp\);$/m);
  });

  /*
   * And it has to refuse before it decodes.
   *
   * `admit` is the half that means an unaccepted file never reaches native
   * code at all. A `decode()` with the right options on a PDF is still a
   * poppler parse.
   */
  it('sniffs the file before anything decodes it', async () => {
    const source = stripComments(await readFile(join(ROOT, DOOR), 'utf8'));
    expect(source).toMatch(/sniffImageMime\(/);
  });
});
