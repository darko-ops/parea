/**
 * Send one real text, to prove the texter works.
 *
 *   npm run sms:test -- +447700900123
 *
 * The twin of `send-test-email.ts`, and its opening argument applies here
 * unchanged: the unit tests assert the shape of the request each carrier is
 * sent, which catches the mistake that was actually in the code, and they
 * cannot know whether the credential is valid, whether the number is one this
 * account may send from, or whether a carrier will deliver the message. Those
 * are the failures that matter and every one is invisible from here.
 *
 * It matters more for texts than for mail, for two reasons on top of that one.
 *
 * `POST /api/account/phone` hides send failures on purpose — a distinguishable
 * failure would answer "has somebody been asked about this number?" for anybody
 * with a keypad — so a broken texter is silent in production, exactly as a
 * broken mailer is.
 *
 * And the failure that actually bites is quieter still. A2P 10DLC registration
 * is a days-long process with the carriers rather than with Twilio, and an
 * unregistered sender to a US number is **filtered rather than rejected**: the
 * API answers 201, the message is accepted, and it is never delivered. Nothing
 * in this repository can detect that. What this script can do is get you to the
 * point where the only remaining explanation is registration, which is worth a
 * great deal when the alternative is suspecting the code.
 *
 * It goes through `texterFromEnv` rather than posting to a carrier directly, so
 * what is proved is the path the product takes — including an SMS_PROVIDER typo
 * and the missing SMS_API_URL that Twilio needs.
 */

import { readFileSync } from 'node:fs';

import { TextUnavailable, texterFromEnv } from '@parea/core';

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

/**
 * The same rule `normalisePhone` applies, restated rather than imported.
 *
 * That function lives in `apps/web/src`, which this script has no business
 * reaching into — and the check here is for the argument rather than for the
 * product: it exists so that a number typed without its country code fails
 * before a carrier is paid to reject it.
 */
function e164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('+')) return null;
  const digits = trimmed.slice(1).replace(/[\s()\-.]/g, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

async function main(): Promise<void> {
  const to = e164(process.argv[2] ?? '');
  if (!to) {
    console.error('usage: npm run sms:test -- +447700900123');
    console.error('\nThe country code is not optional. A hash only matches another');
    console.error('hash of the identical string, so the product asks for the full');
    console.error('international form rather than guessing a country.');
    process.exit(2);
  }

  loadEnvFile('apps/web/.env.local');

  // Without this the development fallback prints to the console and reports
  // success, which is the one answer that would make this script pointless.
  process.env.NODE_ENV = 'production';

  const texter = texterFromEnv();
  console.log(`carrier: ${texter.name}`);
  console.log(`from:    ${process.env.SMS_FROM ?? '(unset)'}`);
  console.log(`to:      ${to}`);

  /*
   * Not `verifyText`, which is what production sends.
   *
   * That message opens with six digits and the product's name, which is
   * precisely what somebody glances at on a lock screen and types into a form.
   * An inbox holding one real code and one test code that look identical is how
   * a fixed number gets typed into a verification field — the mail script's own
   * note, and the consequence here is worse, because a text has no subject line
   * to tell them apart by.
   *
   * So this says what it is, first, and carries no six-digit run at all.
   */
  const body =
    'Parea test message — this is NOT a verification code and will confirm nothing. ' +
    'Sent by scripts/send-test-sms.ts to prove this deployment can text you.';

  try {
    await texter.send({ to, body });
  } catch (err) {
    console.error(`\nfailed: ${err instanceof Error ? err.message : String(err)}`);
    /*
     * Advice only when a carrier actually answered.
     *
     * Printing deliverability notes over an SMS_PROVIDER typo sends somebody to
     * read their campaign registration, which is the most expensive wrong place
     * to look in this whole setup.
     */
    if (err instanceof TextUnavailable && err.status) {
      console.error(
        '\n401 is the credential: SMS_API_KEY is one value, and for Twilio it is\n' +
          '<accountSid>:<authToken> with the colon. 404 is usually SMS_API_URL —\n' +
          'the account SID in its path has to be the same one.\n' +
          '\n' +
          '21608 on a trial account means this number is not a verified caller ID;\n' +
          'a trial may only text numbers you have verified in the console. 21606 or\n' +
          '21212 is SMS_FROM: not a number this account owns, or not SMS-capable.',
      );
    }
    process.exit(1);
  }

  console.log(
    '\nAccepted by ' + texter.name + '. That is not delivery, and the gap between\n' +
      'the two is the whole reason this script exists: an unregistered A2P sender to\n' +
      'a US number is filtered rather than refused, so the API answers 201 and the\n' +
      'text never arrives.\n' +
      '\n' +
      'If nothing turns up within a minute, check the campaign status in the console\n' +
      'before suspecting anything in this repository. The message says plainly that\n' +
      'it is a test and carries no code, so it cannot be mistaken for a real one.',
  );
}

void main();
