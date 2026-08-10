import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each suite starts its own in-memory Postgres (PGlite). Running the files
    // in parallel means that many Postgres instances at once, which fell over
    // as soon as there were five — and it fails at collection, so it reads as
    // a broken import rather than exhaustion. Serial files, parallel tests.
    fileParallelism: false,
  },
});
