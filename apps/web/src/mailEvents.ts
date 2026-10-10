/**
 * Bounces and complaints, from Resend's webhook — see `mail_event` in the
 * schema for why, and `/api/webhooks/resend` for the route.
 *
 * Resend already stops sending to an address after a hard bounce or a spam
 * complaint, so the sender's reputation looks after itself. What did not
 * exist was anybody here hearing about it:
 *
 * - **An alert address that stops receiving.** Safety alerts (a child-safety
 *   match, a report) and ops alerts go by email. If that address bounces, or
 *   lands on the suppression list, every later alert is dropped by the
 *   provider while every sender here reports success. That is the one case
 *   worth waking someone for: Sentry at `fatal`, and an email to the *other*
 *   alert address, since this one is evidently not being read.
 * - **Everybody else.** A bounced sign-in code is somebody who typed their
 *   address wrong, or whose mailbox is gone; a suppressed one is somebody who
 *   will never get a code again until they are taken off the list. Each is a
 *   Sentry warning grouped by what happened and to which kind of mail, so a
 *   sudden run of them — a sending domain that broke — is one issue with a
 *   count rather than silence.
 */

import * as Sentry from '@sentry/nextjs';
import { mailerFromEnv, normaliseEmail, schema } from '@parea/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Db } from './db';

/** How old a delivery may be before it is refused as a replay. */
const TOLERANCE_SECONDS = 5 * 60;

/** The events this records. Anything else is acknowledged and dropped. */
export const RECORDED = new Set(['email.bounced', 'email.complained', 'email.suppressed', 'email.failed']);

/**
 * Whether a delivery came from Resend: its webhooks are signed the Svix way.
 * HMAC-SHA256, keyed with the base64 after `whsec_`, over
 * `<svix-id>.<svix-timestamp>.<raw body>`; the header lists one or more
 * `v1,<base64>` signatures, any of which may match (there are two while a
 * secret is being rotated).
 */
export function verifySignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret.startsWith('whsec_')) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Which mail it was, from the subject — never keeping the subject, which can hold a code. */
export function mailKind(subject: string | undefined): 'sign_in' | 'passkey' | 'alert' | 'other' {
  if (!subject) return 'other';
  if (/ is your Parea code$/.test(subject)) return 'sign_in';
  if (subject.startsWith('A passkey was added')) return 'passkey';
  if (/^Parea[ :]/.test(subject)) return 'alert';
  return 'other';
}

export function recipientHash(secret: string, email: string): string {
  return createHmac('sha256', secret).update(`mail-event|${email}`).digest('hex').slice(0, 32);
}

type Payload = {
  type?: string;
  data?: {
    to?: string[] | string;
    subject?: string;
    bounce?: { type?: string; subType?: string };
    failed?: { reason?: string };
  };
};

/** The alert addresses this deployment sends to, normalised, by name. */
function alertAddresses(env: NodeJS.ProcessEnv): { name: string; email: string }[] {
  return (['SAFETY_ALERT_EMAIL', 'OPS_ALERT_EMAIL'] as const)
    .map((name) => ({ name, email: normaliseEmail(env[name] ?? '') }))
    .filter((a): a is { name: 'SAFETY_ALERT_EMAIL' | 'OPS_ALERT_EMAIL'; email: string } => Boolean(a.email));
}

/**
 * Records one delivery and says what needs saying. Returns how many recipients
 * it recorded; 0 for an event this does not keep or a redelivery.
 */
export async function recordMailEvent(
  db: Db,
  deliveryId: string,
  payload: Payload,
  options: { secret: string; env?: NodeJS.ProcessEnv } ,
): Promise<number> {
  const env = options.env ?? process.env;
  const type = payload.type ?? '';
  if (!RECORDED.has(type)) return 0;

  const to = ([] as string[]).concat(payload.data?.to ?? []).map((a) => normaliseEmail(a)).filter(Boolean) as string[];
  const kind = mailKind(payload.data?.subject);
  const bounce = payload.data?.bounce;
  const detail =
    (bounce && [bounce.type, bounce.subType].filter(Boolean).join('/')) || payload.data?.failed?.reason?.slice(0, 120) || null;
  const alerts = alertAddresses(env);

  let recorded = 0;
  for (const [i, email] of to.entries()) {
    const alert = alerts.find((a) => a.email === email);
    const rows = await db
      .insert(schema.mailEvents)
      .values({
        // One row per recipient; a message to one address — all of ours — is the delivery id.
        id: i === 0 ? deliveryId : `${deliveryId}:${i}`,
        type,
        mailKind: kind,
        detail,
        recipientHash: recipientHash(options.secret, email),
        toAlertAddress: Boolean(alert),
      })
      .onConflictDoNothing()
      .returning({ id: schema.mailEvents.id });
    if (rows.length === 0) continue; // a redelivery: already said
    recorded += 1;

    const what = type.replace('email.', '');
    if (alert) {
      const headline = `Mail to ${alert.name} is not being delivered (${what}${detail ? `: ${detail}` : ''})`;
      Sentry.captureMessage(headline, {
        level: 'fatal',
        tags: { kind: 'mail_alert_address', mail_event: what },
        fingerprint: ['mail-alert-address', alert.name, what],
      });
      // The other alert address, if there is one: this one is evidently not
      // being read, so telling it again would be telling nobody.
      const other = alerts.find((a) => a.name !== alert.name && a.email !== email);
      if (other) {
        await mailerFromEnv(env)
          .send({
            to: other.email,
            subject: `Parea URGENT: ${headline}`,
            text: [
              headline + '.',
              '',
              `Resend reported ${type} for the address in ${alert.name}. While it lasts, alerts sent`,
              'there are dropped by the provider and every sender here still reports success.',
              '',
              'Check the mailbox, then remove the address from the suppression list in the',
              'Resend dashboard (Suppressions), or point the variable at one that works.',
              'docs/incident-response.md, "Where alerts arrive".',
            ].join('\n'),
          })
          .catch((err) => console.error('mail event: could not tell the other alert address', err));
      }
      console.error(`mail event: ${headline}`);
    } else {
      Sentry.captureMessage(`Mail ${what}: ${kind}`, {
        level: 'warning',
        tags: { kind: 'mail_event', mail_event: what, mail_kind: kind },
        fingerprint: ['mail-event', what, kind],
        extra: { detail },
      });
    }
  }
  await Sentry.flush(2000).catch(() => false);
  return recorded;
}
