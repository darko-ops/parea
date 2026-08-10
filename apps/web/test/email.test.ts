/**
 * The mailer sends what each provider actually accepts.
 *
 * This is asserted rather than trusted because of how it fails. The code route
 * swallows send failures on purpose — a mailer outage must not be reported
 * back differently from a working mailer, or the difference is the oracle the
 * endpoint exists to avoid — so a wrong request body produces a 4xx nobody
 * sees, a 204 to the caller, and a person waiting for a code that is never
 * coming.
 *
 * That is exactly what the previous version did to three providers out of
 * four: one `HttpMailer` documented as working with "any provider with an HTTP
 * send endpoint", sending Resend's body shape to all of them.
 *
 * These check the shape of the request, not that a provider likes it. Whether
 * Postmark still wants `TextBody` in a year is not something a test in this
 * repository can know; `scripts/send-test-email.ts` is the part that finds
 * that out, against a real key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConsoleMailer,
  DEFAULT_PROVIDER,
  HttpMailer,
  MailUnavailable,
  PROVIDERS,
  SEND_TIMEOUT_MS,
  UnconfiguredMailer,
  isKnownProvider,
  mailerFromEnv,
  redact,
  signInEmail,
} from '../src/email';

const MESSAGE = { to: 'sam@example.com', subject: '123456 is your Parea code', text: 'Your code is 123456.' };

type Sent = { url: string; headers: Record<string, string>; body: string };

/** Captures the one request a send makes, and answers however the test says. */
function capture(answer: Response = new Response('', { status: 200 })) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    });
    return answer;
  });
  vi.stubGlobal('fetch', fetchMock);
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider request shapes', () => {
  it('resend takes a bearer token and a flat JSON body', async () => {
    const sent = capture();
    await new HttpMailer('resend', 'https://api.resend.com/emails', 'k', 'Parea <hi@parea.photos>').send(MESSAGE);

    expect(sent[0]!.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(sent[0]!.body)).toEqual({
      from: 'Parea <hi@parea.photos>',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it('postmark takes its own token header and capitalised keys', async () => {
    const sent = capture();
    await new HttpMailer('postmark', PROVIDERS.postmark!.endpoint!, 'k', 'hi@parea.photos').send(MESSAGE);

    expect(sent[0]!.headers['x-postmark-server-token']).toBe('k');
    expect(sent[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(sent[0]!.body)).toMatchObject({
      From: 'hi@parea.photos',
      To: MESSAGE.to,
      TextBody: MESSAGE.text,
      // Transactional and broadcast are billed and reputationed separately,
      // and a sign-in code down a broadcast stream is shaped like marketing.
      MessageStream: 'outbound',
    });
  });

  it('sendgrid nests the recipient', async () => {
    const sent = capture();
    await new HttpMailer('sendgrid', PROVIDERS.sendgrid!.endpoint!, 'k', 'hi@parea.photos').send(MESSAGE);

    expect(JSON.parse(sent[0]!.body)).toEqual({
      personalizations: [{ to: [{ email: MESSAGE.to }] }],
      from: { email: 'hi@parea.photos' },
      subject: MESSAGE.subject,
      content: [{ type: 'text/plain', value: MESSAGE.text }],
    });
  });

  it('mailgun form-encodes under basic auth', async () => {
    const sent = capture();
    await new HttpMailer(
      'mailgun',
      'https://api.mailgun.net/v3/parea.photos/messages',
      'k',
      'hi@parea.photos',
    ).send(MESSAGE);

    expect(sent[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(sent[0]!.headers.authorization).toBe(`Basic ${Buffer.from('api:k').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(sent[0]!.body))).toEqual({
      from: 'hi@parea.photos',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it('every provider is exercised above', () => {
    // The guard that makes adding a fifth provider fail here rather than ship
    // untested — the same rot that hit the Dockerfile's package list and the
    // purge job's derivative keys.
    const covered = ['resend', 'postmark', 'sendgrid', 'mailgun'];
    expect(Object.keys(PROVIDERS).sort()).toEqual([...covered].sort());
  });

  it('gives up rather than hanging', async () => {
    const sent = capture();
    await new HttpMailer('resend', 'https://api.resend.com/emails', 'k', 'a@b.c').send(MESSAGE);
    // Not the duration — the presence of a bound. A hung provider turns a
    // route designed to answer identically every time into a timeout, which
    // is both a worse error and a measurable difference.
    expect(SEND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
  });
});

describe('when a provider says no', () => {
  it('carries the status and the provider’s own words', async () => {
    capture(new Response('The parea.photos domain is not verified.', { status: 403 }));
    const mailer = new HttpMailer('resend', 'https://api.resend.com/emails', 'k', 'a@b.c');

    // The difference between "sign-in is broken" and "finish the DNS", which
    // is the whole value of the log line this ends up in.
    await expect(mailer.send(MESSAGE)).rejects.toThrow(/403.*not verified/s);
    await expect(mailer.send(MESSAGE)).rejects.toHaveProperty('status', 403);
  });

  it('keeps the recipient out of the error', async () => {
    // Most providers echo the address back. This ends up in a log line that
    // outlives the ten minutes the code is good for.
    capture(new Response(`No recipient: ${MESSAGE.to}`, { status: 422 }));
    const mailer = new HttpMailer('resend', 'https://api.resend.com/emails', 'k', 'a@b.c');

    const err = await mailer.send(MESSAGE).then(
      () => new Error('expected a rejection'),
      (e: Error) => e,
    );
    expect(err.message).not.toContain(MESSAGE.to);
    expect(err.message).toContain('<recipient>');
  });

  it('is a MailUnavailable when the network is the problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const mailer = new HttpMailer('resend', 'https://api.resend.com/emails', 'k', 'a@b.c');
    await expect(mailer.send(MESSAGE)).rejects.toBeInstanceOf(MailUnavailable);
  });
});

describe('choosing a transport', () => {
  const base: Record<string, string | undefined> = {
    MAIL_API_KEY: 'k',
    MAIL_FROM: 'hi@parea.photos',
  };

  it('fills in the endpoint from the provider', () => {
    const mailer = mailerFromEnv({ ...base, MAIL_PROVIDER: 'postmark' });
    expect(mailer.name).toBe('postmark');
  });

  it('defaults to a provider rather than to nothing', () => {
    expect(isKnownProvider(DEFAULT_PROVIDER)).toBe(true);
    expect(mailerFromEnv(base).name).toBe(DEFAULT_PROVIDER);
  });

  it('refuses an unrecognised provider even in development', async () => {
    // The console transport is the local convenience and it is the wrong
    // answer here: a typo would look exactly like working development right
    // up until production, where the same typo sends nothing at all.
    const mailer = mailerFromEnv({ ...base, MAIL_PROVIDER: 'resnd', NODE_ENV: 'development' });
    expect(mailer).toBeInstanceOf(UnconfiguredMailer);
    await expect(mailer.send(MESSAGE)).rejects.toThrow(/resnd/);
  });

  it('refuses mailgun without the URL that carries its domain', async () => {
    const mailer = mailerFromEnv({ ...base, MAIL_PROVIDER: 'mailgun' });
    expect(mailer).toBeInstanceOf(UnconfiguredMailer);
    await expect(mailer.send(MESSAGE)).rejects.toThrow(/MAIL_API_URL/);
  });

  it('refuses in production and talks to the console in development', async () => {
    await expect(
      mailerFromEnv({ NODE_ENV: 'production' }).send(MESSAGE),
    ).rejects.toBeInstanceOf(MailUnavailable);
    expect(mailerFromEnv({})).toBeInstanceOf(ConsoleMailer);
  });
});

describe('the email itself', () => {
  it('puts the code where a notification will show it', () => {
    // Most people read this off a lock screen and never open it.
    expect(signInEmail('123456').subject.startsWith('123456')).toBe(true);
  });

  it('says what to do when it was not you', () => {
    // The one moment this product has to tell someone something is wrong.
    expect(signInEmail('123456').text).toMatch(/did not ask for it/);
  });
});

describe('redact', () => {
  it('leaves text alone when there is no address to remove', () => {
    expect(redact('boom', '')).toBe('boom');
  });
});
