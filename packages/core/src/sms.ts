/**
 * Sending a code by text, which is a new kind of thing for this deployment.
 *
 * Deliberately the same file as `email.ts` with the nouns changed: a provider
 * table, one small function per shape, no SDK, fails closed in production and
 * prints to the console in development. The argument for all four of those is
 * written out there and none of it is different here, so what follows is only
 * what *is* different.
 *
 * ## Why there is a second transport at all
 *
 * A phone number is only worth holding if somebody proved it is theirs, and the
 * only way to prove that is to send something to it. Without this file the
 * number column is a field anybody can type anybody's digits into — which does
 * not harm the person typing, it harms whoever owns the number, who never
 * touched the product and cannot see that it happened. So the choice was
 * either this file or no phone-based discovery, and an unverified number is the
 * worse of the two.
 *
 * ## Why the credential is sometimes a pair
 *
 * `MAIL_API_KEY` is one token for all four mailers. Two of the three carriers
 * here want two values — Twilio an account SID and an auth token, Vonage a key
 * and a secret — and the honest way to hold that in one variable is a colon
 * between them, which is also exactly what HTTP basic auth is. `SMS_API_KEY`
 * is therefore `sid:token` for Twilio, `key:secret` for Vonage and a single
 * access key for MessageBird, and `splitPair` is the one place that knows.
 *
 * The alternative — four more environment variables, three of them unset on
 * any given deployment — is more configuration to get wrong for no gain: a
 * missing half fails the same way either way, and this way `/api/health` has
 * one name to report rather than six.
 */

export type Text = {
  /** E.164. It is in memory for the length of the send and written nowhere. */
  to: string;
  body: string;
};

export type Texter = {
  name: string;
  send(message: Text): Promise<void>;
};

export class TextUnavailable extends Error {
  constructor(
    message: string,
    /** The carrier's HTTP status, when it answered at all. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * How long to wait for a carrier.
 *
 * The same ten seconds the mailer allows, for the same reason: the request is
 * in front of somebody watching a spinner, and a carrier that hangs turns a
 * failed send into a serverless timeout.
 */
export const SEND_TIMEOUT_MS = 10_000;

/** Refuses, so nothing believes a code was sent. */
export class UnconfiguredTexter implements Texter {
  readonly name = 'unconfigured';
  constructor(private readonly why = 'set SMS_API_KEY and SMS_FROM') {}
  async send(): Promise<void> {
    throw new TextUnavailable(`no texter configured; ${this.why}`);
  }
}

/**
 * Local development, and the one place a number is deliberately printed.
 *
 * It says so on every send. The number is on the line because the whole point
 * of the local transport is that somebody can read the code it would have sent
 * and know which number it went to; a console line in a developer's own
 * terminal is not the log this product keeps numbers out of.
 */
export class ConsoleTexter implements Texter {
  readonly name = 'console';
  async send(message: Text): Promise<void> {
    console.log(
      `\n── text (development only, NOT SENT) ──\nto: ${message.to}\n${message.body}\n──\n`,
    );
  }
}

type Request = { headers: Record<string, string>; body: string };

type Carrier = {
  /**
   * Where to POST when `SMS_API_URL` is unset. Null means the endpoint carries
   * something deployment-specific — an account id — and there is nothing
   * sensible to guess.
   */
  endpoint: string | null;
  shape(message: Text, from: string, key: string): Request;
};

const JSON_TYPE = 'application/json';
const FORM_TYPE = 'application/x-www-form-urlencoded';

/** `sid:token` into its halves, with an empty second half when there is none. */
export function splitPair(key: string): [string, string] {
  const at = key.indexOf(':');
  return at === -1 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)];
}

export const CARRIERS: Record<string, Carrier> = {
  twilio: {
    // The path carries the account SID, so there is no default worth guessing:
    // https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json
    endpoint: null,
    shape: (message, from, key) => {
      const [sid, token] = splitPair(key);
      return {
        headers: {
          'content-type': FORM_TYPE,
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        },
        body: new URLSearchParams({ To: message.to, From: from, Body: message.body }).toString(),
      };
    },
  },

  messagebird: {
    endpoint: 'https://rest.messagebird.com/messages',
    shape: (message, from, key) => ({
      headers: { 'content-type': JSON_TYPE, authorization: `AccessKey ${key}` },
      body: JSON.stringify({
        originator: from,
        recipients: [message.to],
        body: message.body,
      }),
    }),
  },

  vonage: {
    endpoint: 'https://rest.nexmo.com/sms/json',
    shape: (message, from, key) => {
      const [apiKey, secret] = splitPair(key);
      return {
        headers: { 'content-type': JSON_TYPE },
        body: JSON.stringify({
          api_key: apiKey,
          api_secret: secret,
          to: message.to,
          from,
          text: message.body,
        }),
      };
    },
  },
};

