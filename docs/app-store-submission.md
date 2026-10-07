# App Store submission — iOS 1.0.0

Everything typed into App Store Connect for the first release, in one place.
Written 2026-10-06 against the code; when the app changes what it collects,
update [`store-privacy-labels.md`](store-privacy-labels.md) first.

## The build

- `eas build --platform ios --profile production` — store distribution,
  build number incremented by EAS, `EXPO_PUBLIC_API_URL=https://www.parea.photos`.
- `eas submit --platform ios --profile production --latest` uploads it to App
  Store Connect / TestFlight. The submit profile names the team
  (`W276447S6T`); once the app record exists, add its numeric **Apple ID** as
  `ascAppId` in `apps/mobile/eas.json` so submits stop asking.
- Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in `app.json`
  (HTTPS only), so there is no encryption question per build.

## The app record (My Apps → +)

| Field | Value |
|---|---|
| Platform | iOS |
| Name | Parea |
| Primary language | English (U.S.) |
| Bundle ID | `photos.parea` |
| SKU | `parea-ios` |
| User access | Full access |

## App information

| Field | Value |
|---|---|
| Subtitle (30) | Everyone's photos, one place |
| Category | Photo & Video (secondary: Social Networking) |
| Content rights | Contains third-party content: **yes** — people upload their own photos; Parea has the rights it needs under `/terms`. |
| Privacy policy URL | `https://www.parea.photos/privacy` |
| Support URL | `https://www.parea.photos/safety` |
| Marketing URL | `https://www.parea.photos` |
| Copyright | 2026 DAED LLC |

## Version 1.0.0 page

**Promotional text (170)**

> Make a roll for anything — a night out, a trip, a wedding — and everyone who was there adds their photos. Everybody gets the full set.

**Description**

> Parea collects the photos from one thing that happened and gives everyone who was there the full set.
>
> Make a roll for an evening, a trip or a gathering and send the link. Everyone adds the photos they took, at full quality, and everyone can see and save all of them — no more asking in the group chat who has the one of you.
>
> • Rolls for anything: public to anyone with the link, or private to the people you let in.
> • Full quality, kept as your camera made them.
> • Location stripped from every photo before anyone else sees it.
> • Groups for the same friends, roll after roll.
> • Moments: one photo for your friends, gone in 24 hours.
> • Save the whole roll to your phone in one go.
>
> No ads. No tracking. Nothing sold.

**Keywords (100)**

`shared album,group photos,event photos,party,wedding,trip,photo sharing,collect photos,roll,friends`

**What's new** — leave empty for 1.0.

**Screenshots** — required: 6.9" (1320 × 2868) or 6.7" (1290 × 2796). Take
them on an iPhone 16 Pro Max / Plus simulator with a populated roll: a roll's
grid, the photo viewer, Home, adding photos, a group. iPad is off
(`supportsTablet: false`), so no iPad set.

## Age rating

Answer the questionnaire truthfully; the relevant yes answers are
**user-generated content** and **messaging/chat**. Accounts are 13+ (a date of
birth is checked at sign-up), so the rating should be **13+** — if the
questionnaire lands lower, raise it to 13+ with the override. A UGC app does
not get to claim 4+.

## App Privacy

Fill in exactly from [`store-privacy-labels.md`](store-privacy-labels.md):
tracking **No**; the linked-to-identity table; crash data not linked.

## App Review information

**Sign-in required: yes.**

| Field | Value |
|---|---|
| User name | `appreview@parea.photos` |
| Password | the `APP_REVIEW_CODE` set on Vercel (6 digits) |

**Notes** (paste, with the code filled in):

> Parea signs people in with a one-time code sent by email; there are no passwords. For review we have set up a dedicated account that accepts a fixed code:
>
> 1. Open the app and tap Sign in (or Create account — a new account asks for a name and a date of birth; any date making you 13 or older works).
> 2. Enter appreview@parea.photos and tap Send me a code.
> 3. Enter the code CODE_HERE.
>
> To see the app with content: create a roll with the + button, add a few photos from the library, and open the roll — the share button gives the link others use to join and add theirs.
>
> User-generated content safeguards (Guideline 1.2): every photo can be reported from its ⋯ menu, and its author blocked from the same menu; anyone can also be reported or blocked from the ⋯ on their profile. Reports are reviewed by a person; child-safety reports hide the photo immediately. Every image is checked against known child sexual abuse material (Microsoft PhotoDNA) before anyone can see it. Terms with zero tolerance for objectionable content and abusive users: https://www.parea.photos/terms. Contact: safety@parea.photos.
>
> Account deletion: Profile tab → Settings (top corner) → Delete account.

**Contact information** — your name, phone and email.

## After approval

- Unset `APP_REVIEW_CODE` on Vercel and redeploy; the review account then
  signs in only by emailed code like everyone else. Set it again before the
  next review.
- Tick the App Store items in [`launch.md`](launch.md).
