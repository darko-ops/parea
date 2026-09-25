/**
 * The identifiers, which have to agree with each other and cannot be changed later.
 *
 * A bundle identifier is permanent from the first upload to App Store Connect;
 * so is an Android package name from the first Play release. That makes this
 * the one file in the repository where a typo is unfixable rather than
 * inconvenient, which is why it is asserted rather than eyeballed.
 *
 * The domain appears in four places — the iOS associated-domains entitlement,
 * the Android intent filter, and both application identifiers by reverse-DNS.
 * Three of the four can be wrong without anything failing to build: deep links
 * simply stop opening the app and fall through to the browser, which looks
 * like a product decision rather than a bug.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8'),
  );

const app = read('app.json').expo;
const eas = read('eas.json');
/** For the one question that is about what is installed, not what is declared. */
const pkg = read('package.json');

const DOMAIN = 'parea.photos';
/**
 * The host the app actually talks to, which is not the one people type.
 *
 * `parea.photos` answers 308 to `www.parea.photos`. That is invisible in a
 * browser and expensive in an app: a redirect on every request, and a session
 * cookie set by whichever host answered rather than the one that was asked.
 *
 * Deliberately a second constant rather than a change to `DOMAIN` above, which
 * is about the links people tap — `applinks:` and the Android intent filter
 * both match on the apex, and a universal link is matched before anything is
 * fetched, so the redirect never enters into it.
 */
const API_ORIGIN = `https://www.${DOMAIN}`;
/**
 * Both hosts a link can arrive on.
 *
 * `ShareEvent` builds a link from whatever host the person copying it is
 * looking at, and the site answers on both — so half the links in circulation
 * say `www` and half do not. A link that matches neither entitlement nor
 * intent filter opens Safari or Chrome instead of the app, which reads as a
 * product that does not have deep links rather than as one host missing from
 * a list.
 *
 * The apex is not redundant just because it redirects. Both platforms match
 * the host *before* fetching anything, so a `parea.photos` link is claimed by
 * the app and never makes the redirect at all.
 */
const LINK_HOSTS = [DOMAIN, `www.${DOMAIN}`];
/** Reverse-DNS of the domain, which is the convention both stores expect. */
const APP_ID = DOMAIN.split('.').reverse().join('.');

describe('identifiers', () => {
  it('are the real ones, not placeholders', () => {
    // `com.example.parea` and `parea.example` shipped in this file for a
    // while. Uploading either once is permanent.
    const raw = JSON.stringify(app);
    expect(raw).not.toMatch(/example/i);
    expect(raw).not.toMatch(/changeme|placeholder|yourdomain/i);
  });

  it('agree across both platforms', () => {
    expect(app.ios.bundleIdentifier).toBe(APP_ID);
    expect(app.android.package).toBe(APP_ID);
  });

  it('point the iOS entitlement at every host a link arrives on', () => {
    for (const host of LINK_HOSTS) {
      expect(app.ios.associatedDomains, `${host} is not claimed`).toContain(
        `applinks:${host}`,
      );
    }
  });

  /**
   * Passkeys need both halves of the same claim, and neither half errors alone.
   *
   * iOS will not let the app assert for `parea.photos` unless the app declares
   * `webcredentials:parea.photos` *and* the AASA file names this app under
   * `webcredentials`. Ship one without the other and the Face ID sheet simply
   * never appears — no exception, nothing logged, and the app falls back to a
   * code as though the person had no passkey. That is indistinguishable from
   * working software, which is why it is asserted here rather than noticed.
   */
  it('claim web credentials on both halves, or the passkey sheet never opens', () => {
    expect(app.ios.associatedDomains).toContain('webcredentials:parea.photos');

    const aasa = readFileSync(
      fileURLToPath(new URL('../../web/app/.well-known/apple-app-site-association/route.ts', import.meta.url)),
      'utf8',
    );
    // The same identifier the links use, because it is the same app. An empty
    // `apps: []` is what this said before passkeys existed, and is the exact
    // shape of the silent failure above.
    expect(aasa).toMatch(/webcredentials: \{ apps: \[appID\] \}/);
  });

  it('point the Android intent filter at the same hosts and path', () => {
    const [filter] = app.android.intentFilters;
    expect(filter.autoVerify, 'without this Android never verifies the link').toBe(true);
    for (const host of LINK_HOSTS) {
      expect(filter.data, `${host} is not claimed`).toContainEqual({
        scheme: 'https',
        host,
        // `/e/<token>` is the link people are actually sent — see design §9.
        pathPrefix: '/e',
      });
    }
  });

  it('keep the custom scheme, which is the fallback when the link is not verified', () => {
    expect(app.scheme).toBe('parea');
  });
});

