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
 * ever received anything. It refuses at boot-check time instead, the same way
 * ingest refuses to run unscanned.
 *
 * In development the code goes to the console, which is the honest local
 * behaviour and is why the console transport names itself loudly.
 */

export type Mailer = {
  name: string;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
};

export class MailUnavailable extends Error {}

/** Refuses, so nothing believes a code was sent. */
export class UnconfiguredMailer implements Mailer {
  readonly name = 'unconfigured';
  async send(): Promise<void> {
    throw new MailUnavailable(
      'no mailer configured; set MAIL_API_URL and MAIL_API_KEY',
    );
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

/**
 * Any provider with an HTTP send endpoint.
 *
 * Deliberately not an SDK. A sign-in email is a POST with four fields, and a
 * vendor SDK would be a dependency, a bundle, and a second place for
 * credentials to live.
 */
export class HttpMailer implements Mailer {
  readonly name = 'http';
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly from: string,
  ) {}

  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify({ from: this.from, ...message }),
      });
    } catch (err) {
      throw new MailUnavailable(err instanceof Error ? err.message : 'send failed');
    }
    if (!res.ok) throw new MailUnavailable(`mailer answered ${res.status}`);
  }
}

export function mailerFromEnv(): Mailer {
  const url = process.env.MAIL_API_URL;
  const key = process.env.MAIL_API_KEY;
  const from = process.env.MAIL_FROM;

  if (url && key && from) return new HttpMailer(url, key, from);
  if (process.env.NODE_ENV === 'production') return new UnconfiguredMailer();
  return new ConsoleMailer();
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
