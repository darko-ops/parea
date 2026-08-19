/**
 * Crash reporting, on the server and nowhere else.
 *
 * ## Why there is no client config beside this file
 *
 * The privacy page says "No third-party analytics or tracking SDK, in the app
 * or on the web", and `docs/design.md` makes the same promise as an
 * architectural one. Sentry's standard Next.js setup ships an
 * `instrumentation-client.ts` that puts their SDK in every visitor's browser
 * and contacts `ingest.sentry.io` from the page. That would make a published
 * claim false, so it is deliberately absent — and its absence is asserted by a
 * test, because the way it comes back is somebody running the Sentry wizard
 * and committing what it generates.
 *
 * What is lost by that is real and worth naming: a React render error in
 * somebody's browser is invisible here. What is kept is the thing that was
 * actually missing — a server exception, with a stack trace and a source map,
 * instead of a 500 in `vercel logs` with nothing attached to it.
 *
 * ## What is turned off, and why
 *
 * Everything that would carry somebody's evening out of this deployment.
 * Session Replay is the loudest one: it records the DOM, and the DOM here is
 * other people's photographs. `sendDefaultPii` stays off so headers, cookies
 * and IP addresses are not attached. Logs are not forwarded, because a log
 * line can contain anything and nothing reads them at the other end.
 *
 * Traces are off rather than sampled low. A trace is a list of URLs by
 * another name, and the URLs are the part of this product that has to be
 * handled carefully — see `redact.ts`. If tracing is ever wanted, it goes
 * through the same redaction and gets its own decision, rather than arriving
 * as a default nobody chose.
 */

import * as Sentry from '@sentry/nextjs';

import { redactEvent } from '@/redact';

Sentry.init({
  /*
   * Absent in development and in tests, and that is the intended state: the
   * SDK no-ops without a DSN, so nothing has to be conditionally imported and
   * local work never reports. The value is set on Preview and Production by
   * the Vercel integration.
   */
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Which deployment an error came from. Without it, Preview and Production
  // errors land in one list and the first question about any of them —
  // "is this live?" — cannot be answered.
  environment: process.env.VERCEL_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // Headers, cookies and the client IP. The IP is the one that matters: it is
  // a fact about a person, collected for no reason anybody asked for.
  sendDefaultPii: false,

  // A trace is a list of URLs. See the header.
  tracesSampleRate: 0,
  enableLogs: false,

  /*
   * The last thing that happens before anything leaves.
   *
   * Applied to breadcrumbs as well as to the event: a breadcrumb is where a
   * presigned storage URL would appear, and it is the trail nobody thinks to
   * check. Both hooks route through one function so the rule cannot hold in
   * one place and not the other.
   */
  beforeSend: (event) => redactEvent(event),
  beforeBreadcrumb: (breadcrumb) => redactEvent(breadcrumb),
});
