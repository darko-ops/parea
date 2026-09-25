/**
 * The app still starts on a build that has never heard of passkeys.
 *
 * `react-native-passkeys` calls `requireNativeModule('ReactNativePasskeys')` at
 * the top level of its entry file, and that throws when the binary was built
 * without it. So a static `import` of it does not degrade — it fails during
 * module evaluation, before any guard in this codebase can run.
 *
 * And the blast radius is the whole product, not the feature: the import is
 * reached from `Events.tsx`, which is reached from `App.tsx`. A phone holding a
 * build made before the dependency existed — which, the day it shipped, was
 * every phone — gets an app that does not start.
 *
 * Nothing else catches this. The suite passes, the types check, the web build
 * is fine, and the only symptom is on a device nobody ran the tests on.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const SOURCES = [
  'src/passkeys.ts',
  'src/signin.ts',
  'src/Devices.tsx',
  'src/Events.tsx',
  'App.tsx',
];

describe('the native passkey module is never imported at the top level', () => {
  it('asks whether the native module exists before loading the package', () => {
    /*
     * The fix for the red box, and the one that actually matters.
     *
     * Metro does not give a module-factory error to its caller: Expo's
     * `guardedLoadModule` reports it to `ErrorUtils` — the red box — and returns
     * `undefined`. So a `try` around the require cannot suppress the box; the
     * only way not to get one is not to evaluate the package at all.
     * `requireOptionalNativeModule` answers null instead of throwing, so the
     * probe has to come first and has to be able to return before the require.
     */
    const passkeys = read('src/passkeys.ts');
    const probe = passkeys.indexOf('requireOptionalNativeModule');
    const load = passkeys.indexOf("require('react-native-passkeys')");
    expect(probe, 'the non-throwing probe is gone').toBeGreaterThan(-1);
    expect(probe, 'the package is loaded before anything checks for it').toBeLessThan(load);
  });

  it('does not treat a missing value as "not tried yet"', () => {
    // `guardedLoadModule` returns `undefined` on failure. Caching that under a
    // sentinel that also means "untried" is what made the box come back on
    // every render and every button press rather than once.
    const passkeys = read('src/passkeys.ts');
    expect(passkeys).toMatch(/let tried = false/);
    expect(passkeys).toMatch(/if \(tried\) return cached/);
  });

  it('is required lazily, inside a try, in exactly one place', () => {
    const passkeys = read('src/passkeys.ts');
    expect(passkeys).not.toMatch(/^import .*'react-native-passkeys'/m);
    // The specifier stays static so Metro still bundles it; only evaluating it
    // is deferred to a point where throwing is survivable.
    expect(passkeys).toMatch(/require\('react-native-passkeys'\)/);
    expect(passkeys).toMatch(/try \{[\s\S]*?require\('react-native-passkeys'\)[\s\S]*?\} catch/);
  });

  it('is reached from nowhere else, so one guard covers the app', () => {
    // A second importer is a second way to take the whole bundle down, and it
    // would not look like this file's problem when it did.
    for (const name of SOURCES.filter((n) => n !== 'src/passkeys.ts')) {
      expect(read(name), `${name} imports the native module directly`).not.toMatch(
        /'react-native-passkeys'/,
      );
    }
  });
});

describe('asking whether passkeys work', () => {
  it('answers false rather than throwing where there is no native module', async () => {
    /*
     * The behavioural half, and the reason this test file can exist at all:
     * importing the module under vitest is exactly the situation of a binary
     * without the native side, because there is no native side here either.
     *
     * If the top-level import ever comes back, this line throws at import and
     * the suite says so — which is the same failure the phone would have, found
     * somewhere it can be read.
     */
    const { passkeysSupported } = await import('../src/passkeys');
    expect(passkeysSupported()).toBe(false);
  });

  it('refuses a ceremony with a sentence rather than a crash', async () => {
    const { createPasskey, assertPasskey } = await import('../src/passkeys');
    for (const run of [createPasskey, assertPasskey]) {
      const outcome = await run({});
      expect(outcome.ok).toBe(false);
      // A person on an old build is told to update, not shown a stack trace and
      // not left with a button that silently does nothing.
      expect(outcome).toMatchObject({ reason: expect.stringMatching(/newer version/) });
    }
  });
});
