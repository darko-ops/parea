/**
 * The one text message this product sends, described in public.
 *
 * ## Why a page, when the terms already cover it
 *
 * Because "publicly reachable" is a requirement and the screen that actually
 * asks for a number is not. `/find/friends` is behind a sign-in — it has to be,
 * a phone number belongs to an account rather than to a browser — so a reviewer
 * handed that URL meets a login wall, which reads as evidence that does not
 * exist. US carriers reviewing an A2P campaign ask for a link to where the
 * opt-in call-to-action is displayed, and this is a page that can be that link.
 *
 * It is not a duplicate of the terms. The terms are the agreement and say what
 * is promised; this is the disclosure and shows what the request looks like,
 * including the exact words somebody reads above the button. A reviewer should
 * be able to compare this page against a screenshot of the real screen and find
 * them identical, which is why `CONSENT` below is the single source of both.
 *
 * ## Why it is indexable, unlike most of this product
 *
 * Almost everything here is `noindex`, because possession of a link is the
 * access model and a crawled album is somebody's evening in a search index.
 * This page contains nothing about anybody. It has to be reachable by a
 * reviewer who has not signed in and, ideally, findable — so it is not in the
 * disallow list in `robots.ts` and not in the `noindex` roots in
 * `next.config.ts`. Adding it to either would defeat the only reason it exists.
 */

import { Shell } from '@/../app/components/Shell';

export const metadata = {
  title: 'Text messages',
  description:
    'Parea sends one kind of text message: a code you asked for, to confirm your own phone number.',
};

const CONTACT = process.env.SAFETY_CONTACT_EMAIL ?? 'safety@example.com';

/**
 * The words above the button, verbatim.
 *
 * Exported so that the screen and this page cannot drift, and so a test can
 * assert they are the same string. That matters more than it looks: the campaign
 * is approved against a screenshot of one and a reading of the other, and a
 * reviewer who finds them different has found a product describing itself
 * inaccurately — which is the thing they are checking for.
 */
export const CONSENT =
  'By tapping “Send me a code” you agree to receive one text message from ' +
  'Parea containing a verification code. One message per request, not a ' +
  'subscription. Message and data rates may apply. See our Terms and Privacy.';

export default function TextsPage() {
  return (
    <Shell>
      <main className="wrap">
        <h1>Text messages from Parea</h1>

        <section className="panel">
          <h2>There is one, and you ask for it</h2>
          <p className="muted">
            Parea sends exactly one kind of text message: a six-digit code, to a
            phone number you have just typed in yourself, so that we can confirm
            the number is yours. Nothing else is ever sent by text &mdash; no
            marketing, no reminders, no notifications.
          </p>
          <p className="muted">
            Confirming a number is optional. It exists so that people who already
            have your number can find you here, and nothing else in Parea
            requires it.
          </p>
        </section>

        <section className="panel">
          <h2>Where you are asked, and what it says</h2>
          <p className="muted">
            In the Parea app, or at <strong>parea.photos</strong>, on the Find
            Friends screen &mdash; reached from the button in the corner of Find.
            You type your own number into a field and press a button. Directly
            beneath that button, these words:
          </p>
          {/*
            Drawn as the screen draws it, rather than quoted in a sentence.

            A reviewer is comparing this against a screenshot, so the useful
            thing is a rendering they can match rather than a paraphrase they
            have to interpret.
          */}
          <blockquote className="sms-quote">{CONSENT}</blockquote>
          <p className="muted">
            You have to have an account and be signed in to reach that screen,
            which is why this page exists: the screen itself cannot be shown to
            somebody who is not signed in, and the words on it should be readable
            by anybody.
          </p>
        </section>

        <section className="panel">
          <h2>What arrives</h2>
          <blockquote className="sms-quote">
            123456 is your Parea code. It works once and expires in ten minutes.
            If you did not ask for it, somebody mistyped their number. Nothing to
            do.
          </blockquote>
          <p className="muted">
            The digits change; nothing else does. There is no link in it and no
            phone number in it.
          </p>
        </section>

        <section className="panel">
          <h2>How often, and what it costs</h2>
          <p className="muted">
            One message per request. You receive a text only in the seconds after
            you ask for one, and never otherwise &mdash; there is no recurring
            programme and no list.
          </p>
          <p className="muted">
            Parea does not charge you. Your own mobile network may: message and
            data rates may apply.
          </p>
        </section>

        <section className="panel">
          <h2>Stopping, and getting help</h2>
          <p className="muted">
            There is nothing to unsubscribe from, because nothing recurs. If you
            no longer want your number held here at all, remove it &mdash; in the
            app under Settings, or at <a href="/account">/account</a> on the web.
            Both the scrambled form of the number and the record that it was
            confirmed are deleted, and you will not be texted again.
          </p>
          <p className="muted">
            Replying <strong>STOP</strong> to a message also stops any further
            texts to that number, handled by the network before it reaches us.
          </p>
          <p className="muted">
            For help, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and a
            person will answer.
          </p>
        </section>

        <section className="panel">
          <h2>Your number itself</h2>
          <p className="muted">
            It is not stored as digits. What is kept is a scrambled form of it
            &mdash; a keyed hash, which cannot be turned back into the number
            without a key held outside the database &mdash; and the last two
            digits, so your own profile can tell you which number you gave. It is
            never shown to anybody else and never appears on your profile.
          </p>
          <p className="muted">
            Neither your number nor the record that you asked for a code is
            shared with third parties or affiliates for marketing or promotional
            purposes, and neither is ever sold or rented. The one place a number
            goes is the company that delivers the text, in order to deliver it.
            The <a href="/privacy">privacy page</a> sets all of this out, and the{' '}
            <a href="/terms">terms</a> are the agreement it sits under.
          </p>
        </section>
      </main>
    </Shell>
  );
}
