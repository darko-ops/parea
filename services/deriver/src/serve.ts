/**
 * Work arriving instead of being looked for.
 *
 * `watch` asks Postgres every five seconds whether anything is pending. The
 * asking is the cost: Neon suspends a compute only once nothing is connected,
 * so a poll loop is a machine that never lets the database sleep. Forty days
 * of it exhausted a month's quota and took sign-in down with it — the queries
 * were free, the wakefulness was not.
 *
 * This is the same pipeline with the trigger inverted. QStash delivers one
 * HTTP request per photo, the handler processes it, and the response is the
 * receipt. In between, nothing runs.
 *
 * ## Why the response is sent only when the work is done
 *
 * Because the request is also what keeps the machine alive. Fly stops a
 * machine when nothing is in flight, so a handler that answered 200 and
 * carried on working would be a handler that gets killed halfway. Holding the
 * request open makes "still working" and "still needed" the same fact, and
 * QStash's free plan allows fifteen minutes for a response — two orders of
 * magnitude more than a derive takes.
 *
 * It also removes a whole apparatus. Acking on receipt would mean claims,
 * claim expiry, a sweep to reclaim what a dead worker held, and a scheduler to
 * run the sweep. Acking on completion means a crash simply never answers, and
 * QStash redelivers twelve seconds later. The retry is somebody else's
 * problem, which is the point of paying them.
 *
 * ## What the status codes mean to QStash
 *
 *   200  done, or already done — stop
 *   409  this photo is being processed right now — come back
 *   429  this machine is full — come back
 *   489  terminal, with `Upstash-NonRetryable-Error` — to the dead letter queue
 *   500  something broke — come back
 *
 * Anything that is not 2xx is retried on QStash's backoff: twelve seconds,
 * then two and a half minutes, then half an hour. The early attempts are the
 * useful ones, which is why 409 and 429 are answers rather than waits — a
 * handler that blocked until a slot freed would hold a request open doing
 * nothing and eventually time out, turning "busy" into "failed".
 */

import { processPhoto, type Deps, type Outcome } from './pipeline';

/** What a delivery is answered with. */
export type Reply = {
  status: number;
  body: string;
  /** Set on a terminal failure, so QStash stops rather than backing off. */
  nonRetryable?: boolean;
};

/**
 * How many photos this machine derives at once.
 *
 * One, because the machine has one core. Measured on `parea-deriver` itself:
 * 1 CPU, 1969MB. A second concurrent derive would not finish sooner, it would
 * contend for the only processor there is.
 *
 * Memory, which is what this was first justified on, turns out not to be the
 * constraint. Peak RSS on that machine, deriving all five sizes:
 *
 *   12MP  iPhone            0.4s   171MB
 *   48MP  iPhone Pro        0.5s   325MB
 *   100MP                   0.6s   295MB
 *   289MP 17000x17000       1.2s   173MB
 *
 * The largest input is the cheapest of the three big ones because sharp
 * shrinks on load for JPEG — it decodes straight to the size being asked for
 * and never holds the full raster. Those are flat synthetic images, so a real
 * photograph will be some multiple slower; it is not going to be a different
 * order of magnitude.
 *
 * What none of it measures is HEIC at size. libheif cannot shrink on load, so
 * that is the case the 2GB was chosen for, and the only HEIC available to
 * measure is a 64x48 fixture. Raising this number is still a memory decision
 * on that path, and an unmeasured one.
 *
 * The headroom that matters for the design is time rather than space: about a
 * second against a fifteen-minute response deadline. That is what makes
 * answering on completion safe rather than hopeful.
 */
export const DEFAULT_CONCURRENCY = 1;

export function createHandler(
  deps: Deps,
  options: { concurrency?: number } = {},
): (photoId: string) => Promise<Reply> {
  const limit = options.concurrency ?? DEFAULT_CONCURRENCY;

  /*
   * The photos this process is working on, and the count of them.
   *
   * In-process rather than a column, because the thing being prevented is two
   * *concurrent* deliveries of the same photo, and `fly.toml` runs one machine
   * on purpose — two would race on the same rows, which the pipeline is not
   * built for. A claim column would be the answer to a second machine and
   * would bring claim expiry and a sweep back with it; if a second machine
   * ever exists, that is the change to make, and this is the line that should
   * stop it being forgotten.
   *
   * Duplicate delivery is not hypothetical: QStash is at-least-once, and its
   * deduplication window is ten minutes, so the same photo can arrive twice by
   * design. A duplicate that lands *after* the first finished is handled a
   * layer down — `processPhoto` returns early on `ready` — and this catches
   * the one that lands while it is still running.
   */
  const inFlight = new Set<string>();

  return async function handle(photoId: string): Promise<Reply> {
    if (!photoId) return { status: 400, body: 'photoId required', nonRetryable: true };

    if (inFlight.has(photoId)) {
      return { status: 409, body: `already processing ${photoId}` };
    }
    if (inFlight.size >= limit) {
      return { status: 429, body: `at capacity (${limit})` };
    }

    inFlight.add(photoId);
    try {
      const outcome: Outcome = await processPhoto(deps, photoId);
      /*
       * Three of the four outcomes are finished work, not success and two
       * kinds of failure.
       *
       * `deduped` means these bytes were already in the album under a content
       * hash that matched; `quarantined` means the scanner found something and
       * the pipeline did exactly what it exists to do. Retrying either would
       * re-run a decision that has already been made correctly — and in the
       * second case would re-submit somebody's photograph to a scanner for no
       * reason. Only `failed` is a thing that went wrong.
       */
      if (outcome.status !== 'failed') {
        console.log(`${outcome.status.padEnd(11)} ${photoId}`);
        return { status: 200, body: `${outcome.status} ${photoId}` };
      }
      /*
       * The pipeline has already written `failed` to the row and decided this
       * is terminal — see the note above `fail`, which is only safe to be
       * terminal because of the gate that lets a photo through in the first
       * place. Retrying it would re-reach the same decision every twelve
       * seconds, so it goes to the dead letter queue instead, where it is a
       * thing somebody can look at rather than a thing that keeps happening.
       */
      /*
       * Said out loud, because nothing else says it.
       *
       * `fail` writes `failed` to the row and returns the reason; the row has
       * no column for it and this reply goes to QStash. So in `serve` — the
       * only mode production runs — the reason existed for the length of one
       * function call and was then gone. Every HEIC upload failed for weeks
       * with a decoder error nobody could see, and finding it meant putting a
       * row back to `pending` and draining it by hand to make `drain` print
       * the same string this line now prints.
       *
       * One line per delivery, success or not. A worker whose only failure
       * mode is invisible is one that fails quietly for as long as nobody
       * happens to look at the photographs.
       */
      console.error(`failed      ${photoId}  ${outcome.reason}`);
      return {
        status: 489,
        body: `failed ${photoId}: ${outcome.reason}`,
        nonRetryable: true,
      };
    } catch (err) {
      // Thrown rather than returned means the pipeline did not get far enough
      // to decide anything — a dropped connection, a storage timeout. The row
      // is untouched and the work is worth attempting again.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`threw       ${photoId}  ${message.split('\n')[0]}`);
      return { status: 500, body: message };
    } finally {
      inFlight.delete(photoId);
    }
  };
}
