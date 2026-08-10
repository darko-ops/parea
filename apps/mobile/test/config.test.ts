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
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));

const app = read('app.json').expo;
const eas = read('eas.json');

const DOMAIN = 'parea.photos';
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

  it('point the iOS entitlement at the domain the links use', () => {
    expect(app.ios.associatedDomains).toContain(`applinks:${DOMAIN}`);
  });

  it('point the Android intent filter at the same domain and path', () => {
    const [filter] = app.android.intentFilters;
    expect(filter.autoVerify, 'without this Android never verifies the link').toBe(true);
    expect(filter.data[0]).toMatchObject({ scheme: 'https', host: DOMAIN });
    // `/e/<token>` is the link people are actually sent — see design §9.
    expect(filter.data[0].pathPrefix).toBe('/e');
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

  it('points each profile at a different API', () => {
    const urls = ['development', 'preview', 'production'].map(
      (p) => eas.build[p].env.EXPO_PUBLIC_API_URL,
    );
    expect(new Set(urls).size, 'a profile pointing at the wrong API is silent').toBe(3);
    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe(`https://${DOMAIN}`);
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
