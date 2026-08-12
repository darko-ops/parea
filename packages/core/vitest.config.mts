import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    /*
     * The same settings `apps/web` and `services/deriver` already carry, and
     * for the same reason — this was the one PGlite workspace with no config
     * at all, so it ran on vitest's 10-second default.
     *
     * Standing up an in-memory Postgres and applying every migration happens
     * in a `beforeAll`, and it is the slowest thing in the suite. Ten seconds
     * is comfortable on a warm machine and marginal on a loaded one: it was
     * measured here at 4.7s passing and timing out at 10s within a few
     * minutes, on the same commit and the same code.
     *
     * What makes that worth fixing rather than re-running is how it fails. A
     * hook timeout is reported as a failed *suite*, not a slow test — the
     * output says the file could not be collected and points at the
     * `beforeAll` line, which reads like a broken import and sends whoever
     * sees it looking in the wrong place entirely.
     */
    hookTimeout: 60_000,
    /*
     * Each suite starts its own Postgres, so running files in parallel means
     * that many at once. It fails at collection when they exhaust the box,
     * which looks like the same broken import. Serial files, parallel tests.
     */
    fileParallelism: false,
  },
});
