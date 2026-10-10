/**
 * Bounces and complaints from Resend: signed or refused, recorded without the
 * address, and loud when the address is the one alerts go to.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const captured: { message: string; level?: string }[] = [];
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string, ctx?: { level?: string }) => captured.push({ message, level: ctx?.level }),
  flush: async () => true,
}));

const { __setDbForTests } = await import('@/db');
const { POST } = await import('../app/api/webhooks/resend/route');
const { mailKind, recipientHash, verifySignature } = await import('@/mailEvents');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const KEY = Buffer.from('a-test-signing-key-of-some-length');
const SECRET = `whsec_${KEY.toString('base64')}`;
let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate "mail_event"`);
  captured.length = 0;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  process.env.SESSION_SECRET = 'session-secret';
  process.env.SAFETY_ALERT_EMAIL = 'Safety@Parea.example';
  process.env.OPS_ALERT_EMAIL = 'ops@parea.example';
});

const sign = (id: string, timestamp: number, body: string, key = KEY) =>
  `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;

let n = 0;
function deliver(payload: unknown, options: { id?: string; signature?: string; at?: number } = {}) {
  const body = JSON.stringify(payload);
  const id = options.id ?? `msg_${++n}`;
  const at = options.at ?? Math.floor(Date.now() / 1000);
  return POST(
    new Request('https://parea.test/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: {
        'svix-id': id,
        'svix-timestamp': String(at),
        'svix-signature': options.signature ?? sign(id, at, body),
      },
    }),
  );
}

const bounced = (to: string, subject: string) => ({
  type: 'email.bounced',
  data: { to: [to], subject, bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' } },
});

describe('the signature', () => {
  const now = 1_790_000_000_000;
  const at = now / 1000;

  it('accepts Resend’s, including the second of two while a secret rotates', () => {
    const body = '{"type":"email.bounced"}';
    const headers = { id: 'msg_1', timestamp: String(at), signature: sign('msg_1', at, body) };
    expect(verifySignature(SECRET, headers, body, now)).toBe(true);
    const old = sign('msg_1', at, body, Buffer.from('the-old-key'));
    expect(verifySignature(SECRET, { ...headers, signature: `${old} ${headers.signature}` }, body, now)).toBe(true);
  });

  it('refuses a changed body, a wrong key, a stale delivery and a missing header', () => {
    const body = '{"type":"email.bounced"}';
    const headers = { id: 'msg_1', timestamp: String(at), signature: sign('msg_1', at, body) };
    expect(verifySignature(SECRET, headers, body + ' ', now)).toBe(false);
    expect(verifySignature(`whsec_${Buffer.from('other').toString('base64')}`, headers, body, now)).toBe(false);
    expect(verifySignature(SECRET, headers, body, now + 6 * 60_000)).toBe(false);
    expect(verifySignature(SECRET, { ...headers, signature: null }, body, now)).toBe(false);
  });
});

describe('which mail it was', () => {
  it('reads the kind from the subject, without keeping it', () => {
    expect(mailKind('483920 is your Parea code')).toBe('sign_in');
    expect(mailKind('A passkey was added to your Parea account')).toBe('passkey');
    expect(mailKind('Parea URGENT: 2 photos failed to process')).toBe('alert');
    expect(mailKind('Parea safety: quarantine 123')).toBe('alert');
    expect(mailKind(undefined)).toBe('other');
  });
});

describe('the webhook', () => {
  it('refuses an unsigned delivery, and says so when it has no secret', async () => {
    expect((await deliver(bounced('a@b.example', 'x'), { signature: 'v1,bm9wZQ==' })).status).toBe(404);
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await deliver(bounced('a@b.example', 'x'))).status).toBe(503);
    expect(await db.select().from(schema.mailEvents)).toHaveLength(0);
  });

  it('records a bounced sign-in code without the address or the code', async () => {
    const res = await deliver(bounced('Someone@Example.com', '483920 is your Parea code'), { id: 'msg_a' });
    expect(await res.json()).toEqual({ ok: true, recorded: 1 });
    const [row] = await db.select().from(schema.mailEvents);
    expect(row).toMatchObject({
      id: 'msg_a',
      type: 'email.bounced',
      mailKind: 'sign_in',
      detail: 'Permanent/General',
      recipientHash: recipientHash('session-secret', 'someone@example.com'),
      toAlertAddress: false,
    });
    expect(JSON.stringify(row)).not.toMatch(/someone|483920/i);
    expect(captured).toEqual([{ message: 'Mail bounced: sign_in', level: 'warning' }]);
  });

  it('says a redelivery once', async () => {
    const payload = bounced('a@b.example', '1 is your Parea code');
    await deliver(payload, { id: 'msg_same' });
    const again = await deliver(payload, { id: 'msg_same' });
    expect(await again.json()).toEqual({ ok: true, recorded: 0 });
    expect(captured).toHaveLength(1);
  });

  it('is loud when the address that safety alerts go to stops receiving', async () => {
    const res = await deliver({ type: 'email.suppressed', data: { to: ['safety@parea.example'], subject: 'Parea safety: quarantine 1' } });
    expect(res.status).toBe(200);
    expect(captured).toEqual([{ message: 'Mail to SAFETY_ALERT_EMAIL is not being delivered (suppressed)', level: 'fatal' }]);
    const [row] = await db.select().from(schema.mailEvents);
    expect(row).toMatchObject({ toAlertAddress: true, mailKind: 'alert' });
  });

  it('acknowledges and drops what it does not record', async () => {
    const res = await deliver({ type: 'email.delivered', data: { to: ['a@b.example'] } });
    expect(await res.json()).toEqual({ ok: true, recorded: 0 });
    expect(captured).toHaveLength(0);
  });
});
