/**
 * One list of what may be uploaded, not three.
 *
 * The presign endpoint, the file input's `accept` and the native picker are
 * all answers to the same question, and they had drifted into three different
 * answers — the server and the input both permitted video, which nothing
 * downstream can process, while the design says transcoding stays out until
 * photos work. The answer now lives in `@parea/upload` and is checked against
 * a real libvips in `services/deriver/test/accepted.test.ts`.
 *
 * What this file guards is that the web keeps asking it. A local list here
 * would pass every other test in the repository while being wrong, because
 * every other test would go on asserting the shared value — which is exactly
 * how the old one survived: it was never inconsistent with anything checked.
 *
 * ## No comment stripping, deliberately
 *
 * The obvious way to write this is to strip comments first, the way
 * `egress-invariant.test.ts` does, so that a comment mentioning `video/mp4`
 * does not read as code. It cannot be done here, and finding out why is the
 * reason this note exists: `image/*` contains `/*`, so a naive block-comment
 * regex opens a comment inside the very attribute under test and swallows
 * everything up to the next `*​/`. The first draft of this file did that and
 * passed against a deliberately reverted `accept="image/*,video/*"` — the
 * assertions were fine and the input to them had been eaten.
 *
 * So the assertions below are shaped to be unambiguous in raw source instead.
 * They match code that can only be code: a JSX expression attribute, a call.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MAX_UPLOAD_BYTES, refuseFile } from '@parea/upload';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const source = (path: string) => readFile(join(ROOT, path), 'utf8');

describe('what may be uploaded', () => {
  it('is asked of the shared list by the presign endpoint', async () => {
    const route = await source('app/api/events/[id]/uploads/route.ts');

    expect(route).toMatch(/\bacceptedMime\(/);
    // A local list, in the shape one gets written in: a quoted type. The
    // comments here talk about video without ever quoting a type.
    expect(route).not.toMatch(/['"`]image\//);
    expect(route).not.toMatch(/['"`]video\//);
  });

  it('is asked of the shared list by the file input', async () => {
    const view = await source('app/components/EventView.tsx');

    // The exact attribute, not merely the identifier appearing somewhere —
    // the import alone would satisfy that while the input said `image/*`.
    expect(view).toMatch(/accept=\{ACCEPT_ATTRIBUTE\}/);
    expect(view).not.toMatch(/accept="/);
  });

  it('is applied before a batch is sent, not only by the server', async () => {
    const view = await source('app/components/EventView.tsx');
    const create = await source('app/page.tsx');

    /*
     * `accept` is advice — a drop, or "All Files" in the OS dialog, gets past
     * it. Since the endpoint rejects the whole request rather than the
     * offending file, one stray video would otherwise lose every photo
     * selected with it.
     *
     * `refuseFile` rather than `acceptedMime`, and that is the fix rather than
     * a rename: this was a type check, and a type check is not the whole of
     * what the route refuses. A zero-byte `File` is well typed and perfectly
     * ordinary — a dropped folder, a cloud file the OS never materialised —
     * and it took every photograph beside it down with a 400.
     */
    for (const [where, src] of [['event', view], ['create', create]] as const) {
      expect(src, `${where} page filters before sending`).toMatch(/\brefuseFile\(/);
    }
  });

  it('refuses a file for every reason the route does, and no more', () => {
    /*
     * The client's filter and the route's `parseFiles` are two statements of
     * one rule, and the whole point of sharing `refuseFile` is that they
     * cannot drift. Zero bytes is the one that was missing; the rest are
     * pinned so the next addition to the route has somewhere obvious to go.
     */
    expect(refuseFile({ name: 'a.jpg', size: 10, type: 'image/jpeg' })).toBeNull();
    // Untyped is not refused: browsers fail to type a HEIC and the deriver
    // reads the real format out of the bytes.
    expect(refuseFile({ name: 'a.heic', size: 10, type: '' })).toBeNull();
    expect(refuseFile({ name: 'a.jpg', size: 0, type: 'image/jpeg' })).toBe('empty');
    expect(refuseFile({ name: 'a.jpg', size: -1, type: 'image/jpeg' })).toBe('empty');
    expect(refuseFile({ name: 'a.jpg', size: NaN, type: 'image/jpeg' })).toBe('empty');
    expect(refuseFile({ name: 'a.jpg', size: MAX_UPLOAD_BYTES + 1, type: 'image/jpeg' })).toBe(
      'too_big',
    );
    expect(refuseFile({ name: 'a'.repeat(513), size: 10, type: 'image/jpeg' })).toBe('named');
    expect(refuseFile({ name: 'a.mov', size: 10, type: 'video/quicktime' })).toBe('type');
  });

  it('says which file and why, rather than only that something was wrong', async () => {
    /*
     * `invalid_files` was one string for six conditions, and the note in the
     * route already regretted that the uploader "had no way to know why". Four
     * photographs, a 400, and nothing saying which of the four.
     */
    const route = await source('app/api/events/[id]/uploads/route.ts');
    expect(route).toMatch(/error: 'invalid_files', \.\.\.parsed/);
    expect(route).toMatch(/reason: 'empty_file', at, name: named/);
    expect(route).toMatch(/reason: 'unacceptable_type', at, name: named/);
    // The bound is the shared one, so the client can skip rather than be told.
    expect(route).toMatch(/const MAX_BYTES_PER_FILE = MAX_UPLOAD_BYTES;/);
  });
});
