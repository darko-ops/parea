/**
 * Passkeys are retired: an email code is the only way in.
 *
 * The four ways a passkey could still be used — asking for a sign-in
 * challenge, signing in with one, and the two steps of adding one — each
 * refuse with `passkeys_retired`, and neither client offers them any more.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PASSKEYS_RETIRED } from '../src/passkeys';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('passkeys, retired', () => {
  it('is switched on', () => {
    expect(PASSKEYS_RETIRED).toBe(true);
  });

  it.each([
    '../app/api/account/passkeys/challenge/route.ts',
    '../app/api/account/passkeys/options/route.ts',
    '../app/api/account/passkeys/route.ts',
  ])('refuses at %s', (path) => {
    expect(read(path)).toMatch(/if \(PASSKEYS_RETIRED\) return retiredResponse\(\);/);
  });

  it('refuses a passkey sign-in', () => {
    expect(read('../app/api/account/session/route.ts')).toMatch(
      /if \(body\.passkey && PASSKEYS_RETIRED\) return retiredResponse\(\);/,
    );
  });

  it('is offered by neither client', () => {
    expect(read('../app/components/SignIn.tsx')).not.toMatch(/signInWithPasskey/);
    expect(read('../app/components/Devices.tsx')).not.toMatch(/addPasskey/);
    expect(read('../../mobile/src/Events.tsx')).not.toMatch(/Sign in with Face ID|signInWithPasskey/);
    expect(read('../../mobile/src/Devices.tsx')).not.toMatch(/addPasskey/);
  });
});
