import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each suite starts its own in-memory Postgres (PGlite). Running the files
    // in parallel means that many Postgres instances at once, which fell over
    // as soon as there were five — and it fails at collection, so it reads as
    // a broken import rather than exhaustion. Serial files, parallel tests.
    fileParallelism: false,
    // These tests shell out to the real tools — exiftool, libvips, libheif —
    // because mocking them would mean testing a description of image
    // processing rather than image processing. That is the right trade and it
    // makes the tests genuinely slow: the dedup pair overran vitest's 5s
    // default at 5070ms on a loaded machine, having passed comfortably on the
    // same commit an hour earlier. A timeout tuned to how busy the box is
    // reports real work as a hang.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
