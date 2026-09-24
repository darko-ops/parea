/**
 * The two files that decide whether a tapped link opens the app — design §9.
 *
 * Both are fetched once, by an operating system, and cached. Nothing in the
 * product notices when they are wrong: a link simply opens the browser, which
 * is indistinguishable from not having the app installed. So the failure modes
 * worth testing are the quiet ones — a malformed identifier that still
 * produces valid JSON, a missing fingerprint, a file served under a
 * content-type nobody accepts.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { GET as aasa } from '../app/.well-known/apple-app-site-association/route';
import { GET as assetlinks } from '../app/.well-known/assetlinks.json/route';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, appIdentifier, androidFingerprints } from '../src/deeplinks';

const TEAM = 'ABCDE12345';
const PRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0'))
  .join(':')
  .toUpperCase();

afterEach(() => {
  delete process.env.APPLE_TEAM_ID;
  delete process.env.ANDROID_CERT_FINGERPRINTS;
});

describe('the identifiers the files claim', () => {
  it('match the ones the app ships with', async () => {
    // The single source of truth is apps/mobile/app.json; this asserts the
    // copy the server serves has not drifted from it. Claiming links for an
    // app identifier that does not exist is silent in both directions.
    const appJson = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../mobile/app.json', import.meta.url).pathname,
        'utf8',
      ),
    );
    const expo = JSON.parse(appJson).expo;
    expect(IOS_BUNDLE_ID).toBe(expo.ios.bundleIdentifier);
    expect(ANDROID_PACKAGE).toBe(expo.android.package);
  });
});

describe('apple-app-site-association', () => {
  it('is absent rather than wrong when the Team ID is missing', async () => {
    // Apple caches this hard. A file naming the wrong team is a link that
    // stays broken long after someone fixes the variable.
    expect((await aasa()).status).toBe(404);
  });

  it('is absent rather than wrong when the Team ID is malformed', async () => {
    for (const bad of ['abc', 'ABCDE1234', 'ABCDE12345 extra', '']) {
      process.env.APPLE_TEAM_ID = bad;
      expect((await aasa()).status, bad).toBe(404);
    }
  });

  it('tolerates the whitespace and case a copied dashboard value arrives with', async () => {
    process.env.APPLE_TEAM_ID = `  ${TEAM.toLowerCase()}\n`;
    expect(appIdentifier()).toBe(`${TEAM}.${IOS_BUNDLE_ID}`);
  });

  it('names the app and claims only the link path', async () => {
    process.env.APPLE_TEAM_ID = TEAM;
    const res = await aasa();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = await res.json();
    const [detail] = body.applinks.details;
    expect(detail.appIDs).toEqual([`${TEAM}.${IOS_BUNDLE_ID}`]);
    // `/event/<id>` must not be claimed: it works in a browser only because
    // the link was already exchanged for a cookie, and the app cannot use it.
    expect(JSON.stringify(detail.components)).toContain('/e/*');
    expect(JSON.stringify(detail.components)).not.toContain('/event');
  });
});

describe('assetlinks.json', () => {
  it('is absent rather than wrong without a fingerprint', async () => {
    expect((await assetlinks()).status).toBe(404);
  });

  it('rejects a fingerprint that is not one', async () => {
    for (const bad of ['abc', PRINT.slice(0, -3), PRINT.replaceAll(':', '')]) {
      process.env.ANDROID_CERT_FINGERPRINTS = bad;
      expect(androidFingerprints(), bad).toEqual([]);
    }
  });

  it('carries every certificate, because there are usually two', async () => {
    // The upload key and the key Google re-signs with under Play App Signing.
    // Ship one and verification fails for everyone who installed from the
    // store, which is everyone.
    const second = PRINT.replace(/^00/, 'FF');
    process.env.ANDROID_CERT_FINGERPRINTS = `${PRINT}, ${second}`;

    const body = await (await assetlinks()).json();
    expect(body[0].target.sha256_cert_fingerprints).toEqual([PRINT, second]);
    expect(body[0].target.package_name).toBe(ANDROID_PACKAGE);
    expect(body[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });
});

/**
 * The association files, and the redirect that used to hide them.
 *
 * `parea.photos` was redirected to `www.parea.photos` by a project-level 308
 * on Vercel — all-or-nothing, with no way to exempt a path. Both of these
 * files are fetched by a platform deciding whether this app may claim links on
 * a host, and neither iOS nor Android follows a redirect to find one. So the
 * apex could never be verified: every `parea.photos/e/<token>` link opened a
 * browser however the app was configured, and nothing anywhere said why.
 *
 * The redirect lives in `next.config.ts` now, where it can carve out one path.
 * These check the carve-out is still there and still cannot loop.
 */
describe('the apex redirect leaves the association files alone', () => {
  const CONFIG = readFileSync(
    fileURLToPath(new URL('../next.config.ts', import.meta.url).href),
    'utf8',
  );

  it('exempts /.well-known and nothing else', () => {
    expect(CONFIG).toMatch(/source: '\/:path\(\(\?!\\\\\.well-known\/\)\.\*\)'/);
    // And the bare host, which the pattern above cannot match: `/:path(...)`
    // does not match an empty path, so `/` needs its own rule or the apex
    // home page silently stops redirecting.
    expect(CONFIG).toMatch(/source: '\/',\s*\n\s*has: apex/);
  });

  it('matches the apex only, so it cannot redirect to itself', () => {
    /*
     * `has.value` is compiled as `new RegExp('^' + value + '$')`, so an
     * anchored `parea\.photos` cannot match `www.parea.photos`. Without the
     * anchoring this would be an infinite redirect on the live site, which is
     * why the escaping is asserted rather than assumed: an unescaped dot also
     * matches `pareaXphotos`, and the day that resolves is the day this loops.
     */
    expect(CONFIG).toMatch(/value: 'parea\\\\\.photos'/);
    expect(CONFIG).toMatch(/destination: 'https:\/\/www\.parea\.photos/);
  });

  it('keeps both files fail-closed when unconfigured', () => {
    // A file naming the wrong team or no fingerprint verifies nothing and is
    // cached hard by both platforms. Absent beats wrong.
    const aasa = readFileSync(
      fileURLToPath(
        new URL('../app/.well-known/apple-app-site-association/route.ts', import.meta.url).href,
      ),
      'utf8',
    );
    const links = readFileSync(
      fileURLToPath(new URL('../app/.well-known/assetlinks.json/route.ts', import.meta.url).href),
      'utf8',
    );
    for (const [name, source] of [['aasa', aasa], ['assetlinks', links]] as const) {
      expect(source, name).toMatch(/status: 404/);
    }
  });
});