describe('what App Store review asks for', () => {
  it('declares no tracking, and no tracking domains', () => {
    expect(app.ios.privacyManifests.NSPrivacyTracking).toBe(false);
    expect(app.ios.privacyManifests.NSPrivacyTrackingDomains).toEqual([]);
  });

  it('declares the photos it receives', () => {
    // Under-declaring is a rejection. The open question is precise location,
    // which arrives inside the original and is stripped at ingest — see the
    // note in the mobile README before answering the nutrition labels.
    const types = app.ios.privacyManifests.NSPrivacyCollectedDataTypes.map(
      (t: any) => t.NSPrivacyCollectedDataType,
    );
    expect(types).toContain('NSPrivacyCollectedDataTypePhotosorVideos');
  });

  it('declares the push token, which is an identifier whether or not it feels like one', () => {
    const types = app.ios.privacyManifests.NSPrivacyCollectedDataTypes.map(
      (t: any) => t.NSPrivacyCollectedDataType,
    );
    expect(types).toContain('NSPrivacyCollectedDataTypeDeviceID');
  });

  it('gives every declared type a reason', () => {
    for (const type of app.ios.privacyManifests.NSPrivacyCollectedDataTypes) {
      expect(type.NSPrivacyCollectedDataTypePurposes.length).toBeGreaterThan(0);
    }
    for (const api of app.ios.privacyManifests.NSPrivacyAccessedAPITypes) {
      expect(api.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
    }
  });

  it('answers the export-compliance question in the file', () => {
    // Otherwise App Store Connect asks it by hand on every single submission.
    expect(app.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('lists a config plugin for every native module that needs one', () => {
    // Autolinking wires up the native code; it does not apply config plugins.
    // A missing one here is a missing entitlement or usage string at runtime.
    const listed = app.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
    for (const plugin of [
      'expo-image-picker',
      'expo-media-library',
      'expo-camera',
      'expo-notifications',
      'expo-secure-store',
    ]) {
      expect(listed, plugin).toContain(plugin);
    }
  });

  it('explains every permission it asks for in the words a person will read', () => {
    const strings = app.plugins
      .filter(Array.isArray)
      .flatMap((p: any[]) => Object.values(p[1] ?? {}))
      .filter((v: unknown): v is string => typeof v === 'string');
    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      // "This app needs photo access" is a rejection and, worse, a denial.
      expect(text.length, text).toBeGreaterThan(25);
      expect(text, text).toMatch(/[.!]$/);
    }
  });
});

describe('build profiles', () => {
  it('has the three the workflow actually uses', () => {
    expect(Object.keys(eas.build)).toEqual(
      expect.arrayContaining(['development', 'preview', 'production']),
    );
  });

  it('builds a dev client rather than expecting Expo Go', () => {
    // Every native module here — background upload, granular photo
    // permissions, the camera — is unavailable in Expo Go.
    expect(eas.build.development.developmentClient).toBe(true);
  });

  it('lets EAS own the build number', () => {
    // A duplicate build number is rejected at upload, after the build has
    // already been paid for and waited on.
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production.autoIncrement).toBe(true);
  });

  it('points every profile at somewhere that exists', () => {
    /*
     * This used to require three distinct URLs, which sounds stricter and was
     * not: it was satisfied by `staging.parea.photos`, a host nobody ever
     * stood up, and it enforced that fiction for as long as it passed. A
     * build against a hostname that does not resolve fails at the first
     * request, on a tester's phone, having already cost a build.
     *
     * Two environments exist — a laptop and the deployment — so that is what
     * this allows. Adding a third is a real change: a second database, bucket
     * and pair of Workers. When one exists, add it here and the profile that
     * uses it in the same commit.
     */
    const OPERATED = new Set(['http://localhost:3000', API_ORIGIN]);

    for (const profile of ['development', 'preview', 'production']) {
      expect(OPERATED, `${profile} points at a host nobody operates`).toContain(
        eas.build[profile].env.EXPO_PUBLIC_API_URL,
      );
    }

    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe(API_ORIGIN);
    expect(eas.build.development.env.EXPO_PUBLIC_API_URL).toMatch(/^http:\/\/localhost/);
    /*
     * And the apex is not one of them.
     *
     * It resolves, it serves the site, and it is the wrong value — which is
     * why it is worth a line of its own rather than trusting the set above to
     * keep catching it. A build that takes a redirect on every request costs
     * nothing to make and is only visible from a phone.
     */
    for (const profile of ['preview', 'production']) {
      expect(
        eas.build[profile].env.EXPO_PUBLIC_API_URL,
        `${profile} points at the apex, which redirects`,
      ).not.toBe(`https://${DOMAIN}`);
    }
  });

  it('can actually use the channels it declares', () => {
    /*
     * Every profile names a channel, and a channel is inert without
     * `expo-updates` — the CLI says so on every build and then builds anyway.
     * An inert channel is worse than none: `eas update --channel preview`
     * succeeds, publishes, and reaches nobody, because no installed binary is
     * listening. The failure is silent at both ends.
     */
    const declared = Object.entries(eas.build)
      .filter(([, profile]) => (profile as { channel?: string }).channel)
      .map(([name]) => name);
    expect(declared.length, 'no profile declares a channel').toBeGreaterThan(0);
    expect(
      pkg.dependencies['expo-updates'],
      `${declared.join(', ')} declare channels, so expo-updates has to be installed`,
    ).toBeTruthy();
  });

  it('points updates at this project and invalidates them on native change', () => {
    /*
     * The URL carries the project id, so a copied `app.json` that kept
     * somebody else's would publish into their channel.
     *
     * `fingerprint` rather than `appVersion`, which is what `eas update:configure`
     * writes. Under `appVersion` an update reaches every build sharing the
     * version string in `app.json` — including one compiled before a native
     * dependency was added, which then runs JavaScript calling a module that
     * is not in the binary and dies on launch. Recovering from that means a
     * new build and a reinstall, on a phone that now crashes at startup.
     *
     * A fingerprint is computed from the native project, so an update that
     * needs a different binary is simply never offered to the old one.
     */
    expect(app.updates.url).toBe(`https://u.expo.dev/${app.extra.eas.projectId}`);
    expect(app.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('ships a store bundle from production and something installable from preview', () => {
    expect(eas.build.production.distribution).toBe('store');
    expect(eas.build.production.android.buildType).toBe('app-bundle');
    expect(eas.build.preview.distribution).toBe('internal');
  });
});

describe('submit credentials', () => {
  it('are referenced, never written down', () => {
    // A Team ID committed here is not a secret, but an Apple ID is, and the
    // habit is the point: nothing in this file is a value.
    const raw = JSON.stringify(eas.submit);
    expect(raw).not.toMatch(/@|\.json"/);
    for (const value of Object.values(eas.submit.production.ios as Record<string, string>)) {
      expect(value).toMatch(/^\$\{secrets\.[A-Z_]+\}$/);
    }
  });

  it('submits Android to a closed track, not straight to production', () => {
    expect(eas.submit.production.android.track).toBe('internal');
  });
});

describe('the example phrase people are shown', () => {
  it('has as many words as a real one', async () => {
    /*
     * The join screen's placeholder read `amber-fox` — the two-word shape
     * phrases had before the pool was reseeded with three. Nobody types a
     * placeholder, so nothing broke; it just quietly taught the wrong thing to
     * the one person who most needed the right one, standing in a room being
     * told a code.
     *
     * Counted against a phrase the generator actually produces rather than
     * against the number three, so this follows the pool if it ever changes
     * again.
     */
    const { codeWordTriples, CODE_SEPARATOR } = await import('@parea/core');
    const real = [...codeWordTriples(1)][0]!;
    const words = real.split(CODE_SEPARATOR).length;

    const app = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../App.tsx', import.meta.url).pathname, 'utf8'),
    );
    const placeholder = app.match(/placeholder="([a-z-]+)"/)?.[1];
    expect(placeholder, 'no phrase placeholder found').toBeTruthy();
    expect(placeholder!.split(CODE_SEPARATOR).length, placeholder!).toBe(words);
  });
});
