/**
 * The texter sends what each carrier actually accepts.
 *
 * The same argument `email.test.ts` opens with, and the failure is the same
 * shape: the route that asks for a code swallows send failures on purpose — a
 * carrier outage must not be reported back differently from a working carrier,
 * because the difference is an oracle on whether a number has been asked about —
 * so a wrong body is a 4xx nobody sees, a cheerful answer to the caller, and
 * somebody staring at a phone waiting for a code that is never coming.
 *
 * One thing is tested harder here than for mail, and it is the redaction. A
 * phone number is the one value this product has promised not to write down, and
 * every carrier echoes the recipient back in its errors.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARRIERS,
  ConsoleTexter,
  DEFAULT_CARRIER,
  HttpTexter,
  TextUnavailable,
  UnconfiguredTexter,
  isKnownCarrier,
  redactNumber,
  splitPair,
  texterFromEnv,
  verifyText,
} from '@parea/core';

const MESSAGE = { to: '+15550104477', body: '123456 is your Parea code.' };
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json';

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

describe('carrier request shapes', () => {
  it('twilio form-encodes under basic auth from the pair', async () => {
    const sent = capture();
    await new HttpTexter('twilio', TWILIO, 'AC1:token', '+15550100000').send(MESSAGE);

    expect(sent[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(sent[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from('AC1:token').toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(sent[0]!.body))).toEqual({
      To: MESSAGE.to,
      From: '+15550100000',
      Body: MESSAGE.body,
    });
  });

  it('messagebird takes an AccessKey header and a recipients array', async () => {
    const sent = capture();
    await new HttpTexter(
      'messagebird',
      CARRIERS.messagebird!.endpoint!,
      'k',
      'Parea',
    ).send(MESSAGE);

    expect(sent[0]!.headers.authorization).toBe('AccessKey k');
    expect(JSON.parse(sent[0]!.body)).toEqual({
      originator: 'Parea',
      recipients: [MESSAGE.to],
      body: MESSAGE.body,
    });
  });

  it('vonage puts both halves of the pair in the body', async () => {
    // Its credential is in the JSON rather than in a header, which is the one
    // thing that makes it different from the other two.
    const sent = capture();
    await new HttpTexter('vonage', CARRIERS.vonage!.endpoint!, 'key:secret', 'Parea').send(
      MESSAGE,
    );

    expect(sent[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(sent[0]!.body)).toEqual({
      api_key: 'key',
      api_secret: 'secret',
      to: MESSAGE.to,
      from: 'Parea',
      text: MESSAGE.body,
    });
  });

  it('every carrier is exercised above', () => {
    // The guard that makes adding a fourth carrier fail here rather than ship
    // untested, exactly as the mailer's list does.
    expect(Object.keys(CARRIERS).sort()).toEqual(
      ['messagebird', 'twilio', 'vonage'].sort(),
    );
  });
});

describe('the credential that is sometimes a pair', () => {
  it('splits on the first colon, so a token containing one survives', () => {
    expect(splitPair('AC1:to:ken')).toEqual(['AC1', 'to:ken']);
  });

  it('leaves a single value alone rather than inventing a half', () => {
    expect(splitPair('k')).toEqual(['k', '']);
  });
});

describe('when a carrier says no', () => {
  it('carries the status and the carrier’s own words', async () => {
    capture(new Response('The message From/To pair violates a blacklist rule.', {
      status: 400,
    }));
    const texter = new HttpTexter('twilio', TWILIO, 'AC1:token', '+15550100000');

    // The difference between "verification is broken" and "register the A2P
    // campaign", which is the whole value of the log line this ends up in.
    await expect(texter.send(MESSAGE)).rejects.toThrow(/400.*blacklist/s);
    await expect(texter.send(MESSAGE)).rejects.toHaveProperty('status', 400);
  });

  it('keeps the number out of the error, with or without its plus', async () => {
    /*
     * The assertion this file exists for. Twilio echoes what you sent and
     * MessageBird strips the `+`, so a redaction that only replaced the E.164
     * string would leave ten digits in a log line on half the carriers — in the
     * one product that has promised never to write a number down.
     */
    capture(new Response(`To ${MESSAGE.to} and 15550104477 are unreachable`, { status: 422 }));
    const texter = new HttpTexter('twilio', TWILIO, 'AC1:token', '+15550100000');

    const err = await texter.send(MESSAGE).then(
      () => new Error('expected a rejection'),
      (e: Error) => e,
    );
    expect(err.message).not.toContain('5550104477');
    expect(err.message).toContain('<number>');
  });

  it('is a TextUnavailable when the network is the problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const texter = new HttpTexter('twilio', TWILIO, 'AC1:token', '+15550100000');
    await expect(texter.send(MESSAGE)).rejects.toBeInstanceOf(TextUnavailable);
  });
});

