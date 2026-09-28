/**
 * Light or dark, chosen in Settings — dark unless somebody picks light.
 *
 * Screens read it with `useAppearance()`, not `useColorScheme()`. The
 * system's scheme is what `useColorScheme` answers, and overriding that with
 * `Appearance.setColorScheme` alone did not hold: applied at startup, the
 * native side later reported the system's scheme again and the app went back
 * to light. So the choice lives here, in JavaScript, and every screen that
 * picks colours asks this.
 *
 * The native override is still applied — once the app is on screen, where it
 * takes — because it is what reaches the parts of the phone this app does not
 * draw: the keyboard, alerts, the status bar.
 *
 * Dark from the first frame: `current` starts as the default, and the stored
 * choice replaces it when the keychain answers. Somebody who chose light sees
 * one dark frame, the cheaper mistake in an app whose default is dark.
 */

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

export type Look = 'dark' | 'light';

export const DEFAULT_LOOK: Look = 'dark';

const KEY = 'parea.appearance';

let current: Look = DEFAULT_LOOK;
const listeners = new Set<() => void>();

function apply(look: Look) {
  current = look;
  Appearance.setColorScheme(look);
  for (const listener of listeners) listener();
}

/** Reads the stored choice, once, when the app is on screen. */
export async function loadAppearance(): Promise<void> {
  const stored = await SecureStore.getItemAsync(KEY).catch(() => null);
  apply(stored === 'light' || stored === 'dark' ? stored : DEFAULT_LOOK);
}

/** Changes it now and remembers it. */
export async function setAppearance(look: Look): Promise<void> {
  apply(look);
  await SecureStore.setItemAsync(KEY, look).catch(() => {});
}

/** The chosen look. What every screen that picks colours should ask. */
export function useAppearance(): Look {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
