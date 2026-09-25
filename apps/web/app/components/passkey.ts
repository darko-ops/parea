'use client';

/**
 * The browser half of a passkey — design §3.
 *
 * Two ceremonies and one shape for both: ask the server for options, hand them
 * to the platform, post back what it gives you. Everything interesting is on
 * the server; this exists so that three screens are not three copies of the
 * same four lines with the error handling done differently in each.
 *
 * ## The errors are the product here
 *
 * A failed ceremony is usually somebody pressing Escape, and a red sentence
 * about a `NotAllowedError` is worse than nothing at all — it reads as a fault
 * in the thing they just decided against. So a cancellation returns `null` and
 * the caller says nothing, and the sentences that do get written are the ones
 * where there is something a person could do differently.
 */

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/**
 * Whether this browser can do any of it.
 *
 * The button is not drawn when this is false. A prompt for Face ID on a
 * browser with no authenticator is a button that can only disappoint, and the
 * code path beside it works everywhere.
 */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    // A secure context is a hard requirement of the API, and `localhost`
    // counts as one — so this is true in development without a certificate.
    window.isSecureContext
  );
}

/**
 * Whether the thing behind Face ID and Touch ID is actually present.
 *
 * Distinct from the question above: a desktop Chrome with no platform
 * authenticator can still do passkeys with a phone over Bluetooth, which is a
 * real and good path but is not what "next time, use Face ID" promises. The
 * offer after signing in uses this to choose its words; the sign-in button uses
 * only the coarser check, because a key on a phone is a perfectly good way in.
 */
export async function platformAuthenticator(): Promise<boolean> {
  if (!passkeysAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Cancelled by the person, rather than broken. Callers stay quiet about it. */
export const CANCELLED = Symbol('cancelled');

type Result<T> = { ok: true; value: T } | { ok: false; message: string | typeof CANCELLED };

function readFailure(err: unknown): string | typeof CANCELLED {
  const name = (err as { name?: string })?.name;

  // `NotAllowedError` is both "you pressed Escape" and "you waited too long",
  // and the platform deliberately does not distinguish them — telling a site
  // which of the two happened would tell it things about the person's device.
  if (name === 'NotAllowedError' || name === 'AbortError') return CANCELLED;

  // The authenticator already holds a key for this account. Only reachable
  // through `excludeCredentials`, which is exactly what it is there for.
  if (name === 'InvalidStateError') {
    return 'This device already has a passkey for your account.';
  }
  if (name === 'SecurityError') {
    return 'This page cannot make a passkey. Check the address is parea.photos.';
  }
  return 'That did not work. You can still sign in with a code.';
}

/**
 * Makes a passkey and registers it.
 *
 * Two requests around one platform prompt: the options carry a challenge the
 * server has written down, and the response is only worth anything against it.
 */
export async function addPasskey(): Promise<Result<{ id: string; label: string | null }>> {
  try {
    /*
     * Ask this browser whether it has a biometric before asking the server for
     * options, because the answer changes which options to ask for.
     *
     * With one, the request pins the ceremony to the local device and the person
     * gets the Face ID sheet they were promised. Without one, it stays unpinned
     * and the browser offers the QR code and a security key — which is the right
     * menu on a desktop with no reader, and the only one that can succeed there.
     */
    const local = await platformAuthenticator();

    const optionsResponse = await fetch('/api/account/passkeys/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: local }),
    });
    if (!optionsResponse.ok) {
      return {
        ok: false,
        message:
          optionsResponse.status === 429
            ? 'Too many tries from here. Wait an hour.'
            : 'Could not start. Try again in a moment.',
      };
    }

    const attestation = await startRegistration({
      optionsJSON: await optionsResponse.json(),
    });

    const saved = await fetch('/api/account/passkeys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: attestation }),
    });

    if (saved.status === 409) {
      return { ok: false, message: 'This device already has a passkey for your account.' };
    }
    if (!saved.ok) return { ok: false, message: 'That passkey was not accepted.' };

    const { passkey } = (await saved.json()) as { passkey: { id: string; label: string | null } };
    return { ok: true, value: passkey };
  } catch (err) {
    return { ok: false, message: readFailure(err) };
  }
}

/**
 * Signs in with one.
 *
 * `useBrowserAutofill` is deliberately off. Conditional UI puts passkeys in the
 * dropdown of a username field, which is lovely on a site that has a username
 * field — this sign-in screen asks for an email only on the code path, and
 * attaching the passkey to that input would make the two proofs look like one
 * flow with a shortcut in it. A button that says what it does is clearer.
 */
export async function signInWithPasskey(): Promise<Result<{ merged: boolean }>> {
  try {
    const challenge = await fetch('/api/account/passkeys/challenge', { method: 'POST' });
    if (!challenge.ok) {
      return {
        ok: false,
        message:
          challenge.status === 429
            ? 'Too many tries from here. Wait an hour, or sign in with a code.'
            : 'Could not start. Try again in a moment.',
      };
    }

    const assertion = await startAuthentication({ optionsJSON: await challenge.json() });

    const session = await fetch('/api/account/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passkey: assertion }),
    });

    if (!session.ok) {
      // One sentence, because the server gives one answer: saying whether the
      // key was unknown or the signature was wrong would say whether that
      // authenticator is registered here.
      return {
        ok: false,
        message: 'That passkey did not work here. Sign in with a code instead.',
      };
    }

    const { merged } = (await session.json()) as { merged: boolean };
    return { ok: true, value: { merged } };
  } catch (err) {
    return { ok: false, message: readFailure(err) };
  }
}