describe('choosing a transport', () => {
  const base: Record<string, string | undefined> = {
    SMS_API_KEY: 'k',
    SMS_FROM: 'Parea',
  };

  it('fills in the endpoint from the carrier', () => {
    expect(texterFromEnv({ ...base, SMS_PROVIDER: 'messagebird' }).name).toBe('messagebird');
  });

  it('defaults to a carrier rather than to nothing', () => {
    expect(isKnownCarrier(DEFAULT_CARRIER)).toBe(true);
    expect(texterFromEnv({ ...base, SMS_API_URL: TWILIO }).name).toBe(DEFAULT_CARRIER);
  });

  it('refuses an unrecognised carrier even in development', async () => {
    // The console transport is the local convenience and the wrong answer here:
    // a typo would look exactly like working development until production.
    const texter = texterFromEnv({ ...base, SMS_PROVIDER: 'twillio', NODE_ENV: 'development' });
    expect(texter).toBeInstanceOf(UnconfiguredTexter);
    await expect(texter.send(MESSAGE)).rejects.toThrow(/twillio/);
  });

  it('refuses twilio without the URL that carries its account', async () => {
    const texter = texterFromEnv({ ...base, SMS_PROVIDER: 'twilio' });
    expect(texter).toBeInstanceOf(UnconfiguredTexter);
    await expect(texter.send(MESSAGE)).rejects.toThrow(/SMS_API_URL/);
  });

  it('refuses in production and talks to the console in development', async () => {
    await expect(
      texterFromEnv({ NODE_ENV: 'production' }).send(MESSAGE),
    ).rejects.toBeInstanceOf(TextUnavailable);
    expect(texterFromEnv({})).toBeInstanceOf(ConsoleTexter);
  });
});

describe('the text itself', () => {
  it('opens with the code, where a notification will show it', () => {
    // Most people read this off a lock screen and never open the message.
    expect(verifyText('123456').startsWith('123456')).toBe(true);
  });

  it('names the product, because an unnamed code is what phishing looks like', () => {
    expect(verifyText('123456')).toContain('Parea');
  });

  it('says what it means if you did not ask', () => {
    // The one moment this product can tell somebody that another person is
    // typing their number.
    expect(verifyText('123456')).toMatch(/did not ask for it/);
  });

  /**
   * The alphabet, and then the segment count that follows from it.
   *
   * This replaces a character-count assertion that passed while the message was
   * being sent as three segments. A text is billed per segment and the segment
   * size depends on the encoding: GSM-7 gives 160 characters, and a *single*
   * character outside it forces the whole message into UCS-2, where a segment is
   * 70. So the cost of one wrong glyph is not one character, it is two thirds of
   * the message — and the old check could not see that, because the length was
   * never what was wrong.
   *
   * The offender was an em dash. Nothing reported it: the carrier accepts the
   * message and bills for three.
   */
  const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  /** These cost two septets each, which is why the count below is not the length. */
  const GSM7_EXTENDED = '^{}\\[~]|€';

  it('is written entirely in GSM-7, so one segment stays one segment', () => {
    const message = verifyText('123456');
    const outside = [...message].filter(
      (c) => !GSM7_BASIC.includes(c) && !GSM7_EXTENDED.includes(c),
    );
    expect(
      outside.map((c) => `${c} U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`),
      'these characters force the whole message into UCS-2, at 70 chars a segment',
    ).toEqual([]);
  });

  it('fits in one segment, counted in septets rather than characters', () => {
    // Two segments is twice the price of the one thing this transport exists to
    // send, on every verification, forever.
    const message = verifyText('123456');
    const septets = [...message].reduce(
      (n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1),
      0,
    );
    expect(septets).toBeLessThanOrEqual(160);
  });

  it('leaves room for a longer code without spilling into a second segment', () => {
    /*
     * `SIGN_IN_CODE_LENGTH` is six and could reasonably become eight. A message
     * sized to exactly 160 would silently double in price on that change, which
     * is the kind of consequence nobody connects to a constant two files away.
     */
    const septets = verifyText('12345678').length;
    expect(septets).toBeLessThanOrEqual(160);
  });
});

describe('redactNumber', () => {
  it('leaves text alone when there is no number to remove', () => {
    expect(redactNumber('boom', '')).toBe('boom');
  });
});
