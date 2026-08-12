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

    // `accept` is advice — a drop, or "All Files" in the OS dialog, gets past
    // it. Since the endpoint rejects the whole request rather than the
    // offending file, one stray video would otherwise lose every photo
    // selected with it.
    expect(view).toMatch(/\bacceptedMime\(/);
  });
});
