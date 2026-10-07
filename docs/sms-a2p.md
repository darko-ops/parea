# Texting a code: where the setup stands, and what is left

A resumable note rather than a design document. `docs/design.md` §3a is why phone
discovery works the way it does; `docs/deploy.md` §4 is how to configure the
transport. This is the state of the actual Twilio account and campaign, the
wording that was accepted or refused and why, and the things still open — so that
coming back to it in three weeks does not mean re-deriving any of it.

**Last touched 26 September 2026.** Update the state table below when you move it.

## State

| Thing | Where it stands |
|---|---|
| Code, both clients | Shipped |
| `SMS_PROVIDER` | Set — `twilio` |
| `SMS_API_KEY` | Set |
| `SMS_API_URL` | Set |
| `PHONE_PEPPER` | Set — a dedicated pepper, not the session-secret fallback |
| `SMS_FROM` | **Not set.** The only missing piece |
| Twilio compliance profile | Submitted under DAED LLC, in review |
| Phone number | Not bought. `+13374694577`, Carencro LA, local, SMS+MMS+Voice, $1.15/mo — instant once the profile clears |
| A2P brand | Submitted |
| A2P campaign | Resubmitted after two rounds of refusals, in review |
| Delivery ever tested | **No.** Nothing has sent a real text yet |

Until `SMS_FROM` is set, `texterFromEnv` returns an `UnconfiguredTexter`, and
`POST /api/account/phone` answers **503 `not_configured`** — the Find Friends page
opens, takes a number, and says "Confirming a number is not set up on this
deployment yet". No other part of the product is affected and no user sees a
change. That is a deliberate fail-closed state, not a broken one.

## Finishing it

1. **Compliance profile clears** → buy the number. Instant.
2. `vercel env add SMS_FROM production --sensitive` → paste `+13374694577`.
   Variable name on the command line, value at the prompt: the prompt does not
   echo, which is the only thing keeping the value out of a shell history.
3. Add the same four vars to `development` as well, so `sms:test` can run locally
   rather than against a deploy.
4. **Verified Caller IDs** in the Twilio console → add your own mobile. A trial
   account may only text verified numbers, and skipping this is error 21608, which
   looks like a credential problem and is not.
5. `npm run sms:test -- +1yourmobile`. This is the whole point of that script: it
   separates *config wrong* from *registration pending*, which nothing else can.
   - 401 / 404 → the credential, or the account SID in `SMS_API_URL`
   - 21606 / 21212 → `SMS_FROM` is not a number this account owns, or not
     SMS-capable
   - accepted **and it arrives** → done
   - accepted **and nothing arrives** → carrier filtering. Config is right; the
     campaign is the only thing left. Nothing in this repository can see that.
6. Redeploy, so the vars reach the running app.
7. Check `/api/health` with the `HEALTH_TOKEN` header — all five present, `missing` empty either way since none
   are required in production.

## The campaign form, answered

Keep these. Two rounds were lost to re-deriving them badly.

| Field | Value |
|---|---|
| Use case | **Two-Factor Authentication** / Account Verification. *Not* Account Notification — see the refusals below |
| Brand legal name | `DAED LLC`, exactly as on the EIN letter. `DAED, LLC` fails vetting |
| Brand alternate name (DBA) | `Parea`. Without this the samples do not match the brand |
| Business email | `safety@parea.photos`. Not a personal address — vetting cross-checks the domain against the website |
| Description | Sends a one-time numeric code by SMS so a user can confirm a phone number they entered themselves. The code confirms the number belongs to them; it is not used to sign in. |
| Privacy policy | `https://www.parea.photos/privacy` |
| Terms | `https://www.parea.photos/terms` |
| Public opt-in link | `https://www.parea.photos/texts` |
| Opt-in keywords | `START,YES,UNSTOP` — Twilio's re-subscribe defaults, which it fills in regardless. The consent description says outright they are not an opt-in path |
| Opt-in message | `Parea: You will receive verification codes again, one per request you make. Not a subscription. Msg & data rates may apply. Reply STOP to opt out. Help: safety@parea.photos` |
| Opt-out message | `Parea: You are unsubscribed and will receive no more messages from this number. Reply START to resubscribe.` |
| Help message | `Parea: Help with your verification code: safety@parea.photos. One message per request. Msg & data rates may apply. Reply STOP to opt out.` |

