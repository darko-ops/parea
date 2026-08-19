/**
 * Next's hook for starting something before the app serves anything.
 *
 * One job: bring up server-side crash reporting. The import is dynamic and
 * guarded on the runtime because that is the contract — the config calls
 * `Sentry.init`, and initialising the Node SDK in a runtime that is not Node
 * is how you get a build that fails somewhere unrelated.
 *
 * There is no edge branch. Nothing in this app runs on the edge runtime: every
 * route handler declares `runtime = 'nodejs'` and there is no middleware, so
 * an edge config would be a file that exists to be found by whoever wonders
 * later whether it is wired up. It goes in when something edge-side does.
 *
 * `onRequestError` is the part that makes this worth having. Without it, an
 * exception thrown while rendering a server component is a 500 in the log and
 * nothing else; with it, the same exception arrives with a stack trace, the
 * route that threw, and a source map pointing at real lines.
 */

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
