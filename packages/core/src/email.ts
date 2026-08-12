/**
 * Sending a sign-in code — design §3.
 *
 * Shaped like the CSAM scanner in `services/deriver/src/safety.ts`, and for
 * the same reason: it is a third-party dependency the deployment must supply,
 * and the interesting decision is what happens when it is absent.
 *
 * **Fails closed in production.** An unconfigured mailer does not silently
 * drop codes and answer 204 — that would look identical to someone mistyping
 * their address, and the whole sign-in path would appear to work while nobody
 * ever received anything. It refuses instead, the same way ingest refuses to
 * run unscanned, and `/api/health` reports the missing variables by name.
 *
 * In development the code goes to the console, which is the honest local
 * behaviour and is why the console transport names itself loudly.
 *
 * ## Why a provider table rather than one generic POST
 *
 * This file used to have a single `HttpMailer` documented as working with
 * "any provider with an HTTP send endpoint". That was not true. The body it
 * sent — `{from, to, subject, text}` under a bearer token — is Resend's API
 * and nobody else's: Postmark wants capitalised keys and its own token
 * header, SendGrid wants a nested `personalizations` array, Mailgun wants
 * form encoding and basic auth. Pointing the old mailer at any of the three
 * produced a 4xx, and the route swallows send failures by design, so the
 * symptom would have been sign-in silently never working.
 *
 * So the shapes are written down. Four providers, one small function each,
 * still no SDK: a sign-in email is a POST with four fields, and a vendor SDK
 * would be a dependency, a bundle, and a second place for credentials to live.
 */

export type Mailer = {
  name: string;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
};

export class MailUnavailable extends Error {
  constructor(
    message: string,
    /** The provider's HTTP status, when it answered at all. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * How long to wait for a provider.
 *
 * Bounded because the request is in front of a person: the route answers 204
 * whatever happens, and a mailer that hangs turns that into a serverless
 * timeout, which is both a worse error and a slower one — and response time is
 * itself an oracle on an endpoint whose whole design is to answer the same
 * however it went.
 */
export const SEND_TIMEOUT_MS = 10_000;

/** Refuses, so nothing believes a code was sent. */
export class UnconfiguredMailer implements Mailer {
  readonly name = 'unconfigured';
  constructor(private readonly why = 'set MAIL_API_KEY and MAIL_FROM') {}
  async send(): Promise<void> {
    throw new MailUnavailable(`no mailer configured; ${this.why}`);
  }
}

/** Local development. Says so on every send, so it cannot be mistaken for real. */
export class ConsoleMailer implements Mailer {
  readonly name = 'console';
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    console.log(
      `\n── mail (development only, NOT SENT) ──\nto: ${message.to}\n${message.text}\n──\n`,
    );
  }
}

export type Message = { to: string; subject: string; text: string };

type Request = { headers: Record<string, string>; body: string };

type Provider = {
  /**
   * Where to POST when `MAIL_API_URL` is unset. Null means the endpoint is
   * deployment-specific and there is nothing sensible to guess.
   */
  endpoint: string | null;
  shape(message: Message, from: string, key: string): Request;
};

const JSON_TYPE = 'application/json';

export const PROVIDERS: Record<string, Provider> = {
  resend: {
    endpoint: 'https://api.resend.com/emails',
    shape: (message, from, key) => ({
      headers: { 'content-type': JSON_TYPE, authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, ...message }),
    }),
  },

  postmark: {
    endpoint: 'https://api.postmarkapp.com/email',
    shape: (message, from, key) => ({
      headers: {
        'content-type': JSON_TYPE,
        accept: JSON_TYPE,
        'x-postmark-server-token': key,
      },
      body: JSON.stringify({
        From: from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        // Postmark bills and reputations transactional and broadcast mail
        // separately, and a sign-in code sent down a broadcast stream is
        // rate-shaped like marketing.
        MessageStream: 'outbound',
      }),
    }),
  },

  sendgrid: {
    endpoint: 'https://api.sendgrid.com/v3/mail/send',
    shape: (message, from, key) => ({
      headers: { 'content-type': JSON_TYPE, authorization: `Bearer ${key}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: from },
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.text }],
      }),
    }),
  },

  mailgun: {
    // Mailgun's path carries the sending domain and its EU region is a
    // different host, so there is no default worth guessing. MAIL_API_URL is
    // required: https://api.mailgun.net/v3/<domain>/messages
    endpoint: null,
    shape: (message, from, key) => ({
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`api:${key}`).toString('base64')}`,
      },
      body: new URLSearchParams({ from, ...message }).toString(),
    }),
  },
};

export type ProviderId = keyof typeof PROVIDERS;

export const DEFAULT_PROVIDER = 'resend';

export function isKnownProvider(id: string | undefined): boolean {
  return Boolean(id) && id! in PROVIDERS;
}

export class HttpMailer implements Mailer {
  readonly name: string;

  constructor(
    provider: string,
    private readonly url: string,
    private readonly key: string,
    private readonly from: string,
  ) {
    this.name = provider;
  }

  async send(message: Message): Promise<void> {
    const { headers, body } = PROVIDERS[this.name]!.shape(message, this.from, this.key);

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
      throw new MailUnavailable(`${this.name}: ${why}`);
    }

    if (!res.ok) {
      // The provider's own words, which is the difference between "sign-in is
      // broken" and "the sending domain is not verified yet". Redacted,
      // because most of them echo the recipient back in the error and this
      // ends up in a log line.
      const detail = redact(await res.text().catch(() => ''), message.to).slice(0, 200);
      throw new MailUnavailable(
        `${this.name} answered ${res.status}${detail ? `: ${detail}` : ''}`,
        res.status,
      );
    }
  }
}

/** Keeps an address out of a log line that quotes a provider back verbatim. */
export function redact(text: string, email: string): string {
  return email ? text.split(email).join('<recipient>') : text;
}

/** Takes the environment rather than reading it, so tests need no globals. */
export function mailerFromEnv(
  env: Record<string, string | undefined> = process.env,
): Mailer {
  const provider = env.MAIL_PROVIDER?.trim() || DEFAULT_PROVIDER;
  const key = env.MAIL_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  const url = env.MAIL_API_URL?.trim() || PROVIDERS[provider]?.endpoint;

  const development = env.NODE_ENV !== 'production';

  if (!isKnownProvider(provider)) {
    // Never the console fallback, even locally. A typo in the provider name is
    // the one misconfiguration that would otherwise look exactly like working
    // local development, right up until it reached production.
    return new UnconfiguredMailer(
      `MAIL_PROVIDER=${provider} is not one of ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  if (key && from && url) return new HttpMailer(provider, url, key, from);
  if (key && from && !url) {
    return new UnconfiguredMailer(`${provider} has no default endpoint; set MAIL_API_URL`);
  }
  return development ? new ConsoleMailer() : new UnconfiguredMailer();
}

/**
 * The whole of the email.
 *
 * Short on purpose, and it says what to do if it was not you — a sign-in code
 * arriving unbidden is the one moment this product has to tell someone
 * something is wrong.
 */
export function signInEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your Parea code`,
    text: [
      `Your code is ${code}.`,
      '',
      'It works once and expires in ten minutes.',
      '',
      'If you did not ask for it, someone typed your address by mistake —',
      'there is nothing to do, and nobody can get in without this code.',
    ].join('\n'),
  };
}
