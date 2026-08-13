/**
 * Privacy policy.
 *
 * Written from the schema rather than from a template, which is the only
 * reason it is worth anything: every claim below is checkable against
 * `packages/core/src/schema.ts`, and the two lists that would rot — what is
 * collected, and who processes it — are asserted in `legal.test.ts` against
 * the tables and the environment variables that actually exist.
 *
 * A policy that describes a product nobody built is the normal failure here,
 * and it is worse than no policy: it is a written, dated, public statement of
 * something untrue about what happens to people's photos.
 *
 * Indexable on purpose. App Store review needs to reach it without a link,
 * and so does anyone deciding whether to upload.
 */

import { LEGAL_ENTITY, LEGAL_UPDATED, SAFETY_CONTACT } from '@/legal';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { Shell } from '@/../app/components/Shell';

export const metadata = {
  title: 'Privacy',
  description: 'What Parea collects, what it does not, and how to get rid of it.',
};

export default function PrivacyPage() {
  return (
    <Shell>
      <main className="wrap">
        <h1>Privacy</h1>
        <p className="muted">Last updated {LEGAL_UPDATED}.</p>

        <section className="panel">
          <h2>The short version</h2>
          <p className="muted">
            Parea exists to collect photos from one thing that happened and give
            everyone who was there the full set. It needs your photos to do that.
            It does not need to know who you are, and mostly it does not.
          </p>
          <p className="muted">
            There is no advertising, no tracking, no analytics service, and
            nothing is sold or shared for anyone else&rsquo;s purposes. An account
            is optional and holds an email address and nothing else.
          </p>
        </section>

        <section className="panel">
          <h2>What is collected</h2>

          <h3>Photos and videos you upload</h3>
          <p className="muted">
            Kept at full quality, exactly as your camera produced them. Before
            any of them is shown to anyone, precise location is removed from the
            file &mdash; the image itself is untouched, only the metadata saying
            where it was taken. The date, the camera model and the orientation
            are kept, because the date is what puts the evening in order.
          </p>
          <p className="muted">
            Between the moment you upload and the moment that processing
            finishes, the untouched original is in storage. Nothing serves it or
            lists it during that window, but it is honest to say that it exists.
          </p>

          <h3>An identifier for your device</h3>
          <p className="muted">
            Created the first time you <em>contribute</em> something, not when
            you first visit. Browsing an event you were sent a link to creates no
            record of you. It is a random identifier in a cookie, or in the
            app&rsquo;s keychain; it is what makes your photos yours to delete.
          </p>

          <h3>An email address, only if you ask for an account</h3>
          <p className="muted">
            An account does one thing: it makes a new phone still you. It grants
            nothing you did not already have. Sign-in is a one-time code &mdash;
            there is no password, because a password would be the most sensitive
            thing here, protecting the least.
          </p>

          <h3>A display name, if you give one</h3>
          <p className="muted">Optional, and free text. Nothing verifies it.</p>

          <h3>A notification token, if you turn notifications on</h3>
          <p className="muted">
            Only in the app, only after you allow it, and only used for the three
            notifications this product sends: someone added photos to your event,
            someone asked to join your group, someone asked for a photo of them
            to be removed.
          </p>

          <h3>Five facts about how the product is used</h3>
          <p className="muted">
            A closed list, recorded in our own database, never sent anywhere:
            that someone joined an event, that an archive was downloaded, that a
            photo suggestion was shown, how much of a suggestion was kept, and
            that the plain picker was used instead. They answer one question
            &mdash; does anyone other than the person who made the event actually
            add photos &mdash; and nothing else is collected &ldquo;in case it is
            useful later&rdquo;.
          </p>

          <h3>Your IP address, briefly</h3>
          <p className="muted">
            Used to limit how fast requests can arrive, so that one script cannot
            flood the service or use it to send mail to strangers. It is not
            stored: what is stored is a keyed hash of it and a counter, and the
            row is deleted within the hour. Our hosting providers keep their own
            connection logs, as every host does.
          </p>
        </section>

        <section className="panel">
          <h2>What is not collected</h2>
          <ul className="plain muted">
            <li>No advertising identifiers, and no advertising.</li>
            <li>No third-party analytics or tracking SDK, in the app or on the web.</li>
            <li>No contacts, no address book, no social graph import.</li>
            <li>
              No background location, and no location at all beyond what is
              already inside a photo you chose to upload.
            </li>
            <li>
              No profile built about you, and nothing sold, rented or shared for
              anyone else&rsquo;s marketing.
            </li>
          </ul>
          <p className="muted">
            The app asks for photo library access when you add photos, and for
            camera access if you scan a code. Both are asked at the moment they
            are used and both can be refused without breaking anything else.
          </p>
        </section>

        <section className="panel">
          <h2>Who else handles it</h2>
          <p className="muted">
            Companies that run infrastructure on our behalf, each doing one job
            and none of them permitted to use anything for their own purposes:
          </p>
          <ul className="plain muted">
            <li>
              <strong>Cloudflare</strong> &mdash; stores the photos, and serves
              images and downloads.
            </li>
            <li>
              <strong>Neon</strong> &mdash; the database: events, who is in them,
              and the records described above.
            </li>
            <li>
              <strong>Vercel</strong> &mdash; runs the website and the API.
            </li>
            <li>
              <strong>Fly.io</strong> &mdash; runs the processing that strips
              location and makes the smaller copies.
            </li>
            <li>
              <strong>Resend</strong> &mdash; sends sign-in codes. It sees the
              address the code goes to.
            </li>
            <li>
              <strong>Expo</strong> &mdash; delivers push notifications to the
              app, via Apple and Google.
            </li>
            <li>
              <strong>A child-safety scanning provider</strong> &mdash; see below.
            </li>
          </ul>
          <p className="muted">
            These providers operate in the United States and elsewhere, so
            uploading means your photos are stored and processed there.
          </p>
        </section>

        <section className="panel">
          <h2>Child safety scanning</h2>
          <p className="muted">
            Every uploaded image is checked for child sexual abuse material
            before it is shown to anyone. This is not optional and there is no
            way to turn it off. If the check cannot run, the photo is not
            published &mdash; the system fails towards showing nothing.
          </p>
          <p className="muted">
            A confirmed detection is reported to the National Center for Missing
            &amp; Exploited Children as United States law requires, and the file
            and the records around it are preserved for at least 90 days from
            that report, and longer if we are asked to keep them. Deleting your
            account does not delete those records, and cannot.
          </p>
        </section>

        <section className="panel">
          <h2>How long things are kept</h2>
          <ul className="plain muted">
            <li>
              <strong>Photos</strong> &mdash; until they are deleted. Deleting
              removes a photo from everyone&rsquo;s view immediately and it is
              never served again; the file itself is destroyed 30 days later.
              There is no way to undo a deletion, including for us.
            </li>
            <li>
              <strong>Sign-in codes</strong> &mdash; ten minutes, and they work
              once.
            </li>
            <li>
              <strong>Rate-limit counters</strong> &mdash; under an hour, and
              they contain no address.
            </li>
            <li>
              <strong>Events and the records of who was in them</strong> &mdash;
              until the event is deleted.
            </li>
            <li>
              <strong>Child-safety records</strong> &mdash; as described above,
              outside your control and ours.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>What you can do</h2>
          <ul className="plain muted">
            <li>
              <strong>Delete any photo you uploaded</strong>, at any time, without
              asking anyone.
            </li>
            <li>
              <strong>Ask for a photo of you to be taken down</strong>, even if
              you did not upload it and have no account. The request goes to
              whoever created the event; if they have not answered in 48 hours
              the photo is hidden automatically while they decide.
            </li>
            <li>
              <strong>Block someone</strong>, which hides everything they upload
              from your view and stops them joining events you created. They are
              not told.
            </li>
            <li>
              <strong>Delete your account</strong> at <a href="/account">/account</a>,
              or in the app. Two separate things are offered: removing the
              account and the email address, which leaves your photos in other
              people&rsquo;s events where they can still be removed one at a
              time; or removing the account and everything you ever uploaded.
            </li>
            <li>
              <strong>Ask us for a copy of what is held about you</strong>, or ask
              us to correct or delete it, by writing to the address below.
            </li>
          </ul>
          <p className="muted">
            Depending on where you live you may have further rights over this
            data, including to object to how it is used or to complain to a data
            protection regulator. Write to us first and we will try to sort it
            out.
          </p>
        </section>

        <section className="panel">
          <h2>Children</h2>
          <p className="muted">
            Parea is not for people under 13, and not for anyone under the age at
            which they can agree to this on their own where they live. We do not
            knowingly keep anything from a child. If you believe a child has
            uploaded to Parea, write to us and we will remove it.
          </p>
        </section>

        <section className="panel">
          <h2>Changes</h2>
          <p className="muted">
            If this changes in a way that matters, the date at the top changes
            and we will say so in the product rather than only here.
          </p>
        </section>

        <section className="panel">
          <h2>Contact</h2>
          <p className="muted">
            Parea is operated by {LEGAL_ENTITY}. Write to{' '}
            <a href={`mailto:${SAFETY_CONTACT}`}>{SAFETY_CONTACT}</a> about
            anything on this page.
          </p>
        </section>

        <SiteFooter />
      </main>
    </Shell>
  );
}
