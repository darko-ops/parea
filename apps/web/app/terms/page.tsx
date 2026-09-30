/**
 * Terms of use, which is also the EULA the App Store requires.
 *
 * App Store Guideline 1.2 asks an app carrying user-generated content for four
 * things — a filter for objectionable material, a way to report it with a
 * timely response, a way to block abusive users, and published contact
 * details — and for terms that state a zero-tolerance position on both the
 * content and the users. The first four are built; this is the fifth, and the
 * "Nothing here is tolerated" section is the part review reads.
 *
 * The commitments here are ones the code can actually keep. A 24-hour promise
 * is in the guidelines and is also a promise about a human being awake, so it
 * is stated as what happens rather than as a service level: reports are acted
 * on, and an unanswered removal request hides the photo after 48 hours whether
 * or not anyone was awake, because a scheduled job does it.
 *
 * Indexable on purpose — review has to reach it, and so does anyone deciding
 * whether to accept it.
 */

import { LEGAL_ENTITY, LEGAL_JURISDICTION, LEGAL_UPDATED, SAFETY_CONTACT, hashMatchingLive } from '@/legal';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { Shell } from '@/../app/components/Shell';

export const metadata = {
  title: 'Terms',
  description: 'The agreement for using Parea, including what is not allowed.',
};

