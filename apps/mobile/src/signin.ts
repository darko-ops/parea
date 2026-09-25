/**
 * The two passkey flows, as the screens want them — design §3.
 *
 * Each is "ask the server for options, run the platform ceremony, post the
 * result back", and each is three awaits with two failure modes. They live here
 * rather than in the screens because both screens need the second one and two
 * copies of a ceremony is two places for the error handling to drift.
 *
 * `note: null` means the person cancelled, and callers say nothing about it: a
 * red line under a sheet somebody deliberately dismissed reads as a fault in
 * the thing they just declined.
 */

import type { Api, SignedIn } from './api';
import { assertPasskey, CANCELLED, createPasskey } from './passkeys';

export type Flow<T> = { ok: true; value: T } | { ok: false; note: string | null };

/** A cancellation carries no note; anything else carries one worth showing. */
function quiet(reason: string | typeof CANCELLED): { ok: false; note: string | null } {
  return { ok: false, note: reason === CANCELLED ? null : reason };
}

/**
 * Makes a passkey on this device and registers it.
 *
 * Needs an account already, which both callers have: the offer runs straight
 * after a sign-in, and the Devices card is only reachable from the signed-in
 * half of the profile tab.
 */
export async function addPasskey(api: Api): Promise<Flow<void>> {
  let options;
  try {
    options = await api.passkeyRegistrationOptions();
  } catch {
    return { ok: false, note: 'Could not start. Try again in a moment.' };
  }

  const made = await createPasskey(options);
  if (!made.ok) return quiet(made.reason);

  try {
    await api.savePasskey(made.value);
  } catch {
    // The ceremony worked and the server would not keep it — most likely this
    // authenticator is already enrolled, which is the one case worth naming.
    return { ok: false, note: 'That passkey was not accepted. You may already have one here.' };
  }
  return { ok: true, value: undefined };
}

/**
 * Signs in with a passkey already on this device.
 *
 * The token that comes back may not be the one this device had — signing in
 * folds this actor into the account's — so the caller has to write it to the
 * keychain exactly as the code path does.
 */
export async function signInWithPasskey(api: Api): Promise<Flow<SignedIn>> {
  let options;
  try {
    options = await api.passkeyChallenge();
  } catch {
    return { ok: false, note: 'Could not start. Try again, or use a code.' };
  }

  const asserted = await assertPasskey(options);
  if (!asserted.ok) return quiet(asserted.reason);

  try {
    return { ok: true, value: await api.signInWithPasskey(asserted.value) };
  } catch {
    /*
     * One sentence, because the server gives one answer.
     *
     * Whether the key was unknown here or the signature was wrong are different
     * facts, and the first is about a person: it would say whether that
     * authenticator is registered with Parea, which is the question about who
     * was at which party that the code endpoint refuses to answer.
     */
    return {
      ok: false,
      note: 'That passkey did not work here. Sign in with a code instead.',
    };
  }
}