The three messages above are only true if the Messaging Service sends them:
**Advanced Opt-Out** on `MGfe4456…` must carry the same text, or Twilio sends
its own defaults and the form describes replies nobody receives.
| Content attributes | None of the four. No links, no phone numbers, nothing age-gated or financial in the body |

Use the `www` host in every URL. The bare domain 308-redirects, and some reviewer
tooling counts a redirect as a dead link.

### Samples

Both are the same template, which is the truth: there is one message type. A
second sample describing a message this product does not send would be a mismatch
in the other direction, because carriers compare samples against real traffic.

```
[123456] is your Parea code. It works once and expires in ten minutes. If you did not ask for it, somebody mistyped their number. Nothing to do.
```

```
[480915] is your Parea code. It works once and expires in ten minutes. If you did not ask for it, somebody mistyped their number. Nothing to do.
```

The source of both is `verifyText` in `packages/core/src/sms.ts`. **Do not
paraphrase it into the form, and do not tidy its punctuation** — see the encoding
note below.

### Consent description

```
Opt-in is not by text message. Consumers cannot text a keyword to enrol and no
keyword opt-in is supported. Consent is collected on a web form and in the mobile
app only.

A signed-in user opens the Find Friends screen — at
https://www.parea.photos/find/friends or the equivalent screen in the Parea
iOS/Android app — and types their own mobile number into a field. Beneath it is
a checkbox, unticked by default, beside these words:

"I agree to receive one text message from Parea containing a verification code
each time I tap 'Send me a code'. One message per request, not a subscription.
Message and data rates may apply. See our Terms and Privacy."

The "Send me a code" button is disabled until the box is ticked. Ticking it is
the consent; tapping the button then sends one message. One message is then sent, immediately, to the
number that person typed. No message is ever sent to a number entered by anyone
other than its holder, no message is sent unless requested, and no marketing is
sent.

This call-to-action, the consent wording, and screenshots of the screen (box
unticked, then ticked) are published publicly at https://www.parea.photos/texts
```

## What was refused, and why

Worth keeping, because each one is a trap that looks like a form-filling slip and
is not.

**"Description doesn't match the use case."** The use case was Account
Notification and the description described 2FA. Account Notification means telling
somebody about activity on their account; a one-time code proving possession of a
number is Two-Factor Authentication. The description was right and the dropdown
was wrong.

**"Sample references a brand name we couldn't match."** The registered brand was
`DAED LLC` with no DBA, and the samples say `Parea`. Fixed on the brand record by
setting the alternate business name, **not** by changing the samples: a code
arriving from a company name nobody recognises is the shape that gets reported as
spam, and it would have meant the app identifying itself differently from
everywhere else in the product.

**"We need evidence of how consumers opt in by texting you first."** Downstream of
leaving the opt-in keyword field blank — blank does not mean *no keywords*, it
means Twilio registers START, YES and UNSTOP by default, which declares that text
opt-in is supported. There is no way to say "none". The answer is to state
outright, in the consent description, that opt-in is not by text.

**"Your opt-in doesn't explicitly ask consumers to consent to SMS."** The card
used to read "Tapping this sends you one text from Parea with a code in it" — a
true statement about what a button does, and not consent. The reviewer was right
and the distinction is not pedantry: being *told* a message is coming is not
*agreeing to receive* one. Hence "you agree to receive", with the button named
inside the sentence to tie the agreement to the act.

**"CTA verification issue: no proof shared"** (third round, 7 October). The
screen is behind sign-in and `/texts` only described it in words; the reviewer
wanted "a hosted link to a screenshot showing the clear opt-in flow and checkbox
area". Two fixes: the consent became an unticked checkbox that gates the button,
on both clients, and `/texts` now carries real simulator captures of it
(`apps/web/public/texts/`). Retake those if the screen changes.