export default function TermsPage() {
  return (
    <Shell>
      <main className="wrap">
        <h1>Terms</h1>
        <p className="muted">Last updated {LEGAL_UPDATED}.</p>

        <section className="panel">
          <h2>The agreement</h2>
          <p className="muted">
            This is the agreement between you and {LEGAL_ENTITY} for using Parea,
            on the web or in the app. Using it means accepting this. If you do
            not, do not upload anything.
          </p>
        </section>

        <section className="panel">
          <h2>Who can use it</h2>
          <p className="muted">
            You must be at least 13, and old enough where you live to agree to
            this on your own. We ask for your date of birth when you make an
            account, and do not keep it. If you are using Parea on behalf of an
            organisation, you are saying you are allowed to agree to it for them.
          </p>
        </section>

        <section className="panel">
          <h2>Nothing here is tolerated</h2>
          <p className="muted">
            <strong>
              There is zero tolerance for objectionable content and for abusive
              users.
            </strong>{' '}
            Content that breaks this rule is removed, and the person who posted it
            loses access, without notice and without a warning first.
          </p>
          <p className="muted">Do not upload, or ask anyone else to upload:</p>
          <ul className="plain muted">
            <li>
              Anything sexual involving a child, in any form.{' '}
              {hashMatchingLive()
                ? 'Every image is checked for this before anyone sees it, detections'
                : 'Reports of it hide the photo immediately, detections'}{' '}
              are reported to the authorities as the law requires, and the
              account is finished.
            </li>
            <li>
              Intimate or sexual images of anyone who has not agreed to them
              being shared.
            </li>
            <li>
              Photographs of people taken where they had a reasonable expectation
              of privacy, or images shared to humiliate, harass, threaten or
              expose someone.
            </li>
            <li>
              Content that incites violence, or that attacks people for who they
              are.
            </li>
            <li>
              Anything you do not have the right to share, including other
              people&rsquo;s photographs.
            </li>
            <li>
              Anything illegal where you are or where we operate.
            </li>
          </ul>
          <p className="muted">
            And do not do these things: harass anyone, use a link you were not
            given, try to reach rolls you were not invited to, break or
            overload the service, scrape it, or use it to send messages to people
            who did not ask for them.
          </p>
        </section>

        <section className="panel">
          <h2>Reporting, and what happens next</h2>
          <p className="muted">
            Every photo, moment, comment, message, profile and group has a
            report action on it, and reports come to us rather than to whoever
            created the roll or the group, because sometimes that is the person
            who is the problem. A report of child abuse hides the photo
            from everyone straight away while a person reviews it. Other reports
            are reviewed and acted on within 72 hours.
          </p>
          <p className="muted">
            You can also ask for a photo of you to be taken down without having
            uploaded anything; you need an account to ask. That request goes to
            whoever created the roll, and if they have not answered within 48
            hours the photo is hidden automatically while they decide.
          </p>
          <p className="muted">
            You can block anyone. Blocking hides the two of you from each other
            &mdash; photos, messages, comments, reactions and moments, even in
            rolls and groups you share &mdash; and stops them joining rolls you
            created. They are not told.
          </p>
          <p className="muted">
            Reach a human at <a href={`mailto:${SAFETY_CONTACT}`}>{SAFETY_CONTACT}</a>.
            More detail is on the <a href="/safety">safety page</a>.
          </p>
        </section>

        <section className="panel">
          <h2>Your photos stay yours</h2>
          <p className="muted">
            You keep every right you have in what you upload. Nothing here
            transfers ownership, and we do not use your photos to advertise, to
            train anything, or for any purpose of our own.
          </p>
          <p className="muted">
            What you do give us is the narrow permission needed to run the
            product: to store your photos, to make the smaller copies that let
            them be displayed, to strip the location metadata, and to show and
            give them to the other people in the same roll. That permission
            exists so the product can work and ends when you delete the photo.
          </p>
          <p className="muted">
            People in a roll can download the full set, at full quality. That
            is the entire point of Parea, and it means a copy of your photo can
            exist on someone else&rsquo;s computer after you delete it here.
            Deleting removes it from Parea; it cannot reach into a download
            somebody already took.
          </p>
        </section>

        <section className="panel">
          <h2>Who can see a roll, and who can add to it</h2>
          <p className="muted">
            Whoever makes a roll decides. A public roll can be opened by anyone
            who has its link or finds it on its maker&rsquo;s profile. A private
            roll shows only its name to people who are not in it; they can ask
            to come in, and its maker decides. Adding photos always needs an
            account, and the roll&rsquo;s maker chooses who may add.
          </p>
          <p className="muted">
            Share a roll&rsquo;s link the way you would share a key: with the
            people who were there, and not in public. If a link gets out, its
            maker can rotate it, which stops the old one working. A public roll
            needs no link to open, so rotating does not shut anybody out of one;
            making it private does. A roll&rsquo;s spoken code works only for
            somebody signed in.
          </p>
        </section>

        <section className="panel">
          <h2>The text message we send</h2>
          <p className="muted">
            Parea sends exactly one kind of text: a six-digit code, to a number
            you have just typed into the app or the website yourself, so that we
            can confirm the number is yours. That is the only message this
            service will ever send you by SMS.
          </p>
          <p className="muted">
            <strong>Frequency.</strong> One message per request. There is no
            recurring programme, no campaign and no list &mdash; you receive a
            text only in the seconds after you ask for one, and never otherwise.
          </p>
          <p className="muted">
            <strong>Cost.</strong> Message and data rates may apply, charged by
            your own mobile network. We do not charge you for it.
          </p>
          <p className="muted">
            <strong>Stopping it.</strong> There is nothing to unsubscribe from,
            because there is nothing recurring to leave. If you no longer want
            your number here at all, remove it &mdash; in the app under Settings,
            or at <a href="/account">/account</a> on the web &mdash; and both the
            scrambled form of it and the record that it was confirmed are
            deleted. You will not be texted again.
          </p>
          <p className="muted">
            <strong>Help.</strong> Write to the address on our{' '}
            <a href="/safety">safety page</a> and a person will answer.
          </p>
          <p className="muted">
            <strong>Delivery.</strong> Mobile networks and message providers are
            not liable for delayed or undelivered messages, and neither are we: a
            code depends on your carrier to arrive, which is outside anybody
            here&rsquo;s control. If one does not turn up you can ask for another.
          </p>
          <p className="muted">
            What happens to the number itself &mdash; that it is never stored as
            digits, never shown to anybody, and never shared for anyone&rsquo;s
            marketing &mdash; is set out on the{' '}
            <a href="/privacy">privacy page</a>. The message, the words you agree
            to before it is sent, and everything above restated in one place are
            on <a href="/texts">the text messages page</a>.
          </p>
        </section>

        <section className="panel">
          <h2>Ending it</h2>
          <p className="muted">
            You can delete your account at any time, at{' '}
            <a href="/account">/account</a> or in the app, and choose whether your
            uploads go with it.
          </p>
          <p className="muted">
            We can suspend or end your access if you break these terms &mdash;
            immediately, in the case of the content in the zero-tolerance list
            above. Records we are legally required to keep are kept regardless;
            the <a href="/privacy">privacy page</a> says which and for how long.
          </p>
        </section>

        <section className="panel">
          <h2>What we do not promise</h2>
          <p className="muted">
            Parea is provided as it is. We work hard to keep your photos safe and
            available, and we do not promise the service will be uninterrupted or
            free of faults, or that a photo stored here is a backup. Keep your
            own copies of anything you would be upset to lose &mdash; on your
            phone, where they already are.
          </p>
          <p className="muted">
            To the extent the law allows, we are not liable for indirect or
            consequential losses, and our total liability to you is limited to
            what you have paid us, which today is nothing.
          </p>
        </section>

        <section className="panel">
          <h2>Changes</h2>
          <p className="muted">
            If these terms change in a way that matters, the date at the top
            changes and we will say so in the product. Continuing to use Parea
            after that means accepting the new version.
          </p>
        </section>

        <section className="panel">
          <h2>Law</h2>
          <p className="muted">
            These terms are governed by the law of {LEGAL_JURISDICTION}, and its
            courts have jurisdiction &mdash; without taking away any protection
            you have under the law of the country you live in.
          </p>
        </section>

        <section className="panel">
          <h2>Contact</h2>
          <p className="muted">
            {LEGAL_ENTITY} &mdash;{' '}
            <a href={`mailto:${SAFETY_CONTACT}`}>{SAFETY_CONTACT}</a>
          </p>
        </section>

        <SiteFooter />
      </main>
    </Shell>
  );
}
