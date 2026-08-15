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
            is optional. It holds your email address, a handle, and whatever
            name and picture you choose to add &mdash; and nothing more.
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
            A random identifier in a cookie, or in the app&rsquo;s keychain. It
            is what makes your photos yours to delete.
          </p>
          <p className="muted">
            It is created when you open a link somebody sent you, and a row
            records that you are in that event. That row is what lets the person
            who made it stop new people joining later without turning out
            everyone already there &mdash; the switch cannot mean anything
            without knowing who was already in. Visiting the site without
            opening an event creates no record of you.
          </p>

          <h3>An email address, only if you ask for an account</h3>
          <p className="muted">
            An account does one thing: it makes a new phone still you. It grants
            nothing you did not already have. Sign-in is a one-time code &mdash;
            there is no password, because a password would be the most sensitive
            thing here, protecting the least.
          </p>

          <h3>A display name, if you give one</h3>
          <p className="muted">
            Optional, and free text. Nothing verifies it. Where it is shown is
            described under the handle below, because the two are shown in the
            same places and the name is used wherever you have set one.
          </p>

          <h3>A handle</h3>
          <p className="muted">
            Issued when you sign in rather than asked for &mdash; three words,
            like <em>amber-quiet-lantern</em> &mdash; and yours to change. Your
            email address is never shown with either of them.
          </p>
          <p className="muted">
            Two places show your name or handle to other people. Somebody
            deciding whether to let you into their private event sees it,
            because that is the decision they are being asked to make. And once
            you add photos to an event, everyone who can see that event can see
            that they are yours &mdash; the photographs are grouped by who took
            them, so that a set of two hundred from six people can be read at
            all. Looking at an event does not put you in that list; adding to
            it does.
          </p>

          <h3>A line about you, if you write one</h3>
          <p className="muted">
            Optional, free text, and shown on your profile to anybody who can
            see it. Nothing verifies it and nothing is done with it &mdash; it
            is there because a name and a handle tell somebody almost nothing
            about who just added forty photographs to their evening.
          </p>

          <h3>A profile picture, if you add one</h3>
          <p className="muted">
            Optional, and shown beside your name. It is re-encoded on the way
            in, which removes everything that was not the picture itself: a
            selfie taken at home carries the coordinates of your home, and those
            do not survive. Removing it removes the file.
          </p>

          <h3>A notification token, if you turn notifications on</h3>
          <p className="muted">
            Only in the app, only after you allow it, and only used for the six
            notifications this product sends: one reminder about an event you
            joined and have not added anything to, a new event in a group you
            are in, the host&rsquo;s answer when you have asked for a photo of
            you to be taken down, that somebody is asking to come into a private
            event you made, that somebody wants to be friends, and that somebody
            has asked you into an event.
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

          <h3>Who you are friends with</h3>
          <p className="muted">
            That you asked somebody to be your friend, what they said, and who
            is on your list. Friends exist so that somebody can put you into an
            event directly instead of sending you a link, and that is the whole
            of what being one does.
          </p>
          <p className="muted">
            Your handle can be searched for &mdash; by the whole of it or the
            start of it, by anybody signed in. That is a change from how this
            worked before, when nobody could be found at all. What a search
            returns is a handle and whatever name you chose to show: never your
            email address, never your events, never your photos, and never who
            else you know. Nobody is listed, there are no suggestions, and
            somebody has to be told your handle before they can look you up.
          </p>

          <h3>What you did here</h3>
          <p className="muted">
            The product keeps a record of the things you do that involve other
            people, because most of them cannot work without one. Which events
            and groups you are in. That you made an event. That you asked to
            join a private event or a group, what was decided, and by whom. That
            you asked for a photo of you to be taken down, along with whatever
            you wrote in the note. That somebody invited you into an event,
            who it was, and whether you accepted &mdash; kept so that being
            asked twice is not two questions, and so a decline stays declined. That you blocked somebody &mdash; kept so it
            keeps working, and never shown to them.
          </p>
          <p className="muted">
            None of it is a feed and none of it is shown to anyone it is not
            about: a host sees who is asking to come into their own event, and
            that is the whole of who can see what.
          </p>

          <h3>What you write in an event&rsquo;s thread</h3>
          <p className="muted">
            Every event has a thread, and anything you post in it &mdash;
            including a comment on one photograph &mdash; is kept with that
            event and shown, under your name, to everybody who can see it. So
            are the reactions you leave on other people&rsquo;s messages. It is
            not private, it is not a direct message, and there is no version of
            it that only one person sees.
          </p>
          <p className="muted">
            You can edit or delete anything you wrote. Deleting removes the
            text; the place it was stays in the thread marked as deleted, so
            that the messages either side of it do not appear to be answering
            each other. Somebody you have blocked does not appear in the thread
            you see, exactly as their photographs do not.
          </p>

          <h3>Your phone number, if you give one</h3>
          <p className="muted">
            Optional, and it exists for one thing: somebody who already has
            your number being able to find you here. The number itself is not
            kept. What is stored is a scrambled form of it &mdash; a keyed hash,
            which cannot be turned back into the digits without a key that
            lives outside the database &mdash; and the last two digits, so that
            your own profile can show you which number you gave. It is never
            displayed to anybody else and never appears on your profile.
          </p>
          <p className="muted">
            To match a number, it has to reach our server: it travels in the
            request, is scrambled here, and is not written down. &ldquo;Never
            stored&rdquo; is the promise; &ldquo;never sent&rdquo; would not be
            true, and we would rather say so. Removing your number deletes both
            the scrambled form and the two digits.
          </p>

          <h3>Notifications you have hidden</h3>
          <p className="muted">
            The Activity page is worked out when you open it, from things that
            already happened &mdash; a reaction, a mention, an album you were
            let into. Nothing is stored to make that list. When you hide a line
            from it, what is kept is the identifier of that line and nothing
            else, so it can be left out next time. It is not a record of what
            you have read, and there is no list anywhere of what you dismissed.
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