**Both of those last two came back a second time** for a dull reason: the form
field still held the old wording. Changing the product does not change what is
already typed into a registration form.

## Two things about the code that are easy to break

**Every character of `verifyText` is GSM-7, deliberately.** A text is billed per
segment and the segment size depends on the alphabet the *whole* message has to be
encoded in: GSM-7 gives 160 characters, and one character outside it forces all of
it into UCS-2 where a segment is 70. This message once ended with an em dash —
U+2014, not in GSM-7 — and a 159-character message was going out as **three
segments**, at triple the price of every verification, silently. Twilio accepts it
and bills for three; the route swallows send failures by design so there is no log
line; and the test asserted `length <= 160` and passed throughout, because the
length was never the problem. `apps/web/test/sms.test.ts` now asserts the alphabet
and counts septets. Do not improve the punctuation without reading it.

**`/texts` must stay indexable.** Almost every route here is `noindex`, because
possession of a link is the access model and a crawled album is somebody's evening
in a search index. That page is the exception: it contains nothing about anybody,
and its entire purpose is being readable by a reviewer who has not signed in —
`/find/friends` is behind a sign-in and always will be. A test asserts the page is
in neither `robots.ts` nor the `noindex` roots in `next.config.ts`, so a tidying
sweep fails loudly rather than breaking a campaign months later.

## Still open

**`SMS_FROM`, and one real delivery.** Nothing has sent a text yet. Everything
above is configuration and paperwork.

**Two credentials to revoke.** A Twilio Auth Token and an API key created during
setup on 26 September were pasted into an assistant session transcript while
trying to set the environment variables, so they must be treated as disclosed
regardless of anything else. Replace them in the console; an API key is revocable
in isolation, which is why it is the better credential to send with. The account
SID is an identifier rather than a secret and needs no rotation.

**A number that has replied STOP can never verify, and is told nothing.** Twilio
blocks sends to opted-out numbers with error 21610, and `POST /api/account/phone`
swallows every send failure on purpose — a distinguishable failure would answer
"has somebody been asked about this number?" for anybody with a keypad. So that
person taps the button, reads "We sent a code to the number ending 77", and waits
forever. The fix that leaks nothing is one line in the waiting state, shown to
everybody regardless of whether it applies:

> Didn't get it? If you have ever replied STOP to a text from us, reply START to
> that number and ask again.

Not built. Roughly fifteen minutes, both clients plus a test.

**No HELP or STOP keyword handling.** Nothing answers an inbound text. Twilio
handles STOP itself for a registered campaign — it maintains the opt-out list and
refuses subsequent sends — but **HELP is not answered for you**, and CTIA expects
a reply. The terms point at `safety@parea.photos` instead, which is honest and is
not a text reply. If a campaign field ever demands a help message or an opt-out
keyword, build it rather than claiming it: one route at `POST /api/sms/inbound`,
Twilio signature validation, replies for HELP and START, and the terms updated from
"nothing to unsubscribe from" to "STOP is answered". One wrinkle — signature
validation uses the account **Auth Token**, not the API key used for sending, so it
needs another environment variable.

## Where the pieces are

| | |
|---|---|
| The message | `verifyText`, `packages/core/src/sms.ts` |
| The transport, and the three carriers | `packages/core/src/sms.ts` |
| Sending and verifying | `apps/web/app/api/account/phone/` |
| The recommendations | `recommendationsFor`, `apps/web/src/friends.ts` |
| The screens | `apps/web/app/components/FindFriendsView.tsx`, `apps/mobile/src/FindFriends.tsx` |
| The public disclosure | `apps/web/app/texts/page.tsx` |
| The live check | `npm run sms:test -- +<number>` |
| Tests | `sms.test.ts`, `discovery.test.ts`, `discovery-routes.test.ts`, `find-friends-page.test.ts`, `legal.test.ts` |
