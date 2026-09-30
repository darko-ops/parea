/**
 * Adding a passkey needs a recent sign-in, and the owner is told.
 *
 * Both routes that take part in enrolment ask — the options, and the keeping —
 * because a challenge lives for minutes and the rule is about the moment the
 * key is stored.
 */

import { passkeyAddedEmail } from '@parea/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

describe('enrolling a passkey', () => {
  it.each([
    'app/api/account/passkeys/options/route.ts',
    'app/api/account/passkeys/route.ts',
  ])('%s refuses a stale sign-in', (file) => {
    const source = read(file);
    expect(source).toContain('signedInRecently(');
    expect(source).toContain("'recent_sign_in_required'");
  });

  it('emails the owner once the key is kept', () => {
    const source = read('app/api/account/passkeys/route.ts');
    const kept = source.indexOf('if (!outcome.ok)');
    const told = source.indexOf('await tellTheOwner(');
    expect(told).toBeGreaterThan(kept);
  });
});

describe('the email', () => {
  it('names the device and says what to do if it was not them', () => {
    const mail = passkeyAddedEmail('Safari on iPhone');
    expect(mail.subject).toMatch(/passkey was added/i);
    expect(mail.text).toContain('Safari on iPhone');
    expect(mail.text).toMatch(/remove the\s+passkey/);
  });

  it('reads without a label', () => {
    expect(passkeyAddedEmail(null).text).toMatch(/^A passkey can now sign in/);
  });
});