export type CarrierId = keyof typeof CARRIERS;

export const DEFAULT_CARRIER = 'twilio';

export function isKnownCarrier(id: string | undefined): boolean {
  return Boolean(id) && id! in CARRIERS;
}

export class HttpTexter implements Texter {
  readonly name: string;

  constructor(
    carrier: string,
    private readonly url: string,
    private readonly key: string,
    private readonly from: string,
  ) {
    this.name = carrier;
  }

  async send(message: Text): Promise<void> {
    const { headers, body } = CARRIERS[this.name]!.shape(message, this.from, this.key);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const why =
        err instanceof Error && err.name === 'TimeoutError'
          ? `no answer in ${SEND_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : 'send failed';
      throw new TextUnavailable(`${this.name}: ${why}`);
    }

    if (!res.ok) {
      /*
       * The carrier's own words, redacted harder than the mailer's.
       *
       * Every one of these echoes the recipient back in the error, and the
       * recipient here is the one thing this product has promised not to write
       * down. A log line quoting a carrier verbatim would store a phone number
       * in the one place nobody thinks to look for one.
       */
      const detail = redactNumber(await res.text().catch(() => ''), message.to).slice(0, 200);
      throw new TextUnavailable(
        `${this.name} answered ${res.status}${detail ? `: ${detail}` : ''}`,
        res.status,
      );
    }
  }
}

/**
 * Keeps a number out of a log line that quotes a carrier back verbatim.
 *
 * Both forms, because carriers are not consistent about the `+`: Twilio echoes
 * what you sent and MessageBird strips it, so replacing only the E.164 string
 * would leave the digits in the line whenever the carrier dropped the plus.
 */
export function redactNumber(text: string, phone: string): string {
  if (!phone) return text;
  const bare = phone.startsWith('+') ? phone.slice(1) : phone;
  return text.split(phone).join('<number>').split(bare).join('<number>');
}

/** Takes the environment rather than reading it, so tests need no globals. */
export function texterFromEnv(
  env: Record<string, string | undefined> = process.env,
): Texter {
  const carrier = env.SMS_PROVIDER?.trim() || DEFAULT_CARRIER;
  const key = env.SMS_API_KEY?.trim();
  const from = env.SMS_FROM?.trim();
  const url = env.SMS_API_URL?.trim() || CARRIERS[carrier]?.endpoint;

  const development = env.NODE_ENV !== 'production';

  if (!isKnownCarrier(carrier)) {
    // Never the console fallback, even locally — the same rule the mailer
    // follows. A typo in the carrier name is the one misconfiguration that
    // looks exactly like working local development until it reaches production.
    return new UnconfiguredTexter(
      `SMS_PROVIDER=${carrier} is not one of ${Object.keys(CARRIERS).join(', ')}`,
    );
  }
  if (key && from && url) return new HttpTexter(carrier, url, key, from);
  if (key && from && !url) {
    return new UnconfiguredTexter(`${carrier} has no default endpoint; set SMS_API_URL`);
  }
  return development ? new ConsoleTexter() : new UnconfiguredTexter();
}

/**
 * The whole of the text message.
 *
 * Shorter than the email, because a text is read in a banner and charged by the
 * segment. It still has to carry the two things the mail carries: that the code
 * works once and dies quickly, and what it means if you did not ask for it —
 * an unbidden code is the one moment this product can tell somebody that
 * another person is typing their number.
 *
 * It names Parea first. A six-digit code from an unnamed sender is the shape
 * every phishing text takes, and the product's name in front of it is the only
 * thing that distinguishes the two in a notification.
 *
 * ## Why every character here is GSM-7, and why that is not fussiness
 *
 * A text is billed per segment, and the segment size depends on the alphabet the
 * whole message has to be encoded in. GSM-7 gives 160 characters; a single
 * character outside it forces the *entire* message into UCS-2, where a segment is
 * 70 characters. So one wrong glyph does not cost one character, it costs two
 * thirds of the message.
 *
 * This sentence used to contain an em dash. That is U+2014, which is not in
 * GSM-7 or its extension table, so a 159-character message was being sent as
 * **three** segments: triple the price of every verification this product will
 * ever send, and slower, for one piece of punctuation. Nothing reported it —
 * the carrier accepts it and bills it — and a length check passed the whole time,
 * because the length was never the problem.
 *
 * So the punctuation here is ASCII, deliberately: a full stop where the dash was.
 * `sms.test.ts` asserts the alphabet and the resulting segment count rather than
 * the character count, which is the check that would have caught it.
 */
export function verifyText(code: string): string {
  return [
    `${code} is your Parea code. It works once and expires in ten minutes.`,
    'If you did not ask for it, somebody mistyped their number. Nothing to do.',
  ].join(' ');
}
