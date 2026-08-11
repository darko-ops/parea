import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Each suite starts its own in-memory Postgres (PGlite). Running the files
    // in parallel means that many Postgres instances at once, which fell over
    // as soon as there were five — and it fails at collection, so it reads as
    // a broken import rather than exhaustion. Serial files, parallel tests.
    fileParallelism: false,
    // Spinning up PGlite and applying every migration is the slowest thing in
    // this suite, and it happens in a `beforeAll` for most files. Vitest's
    // 10s default is comfortable on a warm machine and marginal on a cold or
    // loaded one — it was measured here at 9.7s passing and 13.0s failing
    // within a minute, on the same commit. A hook timeout that depends on how
    // busy the box is fails as a broken import rather than as a slow one,
    // which sends whoever sees it looking in the wrong place.
    hookTimeout: 60_000,
  },
});
