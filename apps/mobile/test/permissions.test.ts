/**
 * The app asks for nothing it does not use.
 *
 * Expo config plugins bring their own permissions, and the defaults are
 * generous because the modules are general-purpose. `expo-camera` and
 * `expo-image-picker` both assume you might record video, so both add a
 * microphone; `expo-secure-store` assumes you might gate the keychain behind
 * biometrics, so it adds Face ID. This app does none of that — the camera is a
 * QR scanner, the picker takes stills, and the store is used without
 * `requireAuthentication`.
 *
 * Left alone, a photo-sharing app ships asking for the microphone. That is a
 * privacy question at review, a frightening prompt for whoever installs it,
 * and a line on the nutrition label describing a feature that does not exist.
 * It was found by introspecting the config rather than by reading it, because
 * nothing in `app.json` mentions a microphone — the request is entirely
 * inherited.
 *
 * ## How this checks it
 *
 * Derived, not listed. Each plugin package's own compiled plugin says which
 * permissions it can add and which props switch them off, so this reads that
 * and requires the app to have switched off everything it does not use. A
 * newly added plugin that brings a microphone is caught the day it is added,
 * with no list for anyone to remember to update.
 *
 * What it cannot see is a permission arriving from a *native* dependency that
 * has no config plugin. `npx expo config --type introspect` is the ground
 * truth, and the merged `AndroidManifest.xml` after a prebuild is the ground
 * truth for Android specifically.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import config from '../app.json';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULES = join(ROOT, '..', '..', 'node_modules');

/**
 * The capabilities this app does not have, each with the props Expo uses to
 * turn it off. Not a list of plugins — a list of things the product does not
 * do, which is a far more stable thing to write down.
 */
const UNUSED = [
  {
    what: 'record audio',
    // The camera is a QR scanner: `barcodeScannerSettings`, never `recordAsync`.
    permissions: /NSMicrophoneUsageDescription|RECORD_AUDIO/,
    props: ['microphonePermission', 'recordAudioAndroid'],
  },
  {
    what: 'authenticate with biometrics',
    // SecureStore is used for a token and a list, without `requireAuthentication`.
    permissions: /NSFaceIDUsageDescription/,
    props: ['faceIDPermission'],
  },
];

/** Every plugin as `[name, props]`, including the bare-string ones. */
function plugins(): [string, Record<string, unknown>][] {
  return config.expo.plugins.map((entry) =>
    typeof entry === 'string'
      ? [entry, {}]
      : [entry[0] as string, (entry[1] ?? {}) as Record<string, unknown>],
  );
}

/** A plugin package's compiled config plugin, or null if it has none. */
function pluginSource(name: string): string | null {
  const dir = join(MODULES, name, 'plugin', 'build');
  if (!existsSync(dir)) return null;
  // Concatenated because plugins split across withX.js / index.js differently.
  return ['index.js', `with${name.replace(/^expo-/, '').replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())}.js`]
    .filter((file) => existsSync(join(dir, file)))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
}

describe('permissions', () => {
  it.each(UNUSED)('do not let a plugin add the ability to $what', ({ permissions, props }) => {
    for (const [name, configured] of plugins()) {
      const source = pluginSource(name);
      if (!source || !permissions.test(source)) continue;

      const supported = props.filter((prop) => source.includes(prop));

      // If the plugin can add the permission but names none of the props we
      // know, Expo has renamed them and the rest of this test is checking
      // nothing. Fail loudly rather than pass quietly.
      expect(
        supported,
        `${name} can add this permission but supports none of ${props.join(', ')} — has the plugin API changed?`,
      ).not.toEqual([]);

      for (const prop of supported) {
        expect(configured[prop], `${name} still sets ${prop}`).toBe(false);
      }
    }
  });

  it('are switched off because the app really does not use them', () => {
    // The other half. Turning a permission off is only correct while the
    // feature is absent, and adding the feature back would otherwise leave a
    // module failing at runtime with a permission it was denied at build time.
    const source = ['App.tsx', 'src/platform.ts']
      .map((file) => readFileSync(join(ROOT, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/recordAsync|Audio\.Recording|expo-av/);
    expect(source).not.toMatch(/requireAuthentication/);
  });

  it('ask for the three things the app does do', () => {
    // Camera for the QR scanner, the library to pick from, and the library
    // again to save the set back. Each string says what it is for, because
    // "Allow Parea to access your photos" is a prompt people decline.
    const picker = plugins().find(([name]) => name === 'expo-image-picker')?.[1];
    const media = plugins().find(([name]) => name === 'expo-media-library')?.[1];
    const camera = plugins().find(([name]) => name === 'expo-camera')?.[1];

    for (const [what, text] of [
      ['picker', picker?.photosPermission],
      ['save', media?.savePhotosPermission],
      ['camera', camera?.cameraPermission],
    ] as [string, string | undefined][]) {
      expect(text, `${what} has no reason given`).toBeTruthy();
      expect(text, `${what} uses Expo's boilerplate`).not.toMatch(/\$\(PRODUCT_NAME\)/);
    }
  });
});
