/**
 * The native half of a passkey — design §3.
 *
 * The same two ceremonies the browser does, through the platform's own APIs:
 * `ASAuthorizationPlatformPublicKeyCredentialProvider` on iOS and Credential
 * Manager on Android. `react-native-passkeys` is the bridge, and it takes and
 * returns exactly the JSON the server already produces and consumes — so the
 * options go across untouched and the response comes back untouched.
 *
 * ## What this depends on outside the code
 *
 * A passkey is bound to a domain, and the platform will not let an app claim
 * one without the domain agreeing:
 *
 *   - iOS needs `webcredentials:parea.photos` in `associatedDomains`, and the
 *     `.well-known/apple-app-site-association` file has to name this app under
 *     `webcredentials`. Both are in place; see `app.json` and the AASA route.
 *   - Android needs the app's signing fingerprint in `assetlinks.json`, which
 *     the deep-link setup already publishes. The same fingerprint is what the
 *     server turns into the `android:apk-key-hash:` origin it expects.
 *
 * So the configuration is shared with Universal Links rather than new, which is
 * the reason this was worth doing on both clients at once: the hard part was
 * already done and verified.
 *
 * ## It needs a real build
 *
 * There is native code behind this, so it does not exist in Expo Go. `isSupported`
 * answers false there rather than throwing, and every caller treats false as
 * "do not offer this" — so a development build without the module shows the
 * code path and nothing else, which is the correct degradation.
 */

type NativePasskeys = {
  isSupported(): boolean;
  create(request: unknown): Promise<unknown>;
  get(request: unknown): Promise<unknown>;
};

/**
 * The native module, or null where there is no native module.
 *
 * ## Two failures deep, and the second one is why this looks like it does
 *
 * `react-native-passkeys` calls `requireNativeModule('ReactNativePasskeys')` at
 * the top level of its entry file, and that throws when the binary was built
 * without it. A static `import` therefore takes the whole bundle down before
 * any guard here can run — the import is reached from `Events.tsx`, which is
 * reached from `App.tsx`, so the app does not start at all.
 *
 * Moving it to `require()` inside a `try` fixed the crash and produced a
 * quieter, stranger bug: a red "Cannot find native module" box on every render
 * of the settings card, dismissible, with the app working fine underneath.
 *
 * The cause is that Metro does not hand a module-factory error to its caller.
 * Expo's `guardedLoadModule` catches it, reports it to `ErrorUtils` — which is
 * the red box — and returns `undefined`. So the `catch` here never ran, the
 * assignment stored `undefined`, and `undefined` was also the sentinel meaning
 * "not tried yet". Every call tried again and reported again, which is why it
 * fired on opening the screen and then on every button pressed in it.
 *
 * Both halves are fixed below, and the first is the real one:
 *
 *   - **Ask before loading.** `requireOptionalNativeModule` answers `null`
 *     rather than throwing, so on a build without the module the package's own
 *     entry file is never evaluated, nothing is reported, and there is no box
 *     to dismiss.
 *   - **Never infer "untried" from the value.** A separate flag, so a result of
 *     `undefined` from anywhere cannot restart the whole cycle.
 *
 * `expo-modules-core` is itself required lazily, for a smaller reason: it
 * imports `react-native`, and this file is exercised by a test runner that has
 * no React Native. Failing there means the same thing as failing on a phone —
 * no passkeys — which is exactly what the test asserts.
 */
let cached: NativePasskeys | null = null;
let tried = false;

/** The name the module registers under; see the error it used to throw. */
const NATIVE_NAME = 'ReactNativePasskeys';

function native(): NativePasskeys | null {
  if (tried) return cached;
  tried = true;

  try {
    const core = require('expo-modules-core') as {
      requireOptionalNativeModule: (name: string) => unknown;
    };
    // The probe. Null here means this build has no passkey support, and
    // returning now is what keeps the package's throwing entry file unevaluated.
    if (!core.requireOptionalNativeModule(NATIVE_NAME)) return cached;

    cached = require('react-native-passkeys') as NativePasskeys;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Whether to offer any of this.
 *
 * False in Expo Go, in a build that predates the module, on an OS too old to
 * have the APIs, and on a device with no biometrics or screen lock set. All
 * four want the same answer from the product: show the code, say nothing about
 * passkeys.
 */
export function passkeysSupported(): boolean {
  try {
    return native()?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** Cancelled by the person rather than broken. Callers stay quiet about it. */
export const CANCELLED = Symbol('cancelled');

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string | typeof CANCELLED };

/**
 * A dismissed sheet is not an error.
 *
 * Both platforms report a cancellation as a thrown error, and both use the same
 * name for "they pressed cancel" and "it timed out" — deliberately, because
 * distinguishing them would tell an app something about the person's device. A
 * null return means the same thing on Android, so both shapes land here.
 */
function readFailure(err: unknown): string | typeof CANCELLED {
  const name = (err as { name?: string })?.name;
  const message = String((err as { message?: string })?.message ?? '');

  if (name === 'NotAllowedError' || name === 'UserCancelled' || /cancel/i.test(message)) {
    return CANCELLED;
  }
  if (name === 'InvalidStateError') {
    return 'This phone already has a passkey for your account.';
  }
  return 'That did not work. You can still sign in with a code.';
}

/**
 * Makes a passkey for the options the server issued.
 *
 * Returns the raw response for the caller to post back. Nothing is inspected
 * here: the assertion is checked on the server and a client that formed an
 * opinion about it would be an opinion with no authority.
 */
export async function createPasskey(options: unknown): Promise<Outcome<unknown>> {
  try {
    const module = native();
    if (!module) return { ok: false, reason: 'Passkeys need a newer version of this app.' };
    const response = await module.create(options as never);
    // Android's bridge answers null for a dismissed sheet rather than throwing.
    if (!response) return { ok: false, reason: CANCELLED };
    return { ok: true, value: response };
  } catch (err) {
    return { ok: false, reason: readFailure(err) };
  }
}

/** Signs in with one, if the person has one on this device. */
export async function assertPasskey(options: unknown): Promise<Outcome<unknown>> {
  try {
    const module = native();
    if (!module) return { ok: false, reason: 'Passkeys need a newer version of this app.' };
    const response = await module.get(options as never);
    if (!response) return { ok: false, reason: CANCELLED };
    return { ok: true, value: response };
  } catch (err) {
    return { ok: false, reason: readFailure(err) };
  }
}
