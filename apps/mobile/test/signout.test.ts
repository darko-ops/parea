/**
 * What signing out has to hand back.
 *
 * The token in the keychain is the obvious half and the harmless one to get
 * right. The other half is `parea.events`, the list of events this phone has
 * opened — and each entry carries the event's `linkToken`, which is not a
 * reference to a credential but the credential itself: the join endpoint
 * exchanges one for access, from any device, with no account involved.
 *
 * So a sign-out that clears identity and leaves that list behind looks
 * completely finished — the name goes, the tabs empty, the account card offers
 * to sign in again — and leaves the next person holding this phone one tap
 * from every event the last person had opened. That is the exact situation the
 * button is pressed for, and it is invisible in a screenshot of the result.
 *
 * Asserted against the source rather than by running it: `platform.ts` imports
 * `expo-secure-store` at module scope and needs a device. That boundary is
 * documented in `api.test.ts` and is why the pure parts of this client live
 * where they can be tested. What is left to check here is which stores the
 * function names, which is the part that was wrong in the first draft.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const platform = readFileSync(
  fileURLToPath(new URL('../src/platform.ts', import.meta.url)),
  'utf8',
);

/** The body of `signOutDevice`, so a deletion elsewhere cannot satisfy this. */
const signOut = platform.slice(
  platform.indexOf('export async function signOutDevice'),
  platform.indexOf('// --- events you have joined'),
);

describe('signing out gives the device back', () => {
  it('exists at all, and is one function rather than a habit of callers', () => {
    // Three stores in three places at each call site is three chances to
    // forget one, and the one that gets forgotten is never the keychain.
    expect(signOut).toContain('export async function signOutDevice');
  });

  it('takes the identity', () => {
    expect(signOut).toMatch(/deleteItemAsync\(ACTOR_KEY\)/);
  });

  it('takes the events, because a saved link token is the credential', () => {
    expect(signOut).toMatch(/deleteItemAsync\(EVENTS_KEY\)/);
  });

  it('empties the upload queue rather than leaving it for whoever is next', () => {
    // Photos queued by somebody who has left would otherwise be sent under
    // the next identity on this phone.
    expect(signOut).toMatch(/saveQueue\(\{\s*items:\s*\[\]\s*\}\)/);
  });

  it('says out loud what it costs before it does it', () => {
    // The events come back when the same address signs in; the queued photos
    // do not. That asymmetry belongs in the question, not under the button.
    const events = readFileSync(
      fileURLToPath(new URL('../src/Events.tsx', import.meta.url)),
      'utf8',
    );
    const prompt = events.slice(
      events.indexOf('const signOut = useCallback'),
      events.indexOf('const remove = useCallback'),
    );
    expect(prompt).toMatch(/loadQueue\(/);
    expect(prompt).toMatch(/waiting to upload will be dropped/);
    // And the client's own copy of the token, which the keychain knows nothing
    // about — the next request would carry it happily.
    expect(prompt).toMatch(/api\.setToken\(null\)/);
  });
});
