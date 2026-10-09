# Store privacy answers

What to enter in App Store Connect (App Privacy) and the Play Console (Data
safety). The iOS privacy manifest in `apps/mobile/app.json`
(`ios.privacyManifests`) says the same thing and is what a build ships; the
store forms are filled in by hand and have to be kept in step with it. Check
this list whenever the app starts sending something new to the server.

Last checked against the code: 2026-10-01.

## Tracking

None. No advertising identifier, no third-party analytics or tracking SDK, no
data shared with data brokers. The one third-party SDK in the app is Sentry's,
for crash reports, which are not linked to anybody and not used for tracking. Answer **No** to "Do you or your third-party
partners use data for tracking".

## Data collected

Everything below is **linked to the person** (it is stored against their
account or their guest identity) and **not used for tracking**.

| Data (Apple category) | Play category | Why | Notes |
|---|---|---|---|
| Email address | Personal info → Email address | App functionality, account management | Sign-in codes; the account's address. |
| Phone number | Personal info → Phone number | App functionality | Optional, to be found by friends. Stored as a keyed hash plus the last two digits. |
| Name | Personal info → Name | App functionality | Display name and handle, as the person types them. |
| User ID | Personal info → User IDs | App functionality | The account and guest identifiers. |
| Device ID | Device or other IDs | App functionality | The push notification token. |
| Photos or videos | Photos and videos | App functionality | What people upload. |
| Precise location | Location → Precise location | App functionality | Only what is already inside an uploaded photo's metadata, and only until ingest: the deriver strips it from the original itself, stores only the stripped copy and deletes the upload (`services/deriver/src/pipeline.ts`). Nothing anyone sees, and nothing kept, carries it. The app never reads the device's location. |
| Other user content | Messages → Other in-app messages; App activity → Other user-generated content | App functionality | Messages, comments, captions, reactions, reports. |
| Product interaction | App activity → App interactions | Analytics | First-party only (`observation` table): a handful of events such as a download starting or a link being opened. No third party. |

One more is **not linked to the person** and **not used for tracking**:

| Data (Apple category) | Play category | Why | Notes |
|---|---|---|---|
| Crash data | App info and performance → Crash logs | App functionality | Sent to Sentry when the app crashes or hits an error nothing caught: what failed and where. No user, no device name, no IP, no screenshots; album links, emails and phone numbers are scrubbed on the phone first (`apps/mobile/src/scrub.ts`). Off in any build without `EXPO_PUBLIC_SENTRY_DSN`. |

Not collected: contacts, address book (Find Friends reads them to list them
for inviting, on the device only — Apple counts that as not collected), browsing history, search history,
health, financial info, audio, performance diagnostics, advertising data. The year of birth (and
the month or day only when the year cannot settle it) is asked once at account
creation to check age and is not stored.

## Play Data safety, the yes/no questions

- Is all user data encrypted in transit? **Yes** (HTTPS only; HSTS on the site).
- Do you provide a way for users to request that their data be deleted?
  **Yes** — in the app (Profile → Delete account) and on the web at
  `/account`; the Data deletion URL is `https://parea.photos/account`.
- Is data shared with third parties? **No** for sharing. Processors that act on
  our behalf (Vercel, Neon, Cloudflare, Fly, Upstash, the mail and SMS
  providers) are service providers, which Play does not count as sharing.
- Is collection optional? Photos, name, user ID, device ID, product
  interaction and crash logs are required for the app to work; email is required only to
  sign in; phone number is optional.

## When this changes

Adding a crash reporter, a third-party SDK, reading contacts, or reading the
device location all change these answers. Update `app.json`, this file and both
store forms in the same change, before the build that ships it is submitted.
