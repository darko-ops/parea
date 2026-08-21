/**
 * What may leave this deployment when something goes wrong.
 *
 * Crash reporting is the first thing in this product that sends anything to a
 * third party, which makes it the first thing that can quietly break two
 * promises at once.
 *
 * The first is on the privacy page, in words, to everybody who reads it: "No
 * third-party analytics or tracking SDK, in the app or on the web." That
 * survives only while the Sentry SDK runs on the server and never in a
 * browser, and the way it stops surviving is somebody running the Sentry
 * wizard — which writes `instrumentation-client.ts` without asking — and
 * committing what it generated.
 *
 * The second is design §3: the link *is* the credential. `/e/<token>` is the
 * one URL in this product that is a key, and an error report is mostly a URL.
 *
 * Both are tested here rather than trusted to the config, because both fail
 * silently and neither shows up in anything anybody looks at.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { redactEvent, redactUrl } from '@/redact';
import { stripComments } from './support/source';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => stripComments(readFileSync(at(path), 'utf8'));

describe('the SDK runs on the server and nowhere else', () => {
  it('ships no client config, however convenient the wizard makes it', () => {
    /*
     * The file Sentry's setup wizard writes. Its presence is what would put
     * their SDK in a visitor's browser and make the privacy page wrong, and
     * it arrives without a decision being taken — which is exactly why this
     * is a test and not a note.
     */
    expect(existsSync(at('../instrumentation-client.ts'))).toBe(false);
    expect(existsSync(at('../sentry.client.config.ts'))).toBe(false);
  });

  it('starts the SDK only in the Node runtime', () => {
    const INSTRUMENTATION = read('../instrumentation.ts');
    expect(INSTRUMENTATION).toMatch(
      /process\.env\.NEXT_RUNTIME === 'nodejs'[\s\S]{0,80}sentry\.server\.config/,
    );
    // The hook that turns a 500 into a stack trace. Without it this whole
    // installation reports almost nothing a log did not already say.
    expect(INSTRUMENTATION).toMatch(/onRequestError = Sentry\.captureRequestError/);
  });

  it('never asks a browser to load anything of Sentry’s', () => {
    // `tunnelRoute` proxies ingest through this origin to get past ad
    // blockers; it is meaningless without a browser SDK and would be a route
    // on this domain that forwards to a third party.
    const CONFIG = read('../next.config.ts');
    expect(CONFIG).toMatch(/widenClientFileUpload: false/);
    expect(CONFIG).toMatch(/tunnelRoute: undefined/);
  });

  it('keeps the privacy page’s claim, which all of the above is for', () => {
    // If this line is ever softened, the tests above are enforcing a promise
    // nobody is making any more — and should be revisited rather than left.
    const PRIVACY = readFileSync(at('../app/privacy/page.tsx'), 'utf8');
    expect(PRIVACY).toMatch(/No third-party analytics or tracking SDK, in the app or on the web/);
  });
});

describe('what is switched off', () => {
  const SERVER = read('../sentry.server.config.ts');

  it('records nobody’s screen', () => {
    // Session Replay records the DOM. On this product the DOM is other
    // people's photographs.
    expect(SERVER).not.toMatch(/replayIntegration|replaysSessionSampleRate/);
  });

  it('attaches no headers, cookies or IP address', () => {
    expect(SERVER).toMatch(/sendDefaultPii: false/);
  });

  it('forwards no traces and no logs', () => {
    // A trace is a list of URLs by another name, and a log line can contain
    // anything at all.
    expect(SERVER).toMatch(/tracesSampleRate: 0/);
    expect(SERVER).toMatch(/enableLogs: false/);
  });

  it('redacts on the way out, on both hooks', () => {
    // A breadcrumb is where a presigned storage URL shows up, and it is the
    // trail nobody thinks to check.
    expect(SERVER).toMatch(/beforeSend: \(event\) => redactEvent\(event\)/);
    expect(SERVER).toMatch(/beforeBreadcrumb: \(breadcrumb\) => redactEvent\(breadcrumb\)/);
  });
});

describe('a report cannot carry the credential', () => {
  it('reduces a share link to its shape', () => {
    // The whole point. Anybody who can read the crash dashboard would
    // otherwise be able to open the event.
    expect(redactUrl('https://www.parea.photos/e/abc123secret')).toBe(
      'https://www.parea.photos/e/[token]',
    );
    expect(redactUrl('/e/abc123secret')).toBe('/e/[token]');
  });

  it('leaves an event id legible, because it is not a secret', () => {
    // Every route behind an id checks access again. Redacting these would
    // cost the reports most of their value for no gain.
    expect(redactUrl('/event/8f2c/p/91')).toBe('/event/8f2c/p/91');
  });

  it('drops every query string rather than filtering one', () => {
    /*
     * An allowlist of safe parameters has to be updated whenever a route
     * gains one, and the update that gets forgotten is the leak. A presigned
     * storage URL is an hour of access to somebody's photograph.
     */
    expect(redactUrl('https://img.example/photo.jpg?X-Amz-Signature=deadbeef&X-Amz-Expires=3600'))
      .toBe('https://img.example/photo.jpg');
    expect(redactUrl('/events?q=whose+wedding')).toBe('/events');
  });

  it('refuses to guess at something it cannot parse', () => {
    // A string this function does not understand is one it cannot promise
    // anything about, so it is dropped rather than passed along.
    expect(redactUrl('http://')).toBe('[unparseable]');
    expect(redactUrl('https://a b c')).toBe('[unparseable]');
  });

  it('treats anything else as a path, which is the safe reading', () => {
    // Nonsense parses as a relative path against the placeholder origin. That
    // is fine and is the point of the placeholder: the output is escaped, has
    // no query string left on it, and matches no secret prefix.
    expect(redactUrl('%%%not a url%%%')).toBe('/%%%not%20a%20url%%%');
  });

  it('finds a URL wherever it is nested, not only where the schema puts it', () => {
    /*
     * Keyed on the name rather than on a path into the event, because the
     * event shape belongs to the SDK and moves between versions — and a rule
     * that silently stops matching after an upgrade is worse than no rule.
     */
    const scrubbed = redactEvent({
      request: { url: 'https://www.parea.photos/e/secret', method: 'GET' },
      breadcrumbs: [{ data: { url: '/e/other', href: '/e/third' } }],
      contexts: { trace: { referrer: 'https://www.parea.photos/e/fourth' } },
    });

    expect(JSON.stringify(scrubbed)).not.toMatch(/secret|other|third|fourth/);
    // Everything that was not a URL is untouched: a redactor that flattened
    // the report would leave nothing worth reading.
    expect(scrubbed.request.method).toBe('GET');
  });

  it('terminates on a cyclic report rather than hanging the process', () => {
    // A crash report is never worth a hung server.
    const loop: Record<string, unknown> = { url: '/e/secret' };
    loop.self = loop;
    expect(() => redactEvent(loop)).not.toThrow();
  });
});
