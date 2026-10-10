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

import { LEGAL_ENTITY, LEGAL_UPDATED, SAFETY_CONTACT, hashMatchingLive } from '@/legal';
import { SiteFooter } from '@/../app/components/SiteFooter';
import { Shell } from '@/../app/components/Shell';

export const metadata = {
  title: 'Privacy',
  description: 'What Parea collects, what it does not, and how to get rid of it.',
  alternates: { canonical: '/privacy' },
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
            There is no advertising, no tracking and no third-party analytics,
            and nothing is sold or shared for anyone else&rsquo;s purposes.
            Everything on Parea needs an account, looking at a roll you were
            sent included. An account holds
            your email address, a handle, and whatever name and picture you
            choose to add.
          </p>
          {/*
            The carriers' standard sentences, verbatim and at the top.

            They were already further down, in our own words and split across
            two paragraphs — and a second A2P 10DLC review still came back
            "a compliant privacy policy can not be verified". Reviewers read a
            long policy for these exact lines, so they are here word for word,
            where the page starts, with a link to the full section.
          */}
          <p className="muted">
            <strong>Text messages (SMS):</strong> No mobile information will be
            shared with third parties/affiliates for marketing/promotional
            purposes. All the above categories exclude text messaging originator
            opt-in data and consent; this information will not be shared with
            any third parties. <a href="#sms">More about text messages</a>.
          </p>
        </section>

        <section className="panel">
          <h2>What is collected</h2>

          <h3>Photos and videos you upload</h3>
          <p className="muted">
            Kept at full quality, exactly as your camera produced them. Before
            any of them is shown to anyone, everything in the file that says
            where it was taken is removed &mdash; GPS coordinates, and the place
            names some apps add, such as a city &mdash; along with the names of
            people an app recognised in it, the camera&rsquo;s serial number, the
            owner&rsquo;s name if the camera recorded one, and any small preview
            copy embedded in the file. The image itself is untouched, and this
            is checked before a photo is shown: if anything that should have
            gone is still there, the photo is not published. The date, the
            camera model and the orientation are kept, because the date is what
            puts the evening in order. The smaller copies shown on screen carry
            no metadata at all.
          </p>
          <p className="muted">
            Between the moment you upload and the moment that processing
            finishes, the untouched original is in storage. Nothing serves it or
            lists it during that window, but it is honest to say that it exists.
            An upload that is never finished is removed after a day, and one
            that fails processing after a week; neither is shown to anyone in
            the meantime. A moment you start and never post is removed after a
            day as well.
          </p>

          <h3>Moments you share</h3>
          <p className="muted">
            A moment is one photo you share on its own, outside any roll. It is
            stored as a fresh copy made from the picture&rsquo;s pixels, so
            nothing else in the file &mdash; location, camera, the original
            &mdash; is kept. It is shown to your friends and nobody else, for 24
            hours &mdash; not to people you share a roll or a group with unless
            they are also your friends. After that it
            is no longer shown to anybody, and within about an hour more the
            photo and its record are deleted. You can remove it sooner at any
            time.
          </p>
          <p className="muted">
            Comments and likes left on a moment are kept with it, seen by
            the same people, and deleted when it is. You can delete your own
            comments whenever you like.
          </p>
          <p className="muted">
            Which moments you have opened is recorded too, so the ones you have
            not seen yet come first. Nobody else sees it &mdash; not the person
            who shared the moment, and not as a count.
          </p>

          <h3>An identifier for your device</h3>
          <p className="muted">
            A random identifier in a cookie, or in the app&rsquo;s keychain. It
            is what makes your photos yours to delete.
          </p>
          <p className="muted">
            It is created when you open a link somebody sent you, and a row
            records that you are in that roll. That row is what lets the person
            who made it stop new people joining later without turning out
            everyone already there &mdash; the switch cannot mean anything
            without knowing who was already in. Visiting the site without
            opening a roll creates no record of you.
          </p>

          <h3>An email address, only if you ask for an account</h3>
          <p className="muted">
            An account makes a new phone still you, and it is what lets you
            take part: adding photos, writing and reacting, asking for a photo
            to be taken down, and making rolls and groups all need one. Looking
            at a roll you were sent does not. Sign-in is a one-time code &mdash;
            there is no password, because a password would be the most sensitive
            thing here, protecting the least.
          </p>

          <h3>That you passed the age check, when you make an account</h3>
          <p className="muted">
            The first time an address makes an account, we ask for a date of
            birth to check the person is old enough to have one. The date is
            used to decide and then dropped &mdash; what the account keeps is
            only that the check was passed, and when, which is also when the
            terms were agreed to. If the answer is no, no account is made.
          </p>

          <h3>A record of where you are signed in</h3>
          <p className="muted">
            One row for each browser or app holding your account, so that you
            can see them and sign one out from another. It records what kind of
            thing it is &mdash; Safari on an iPhone, the app on Android &mdash;
            and when it was last used. Not your IP address, and not the full
            browser string: the list exists so you can recognise your own
            devices, and two words do that.
          </p>
          <p className="muted">
            Signing a device out from that screen takes effect on its next
            request. It does not take back a roll link that device already
            opened; rotating the roll&rsquo;s link is what ends that, and the
            person who made the roll can do it.
          </p>

          <h3>A passkey, if you add one</h3>
          <p className="muted">
            A passkey lets your device sign you in with Face ID, Touch ID or its
            screen lock instead of a code. What is kept here is the{' '}
            <em>public</em> half of it, which can verify that your device signed
            something and cannot be used to sign anything &mdash; the private
            half never leaves your device, and we never see it. Alongside it: a
            label so you can tell one from another, and when it was last used.
          </p>
          <p className="muted">
            While a passkey sign-in is happening, a random one-time challenge is
            stored for five minutes so that the answer can be checked against
            it, and is then spent. Adding a passkey is optional, removing them
            all is allowed, and a code to your inbox always works.
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
            Your name or handle is shown to other people wherever you take part:
            beside photographs you add, which are grouped by who took them so
            that a set of two hundred from six people can be read at all; on
            what you write and react with; in the groups you are in; to your
            friends; and to somebody deciding whether to let you into their
            private roll, because that is the decision they are being asked to
            make.
          </p>
          <p className="muted">
            Opening a roll also puts you on its list of people, which everyone
            who can see the roll can see &mdash; your name or handle if you have
            one, and otherwise nothing that identifies you. Leaving the roll
            takes you off it.
          </p>

          <h3>A line about you, if you write one</h3>
          <p className="muted">
            Optional, free text, and shown on your profile to anybody who can
            see it. Nothing verifies it and nothing is done with it &mdash; it
            is there because a name and a handle tell somebody almost nothing
            about who just added forty photographs to their evening.
          </p>

          <h3>A link, if you add one</h3>
          <p className="muted">
            One web address, optional, shown under your name on your profile to
            anybody who can see it. Nothing verifies where it goes and nothing
            follows it &mdash; it is stored as you typed it, with{' '}
            <code>https</code> added if you left it off, and refused if it is
            not a web address. Clearing the field removes it.
          </p>

          <h3>The names of the rolls you make</h3>
          <p className="muted">
            Your profile lists the rolls you made, and anybody signed in can
            see that list. A public one is listed the way it would be anywhere
            &mdash; its cover, and how many photographs are in it. A private one
            is listed by name only: no cover, no count, nobody who is in it, and
            nothing about when it happened beyond its own date. What that gets
            somebody is a button that asks you to let them in, which you answer.
          </p>
          <p className="muted">
            This is how a private roll is asked about by somebody you did not
            send a link to, and it is the reason the name is there at all. If a
            name is itself the private part, the name is the thing to change.
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
            Only in the app, only after you allow it, and only used for the
            fourteen notifications this product sends: one reminder about a roll
            you joined and have not added anything to, a new roll in a group
            you are in, the host&rsquo;s answer when you have asked for a photo
            of you to be taken down, that somebody is asking to come into a private
            roll you made, that somebody wants to be friends, that somebody
            has asked you into a roll, that somebody has asked you into a
            group, that somebody has put you in a group they made, that somebody
            has commented on a photograph you added, that somebody has
            commented on or liked a moment you shared, that you now run
            a roll or a group &mdash; because somebody handed it to you, or
            because whoever ran it left &mdash; and that somebody has said
            you are in a photograph. The last of those is the only one that
            tells you about a claim somebody else has made about you, which is
            why it is sent rather than left to be found.
          </p>

          <h3>Eight facts about how the product is used</h3>
          <p className="muted">
            A closed list, recorded in our own database, never sent anywhere:
            that someone opened a roll&rsquo;s link, that they joined it or
            were turned away and for which reason, that an archive was
            downloaded, that photos were saved from the app to a phone, that a
            photo suggestion was shown, how much of a suggestion was kept, and
            that the plain picker was used instead. A download or a save notes
            which set it was &mdash; the whole roll, your favorites, one photo
            or another choice &mdash; and how many photos, never which ones.
            They answer whether anyone other than the person who made the roll
            adds photos, and whether people leave with them; nothing else is
            collected &ldquo;in case it is useful later&rdquo;.
          </p>

          <h3>How many people use it</h3>
          <p className="muted">
            Each day and each month we count how many people used Parea, and
            each week how many of the people who arrived in a given week came
            back. Those are totals with nobody in them. To count you once however many devices
            you use, the only thing kept against you is the last day you were
            counted &mdash; one date, replaced the next day you are here.
          </p>

          <h3>Who you are friends with</h3>
          <p className="muted">
            That you asked somebody to be your friend, what they said, and who
            is on your list. Being friends does three things: either of you can
            put the other into a roll directly instead of sending a link; either
            can add the other to a group or a chat, where anybody else would be
            sent an invitation to accept first; and you see each
            other&rsquo;s moments.
          </p>
          <p className="muted">
            Your handle can be searched for &mdash; by the whole of it or the
            start of it, by anybody signed in. That is a change from how this
            worked before, when nobody could be found at all. What a search
            returns is a handle and whatever name you chose to show: never your
            email address, never your rolls, never your photos, and never who
            else you know. There is no public directory. The Find Friends page
            does suggest people, drawn only from rolls you have both been in,
            groups you are both in and friends you have in common, and it shows
            each person the same way a search would. If you take somebody off
            your suggestions, we keep that you did, so they are not suggested
            to you again. They are not told.
          </p>

          <h3>What you did here</h3>
          <p className="muted">
            The product keeps a record of the things you do that involve other
            people, because most of them cannot work without one. Which rolls
            and groups you are in. That you made a roll. That you asked to
            join a private roll or a group, what was decided, and by whom. That
            you asked to be one of the people who can add photographs to a
            roll you are already in, what was decided, and by whom &mdash;
            kept for the same reason the one above it is, so that asking twice
            is not two questions and a no stays a no. That
            you asked for a photo of you to be taken down, along with whatever
            you wrote in the note. That you reported something &mdash; a photo, a
            moment, a comment, a message, a profile or a group &mdash; with
            whatever you wrote and whose it was; and that you were reported,
            which is how a report reaches the person who reviews it, along with
            what they decided and who they were. That your account was suspended,
            why, by whom, and when it was lifted &mdash; kept so a suspension
            holds when you sign in somewhere new, and so it can be reviewed. That a
            group&rsquo;s admin took you out of it, and who did &mdash; kept so
            that being removed is not undone by rejoining. That somebody invited you into a roll, or
            into a group, who it was, and whether you accepted &mdash; kept so
            that being asked twice is not two questions, and so a decline stays
            declined. That you blocked somebody &mdash; kept so it
            keeps working, and never shown to them. That an email we sent you
            bounced or was marked as spam &mdash; which kind of email it was,
            the reason our email provider gave, and a coded fingerprint of the
            address rather than the address itself &mdash; kept for 30 days, so
            we notice when mail stops arriving.
          </p>
          <p className="muted">
            None of it is a feed and none of it is shown to anyone it is not
            about: a host sees who is asking to come into their own roll, and
            that is the whole of who can see what.
          </p>

          <h3>What you write in a roll&rsquo;s thread</h3>
          <p className="muted">
            Every roll has a thread, and anything you post in it &mdash;
            including a comment on one photograph &mdash; is kept with that
            roll and shown, under your name, to everybody who can see it. So
            are the likes you leave on other people&rsquo;s messages. It is
            not private, it is not a direct message, and there is no version of
            it that only one person sees.
          </p>
          <p className="muted">
            You can edit or delete anything you wrote. Deleting removes the
            text; the place it was stays in the thread marked as deleted, so
            that the messages either side of it do not appear to be answering
            each other. Somebody you have blocked does not appear in the thread
            you see, and you do not appear in theirs, exactly as your
            photographs are hidden from each other.
          </p>
          <p className="muted">
            You can also like a photograph itself, without saying anything.
            What is kept is that you liked it and which picture it was.
            Everybody who can see the photograph sees the like{' '}
            <em>and who left it</em>: your handle is shown beside it, in the
            same way your name appears on anything you post. Tapping it again
            takes it back and removes the record. Somebody you have blocked
            does not appear in the likes you see, exactly as their messages
            and their photographs do not.
          </p>
          <p className="muted">
            You can keep a photograph, which is a shortlist of a roll that is
            yours alone. What is kept is which picture and that it was you —
            nothing else, and it is shown to nobody. Nobody in the roll is told
            what you kept, no count of it appears anywhere, and the person who
            added the photograph cannot see that you did. It is stored apart
            from likes for that reason rather than as one more kind of
            them. Tapping the star again removes the record.
          </p>
          <p className="muted">
            Whoever added a photograph can tag the people in it. A tag is a
            claim somebody else makes about you, so it works differently from
            everything above: what is kept is which picture, which person, and{' '}
            <em>who said so</em>. Only people already in that roll can be
            tagged — tagging is not a way to point at somebody who cannot see
            the roll — and only the person who added the photograph can add
            one. Being tagged gives you nothing you did not already have: it is
            a label, not access. You can take a tag of yourself off at any time
            without asking the person who added it, and doing so removes the
            record.
          </p>

          <h3>What you write in a group</h3>
          <p className="muted">
            A group has a thread of its own, separate from the threads on the
            rolls inside it, and what you say in a group is kept with that
            group and shown under your name to its members. So are the
            likes you leave on what other members say there. Membership is
            the whole of the rule: there is no link that opens a
            group&rsquo;s conversation, and somebody who can see the
            photographs in one of its rolls cannot read it. Editing, deleting
            and blocking work exactly as they do in a roll&rsquo;s thread.
          </p>

          <h3>How far you have read</h3>
          <p className="muted">
            So that a conversation can tell you something is waiting, we keep
            one line per thread per person: the moment you last read it. Not
            what you read, not how long you looked, and nothing about
            individual messages &mdash; a single time, overwritten each time
            you open the thread again, for each roll and group thread you have
            opened. It is never shown to anybody else: nothing here tells one
            person whether another has read what they wrote.
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
            true, and we would rather say so. Removing your number deletes the
            scrambled form, the two digits and the record that it was checked.
          </p>
          <p className="muted">
            We never upload your contacts. The people the Find Friends page
            suggests come from rolls you have both been in, groups you are both
            in, and friends you have in common &mdash; records this product
            already holds because you and they made them. A number is asked for
            so that people who have yours can reach you, not so that we can
            look through your phone.
          </p>

          <p className="muted">
            In the app, Find Friends can also list your contacts so you can
            invite people who are not here yet &mdash; only if you allow it, in
            the phone&rsquo;s own permission dialog. The list is read and shown
            on your phone and never sent to us. Inviting somebody opens your own
            messages app with a text and your profile link in it; you send it,
            from your number, and we do not see who it went to.
          </p>

          <p className="muted">
            The message itself, and the words you agree to before it is sent, are
            quoted in full on <a href="/texts">the text messages page</a>.
          </p>

          <h3>That your number was checked, and when</h3>
          <p className="muted">
            A number only counts once a code sent to it comes back, so we keep
            the moment that happened. Without it the scrambled number would be
            a claim nobody had tested &mdash; anybody could type your digits and
            be found as you, and you would never know. The time is the whole of
            it: not the code, not how many tries it took, not the message.
          </p>
          <p className="muted">
            While a code is outstanding there is one more row, for up to ten
            minutes: the scrambled number, its last two digits, a scrambled
            form of the code, when it expires and how many wrong tries it has
            had. Never the number, and never the code. It is deleted when the
            code is used, and swept away shortly after it expires whether or
            not it ever was.
          </p>

          <h3>Whether people who have your number or address may find you</h3>
          <p className="muted">
            One setting, stored as yes or no: <em>let people who have my phone
            number or email find me on Parea</em>. It is turned on when you
            first confirm a number, because that is what adding a number is
            for, and you can turn it off in your account settings at any time.
          </p>
          <p className="muted">
            Turned off, neither your number nor your address will match a
            lookup, so neither can be used to put your account in front of
            anybody. Your handle still can &mdash; a handle is a name you chose
            in order to be findable, and this setting is about the two things
            you gave us to be reached at instead. Nobody is ever shown your
            number or your email address either way.
          </p>

          {/*
            Worded for the mobile networks' reviewers as well as for people.
            A carrier registration (A2P 10DLC) was refused with "a compliant
            privacy policy can not be verified" while this section already
            said everything required in its own words: reviewers check for
            the standard sentences, a heading that says SMS, and no word like
            "exception" next to where a number goes. All three are here.
          */}
          <h3 id="sms">Text messages (SMS) and your phone number</h3>
          <p className="muted">
            Parea, operated by {LEGAL_ENTITY}, sends one kind of text message: a
            one-time verification code, sent only when you ask for one, to a
            number you typed in yourself. Message frequency: one message per
            request, and none unless you ask. Message and data rates may apply.
            Reply STOP to stop texts to that number, or
            HELP for help. Everything about these messages is set out on{' '}
            <a href="/texts">the text messages page</a>.
          </p>
          <p className="muted">
            No mobile information will be shared with third parties or
            affiliates for marketing or promotional purposes. Text messaging
            originator opt-in data and consent will not be shared with any third
            parties. We do not share, sell, or provide your mobile phone number
            or messaging consent data to third parties or affiliates for
            marketing or promotional purposes. Your phone number, and the record
            that you asked to be sent a code, are never sold or rented, to anybody, and are never used to
            send you anything other than the code you asked for.
          </p>
          <p className="muted">
            To deliver the code, the number is passed to the company that sends
            the text on our behalf, named below. It acts on our instructions and
            for that purpose only, and it is not sharing in the sense above. That
            is the whole of where a number goes.
          </p>

          <h3>Notifications you have hidden</h3>
          <p className="muted">
            The Activity page is worked out when you open it, from things that
            already happened &mdash; a reaction, a mention, a roll you were
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
            <li>
              No contacts, no address book, no social graph import. The app can
              show your contacts on your phone, for inviting; none of it is sent
              to us.
            </li>
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
              <strong>Cloudflare</strong> &mdash; stores the photos and the
              encrypted daily backup of the database, and serves images and
              downloads. The backup is encrypted before it reaches Cloudflare,
              which cannot read it.
            </li>
            <li>
              <strong>Neon</strong> &mdash; the database: rolls, who is in them,
              and the records described above.
            </li>
            <li>
              <strong>Microsoft</strong> &mdash; PhotoDNA, which checks every
              uploaded image against known child sexual abuse material. For
              photos added to a roll it receives a fingerprint made here,
              which cannot be turned back into the picture; for profile
              pictures, covers, group photos and moments it still receives
              the image itself, until those move to fingerprints too.
            </li>
            <li>
              <strong>Vercel</strong> &mdash; runs the website and the API.
            </li>
            <li>
              <strong>Fly.io</strong> &mdash; runs the processing that strips
              location and makes the smaller copies, and the scheduled jobs,
              which include making the daily backup.
            </li>
            <li>
              <strong>Resend</strong> &mdash; sends sign-in codes. It sees the
              address the code goes to, and stops sending to an address that
              bounces or marks its mail as spam.
            </li>
            <li>
              <strong>Twilio</strong> &mdash; sends the code that confirms a
              phone number. It sees the number the code goes to, on the
              occasions you ask us to send one.
            </li>
            <li>
              <strong>Expo</strong> &mdash; delivers push notifications to the
              app, via Apple and Google, and delivers updates to the app itself.
              A notification carries what it is about &mdash; a name, the start
              of a comment &mdash; so Expo, Apple and Google handle that text on
              its way to your phone.
            </li>
            <li>
              <strong>Sentry</strong> &mdash; receives reports of errors on our
              servers, and crash reports from the phone app, so we can fix them.
              They are scrubbed before they leave &mdash; on the phone, for the
              app&rsquo;s: no roll links, no email addresses, no phone numbers,
              and nothing that says who you are. Nothing from your browser is
              sent to it.
            </li>
            <li>
              <strong>Upstash</strong> &mdash; queues photographs for processing.
              It sees an identifier for each photo and nothing else.
            </li>
            <li>
              <strong>A child-safety scanning provider</strong> &mdash; see below.
            </li>
          </ul>
          <p className="muted">
            Each of these acts for us and only for the purpose given. None of it
            is sharing for marketing: all of the above exclude text messaging
            originator opt-in data and consent, which will not be shared with
            any third parties.
          </p>
          <p className="muted">
            Our database and website run in the United States, and photographs
            are processed in the United Kingdom, so using Parea means your data
            is stored and handled in both.
          </p>
        </section>

        <section className="panel">
          <h2>Child safety scanning</h2>
          {hashMatchingLive() ? (
            <p className="muted">
              Every uploaded image &mdash; photos, moments, profile and group
              pictures, and covers &mdash; is checked against known child sexual
              abuse material before it is shown to anyone. This is not optional
              and there is no way to turn it off. If the check cannot run, the
              image is not published &mdash; the system fails towards showing
              nothing.
            </p>
          ) : (
            <p className="muted">
              Automatic matching against known child sexual abuse material is
              not running yet. Parea is waiting to be approved by a matching
              provider, and until then images are published without that check.
              Anyone can report a photo, and a report of child abuse hides it
              from everyone immediately while a person reviews it. When
              matching is switched on, it will cover every image &mdash; photos,
              moments, profile and group pictures, and covers &mdash; before
              anyone sees it, and this page will say so.
            </p>
          )}
          <p className="muted">
            A confirmed detection is reported to the National Center for Missing
            &amp; Exploited Children as United States law requires, and the file
            and the records around it are preserved for at least a year from
            that report, and longer if we are asked to keep them. Deleting your
            account does not delete those records, and cannot.
          </p>
        </section>

        <section className="panel">
          <h2>Why we are allowed to use it</h2>
          <p className="muted">
            Privacy law in the UK and the EU asks that every use of personal
            data has a reason it recognises. Ours are:
          </p>
          <ul className="plain muted">
            <li>
              <strong>To provide the service you asked for</strong> &mdash;
              storing and showing your photos, your account, your messages and
              the rest of what is described above.
            </li>
            <li>
              <strong>Our legitimate interest in keeping it safe and
              working</strong> &mdash; rate limits, error reports, the five usage
              facts, and handling reports and blocks.
            </li>
            <li>
              <strong>Your consent</strong> &mdash; notifications, your phone
              number and whether it can be used to find you, and access to your
              photo library. Each can be withdrawn at any time, in the app or in
              your phone&rsquo;s settings.
            </li>
            <li>
              <strong>Legal obligation</strong> &mdash; keeping and reporting
              child-safety records.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>How long things are kept</h2>
          <ul className="plain muted">
            <li>
              <strong>Photos</strong> &mdash; until they are deleted. Deleting
              removes a photo from everyone&rsquo;s view immediately and it is
              never served again; the file itself is destroyed 30 days later.
              You cannot undo it and we do not restore deleted photos. Our
              database keeps one day of history for recovering from faults. A
              copy taken just before each update to its structure, and an
              encrypted daily backup stored apart from the database, are each
              kept for at most a week; after that the record is gone too.
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
              <strong>Passkey sign-in challenges</strong> &mdash; five minutes,
              and they work once.
            </li>
            <li>
              <strong>Where you are signed in</strong> &mdash; until you sign
              that device out, or it goes unused for longer than the sign-in
              itself lasts. A device you sign out stays on the list, marked, for
              a week, so you can see that it worked.
            </li>
            <li>
              <strong>Passkeys</strong> &mdash; until you remove one, or delete
              your account, which removes all of them.
            </li>
            <li>
              <strong>Rolls</strong> &mdash; until the roll is deleted, which
              deletes its photographs as above. The roll&rsquo;s name and the
              record of who was in it are kept after that.
            </li>
            <li>
              <strong>Moments</strong> &mdash; 24 hours, and deleted about an
              hour after that.
            </li>
            <li>
              <strong>What you write, react with, and your profile</strong>
              &mdash; until you delete it, or delete your account.
            </li>
            <li>
              <strong>The five usage facts</strong> &mdash; one year.
            </li>
            <li>
              <strong>Reports, and the record of what was hidden or removed and
              by whom</strong> &mdash; kept, because they may be needed long
              after, including by law.
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
              you did not upload it. It needs an account, so that the request is
              somebody&rsquo;s and cannot be sent by the hundred. The request goes to
              whoever created the roll; if they have not answered in 48 hours
              the photo is hidden automatically while they decide.
            </li>
            <li>
              <strong>Block someone</strong>, which hides the two of you from
              each other &mdash; photos, messages, comments, reactions and
              moments, even in rolls and groups you share &mdash; and each of
              you stops seeing the rolls the other made. They are not told, and
              the Blocked list in your settings undoes it.
            </li>
            <li>
              <strong>Delete your account</strong> at <a href="/account">/account</a>,
              or in the app. Either way your email address, name, handle,
              picture, bio, link and phone number are removed; so are your
              friendships, your place in every group, your messages and
              comments, your reactions, your tags, your moments and your
              history in the app, and every device you were signed in on is
              signed out and stops getting notifications. Then you choose what
              happens to your photos: left in other people&rsquo;s rolls, with
              no name on them, where they can still be removed one at a time;
              or removed as well. The rolls and groups you made stay, because
              they belong to everyone in them, and each passes to whoever in it
              has added the most photos. Safety and moderation records stay
              too, because they may have to be kept by law. We also note that an
              account was closed, with the date it was opened and the date it
              closed and nothing that says whose, so we can count how many
              people leave.
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
            which they can agree to this on their own where they live. When an
            account is made we ask the year you were born — and the month or day
            only if the year alone cannot tell — and nobody under 13 can make
            one; the answer itself is not kept. We do not knowingly keep
            anything from a child. If you believe a child has uploaded to Parea,
            write to us and we will remove it.
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
