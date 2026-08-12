/**
 * Send one real sign-in email, to prove the mailer works.
 *
 *   npm run mail:test -- you@example.com
 *
 * There is no substitute for this. The unit tests assert the shape of the
 * request each provider is sent, which catches the mistake that was actually
 * in the code — but they cannot know whether the key is valid, whether the
 * sending domain has finished verifying, whether SPF and DKIM pass, or whether
 * the message lands in a spam folder. Those are the failures that matter and
 * every one of them is invisible from here.
 *
 * It matters more for this endpoint than for most, because the product hides
 * send failures on purpose: `POST /api/account/code` answers 204 however it
 * went, so that it cannot be used to ask whether an address has an account.
 * The cost of that decision is that a broken mailer is silent, and this script
 * is the thing that breaks the silence.
 *
 * It goes through `mailerFromEnv` rather than posting to a provider directly,
 * so what is proved is the path the product actually takes — including a
 * MAIL_PROVIDER typo and a MAIL_FROM the provider will not accept.
 */

import { readFileSync } from 'node:fs';

import { MailUnavailable, mailerFromEnv, signInEmail } from '@parea/core';

/** `.env.local` is where the setup script puts these; not a dependency. */
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    // Anything already in the environment wins, so a one-off override on the
    // command line does what it looks like it does.
    if (process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to?.includes('@')) {
    console.error('usage: npm run mail:test -- you@example.com');
    process.exit(2);
  }

  loadEnvFile('apps/web/.env.local');

  // Without this the development fallback prints to the console and reports
  // success, which is the one answer that would make this script pointless.
  process.env.NODE_ENV = 'production';

  const mailer = mailerFromEnv();
  console.log(`provider: ${mailer.name}`);
  console.log(`from:     ${process.env.MAIL_FROM ?? '(unset)'}`);
  console.log(`to:       ${to}`);

  // The real body, so this exercises the template production sends — but
  // never the real subject. Both messages arrive from the same address with
  // the same shape, and an inbox holding one of each is exactly how `123456`
  // got typed into a sign-in form the first time this was used for real.
  const code = '123456';
  const real = signInEmail(code);
  const message = {
    subject: 'Parea test message — NOT a sign-in code',
    text: [
      'This is a test from scripts/send-test-email.ts.',
      '',
      'It proves the mailer is configured and that this address can be',
      `reached. The ${code} below is fixed, is not a real code, and will not`,
      'sign anyone in. A real one arrives with the digits in the subject.',
      '',
      '--- what a real sign-in message says ---',
      '',
      real.text,
    ].join('\n'),
  };

  try {
    await mailer.send({ to, ...message });
  } catch (err) {
    console.error(`\nfailed: ${err instanceof Error ? err.message : String(err)}`);
    // Only when a provider actually answered. Printing deliverability advice
    // over a MAIL_PROVIDER typo sends someone to check their DNS.
    if (err instanceof MailUnavailable && err.status) {
      console.error(
        '\nA 401 or 403 is usually the key or a sending domain that has not\n' +
          'finished verifying. A 422 is usually MAIL_FROM: most providers\n' +
          'require the exact address or domain you verified with them.',
      );
    }
    process.exit(1);
  }

  console.log(
    `\nAccepted by ${mailer.name}. That is not delivery — check the inbox, and\n` +
      'check spam, because the first message from a new domain often lands there.\n' +
      `Look for "${message.subject}". It carries no real code, and a real\n` +
      'sign-in message is the one with six digits in its subject line.',
  );
}

void main();
