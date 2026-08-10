# Parea — native client

Design §7. React Native via Expo, iOS and Android, sharing every endpoint with
the web client — "two clients, one protocol".

```
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 npm start
```

`npm test` here covers the join path and the API client — the two things that
can run without a device. The upload queue, which is the part worth testing
most, is platform-free by design and lives in `@parea/upload` with its tests;
everything else in `src/` imports Expo at module scope and needs a simulator.

## What native buys

Uploads that survive backgrounding **and app termination**, on iOS. SDK 57's
`UploadTask` takes `sessionType: 'background'` and hands the transfer to
`URLSession`; it is the default, and stated explicitly in `platform.ts` because
the whole "close the app, it keeps going" promise rests on it. **Android has no
equivalent** — uploads survive backgrounding for a while and die when the OS
reclaims the process — so the UI says "keep the app open" there and not on iOS.

A queue that survives a venue with no signal. §1's table promises offline
queueing and the queue used to do the opposite — four attempts spent in a few
hundred milliseconds and two hundred photos marked permanently failed, at the
moment the native client is supposed to be earning its place. An `Offline`
error now costs no attempt and stops the run; the app restarts it when
something has changed, which is coming back to the app or a widening backoff.
No connectivity library: it would make the retry sooner rather than more
correct, and it is a native module nothing here can test.

Tapped notifications go somewhere. §12 allows one reminder per event, ever,
and all three used to arrive and do nothing but bring the app forward. A group
event opens the group rather than the event, because the event is new and this
device holds no link token for it — the group lists its events with theirs.

A queue that survives being killed. State is persisted after every transition,
each file moves through presign → upload → complete independently, and retries
are safe because the server addresses objects by content.

Save-all to the camera roll, which is the terminal action people actually want
and a browser cannot offer. It asks first — full quality or smaller copies —
with the size, because the originals from a 250-photo event are about a
gigabyte and pulling that over cellular onto a phone that may not have room is
not a decision to make for someone. The web asks the equivalent question as
"originals or JPEG" (§7.7); on a phone the honest axis is size, since the
camera roll opens anything a camera made.

It saved the 2560px rendition until recently, and said nothing about it —
which made the native client's terminal action return downscaled copies of
photos the product promises at full quality.

QR scanning and spoken codes, so the at-the-party join moment works without
anyone typing a URL.

Tapped links. `https://parea.photos/e/<token>` opens the app when it is
installed and the web client when it is not — the same URL either way, which is
what lets the link be dropped in a group chat without anyone thinking about it.
Cold start and warm start both route through one join path in `App.tsx`, and
each URL is answered once: `getInitialURL` returns what launched the app and
the listener can fire for the same URL, so handling both means joining twice.

## Groups

The other half of §1's native case. A group is what "the same people keep doing
things together" turns into: one place the events accumulate, so nobody
re-solves *how do I reach everyone* for the fourth dinner running.

On the web a group is reachable only from an event you still have the link to,
which makes it an attribute of a link. Here it is fetched from `GET
/api/groups` and belongs to the **actor**, so a reinstall does not lose it and
a lost link is recoverable. That endpoint is new and shared — the web can use
it too, and does not yet.

The screen turns on **door versus room**. A member sees the events. Everyone
else sees a name and a member count, and only if the group chose to be
findable; a private group answers identically to one that does not exist. The
client shows one message for all three refusals on purpose — distinguishing
them would make the screen a way to confirm a private group is real.

Making one is offered from an event, to its host, and only while the event has
no group: "the same people keep doing things together" is something you notice
afterwards, so the flow is roll this event into a group rather than create an
empty one and fill it. Nobody who attended is auto-enrolled — conscripting
everyone who once opened a link would make membership the opposite of opt-in.

Search is last on the join screen and never above the link box. It is the
backstop for a lost link, not the way in; putting discovery first would suggest
browsing is how this product works.

## Making an event

The app can start one, which until now only the web could. The interesting
field is the window.

`event.starts_at` / `ends_at` have been in the schema since the first migration
and **no client ever set them** — the web create form asks only for a date. So
the window §7.3 says is "captured at creation, because inferring it from
uploads only helps contributor five, not contributor one" has in fact always
been inferred from uploads, and contributor one has always fallen through to
the system picker. This screen is the first place it is asked.

The list lives in `@parea/autoselect`, next to the `resolveWindow` that
consumes it, and the web create form asks the same question from the same
module — two copies would drift on what "Tonight" means and nothing would
notice.

It asks with a short list of phrases rather than a time picker, because §17
records the constraint: *a wrong window is worse than no window*. Someone
creating an event is standing at the thing, and two spinners get a careless
answer; "Tonight" and "Last night" get a considered one. Both run to 4am,
because a night is not a calendar day and photos from 1am belong to the party
that started at 8pm. Nothing is pre-selected — a default here is a guess
wearing the clothes of an answer — and "Not sure yet" is one of the options
rather than something you reach by skipping the question.

The server validates it, since this is the first release where anything sends
one: both ends or neither, and forwards. A half-window resolves against an open
interval, which is every photo on the contributor's device.

Creating is offered below the ways in, not above them. Most people arriving
here were sent a link; putting creation first would make the app look like
something you have to set up. From inside a group, any member can make the next
event — the point of a group is that it does not need the person who made the
last one — and that is the only thing in either client that produces §12's
second notification.

Afterwards the screen becomes the share step: the link, the system share sheet,
and the spoken code. An event is worth nothing until the link reaches the group
chat, and the likeliest moment for that is the second after it is made.

## Auto-selection

The reason this client exists (design §1). With photo-library access and a
known time window, "Add photos" opens on what it thinks are your photos from
the event, already ticked — one tap instead of scrolling a camera roll.

Built to degrade correctly rather than to assume it works, because the geotag
coverage number it depends on **has not been measured** (`tools/geotag-probe`
exists to get it). Confidence decides how much is pre-selected, never whether
the screen appears:

| Signal | What happens |
|---|---|
| Most photos geotagged, tightly clustered | the cluster is pre-selected |
| Under 60% carry GPS | grid appears, **nothing ticked** |
| Geotagged but spread across places | grid appears, **nothing ticked** |
| No usable window | system picker |

Degrading to "here is a useful grid of the right time range, you pick" is a
good outcome. Degrading to forty-seven pre-ticked photos, three of which you
would be mortified to send, is the outcome that kills the feature — it spends
the contributor's trust and the photo-library permission in the same moment.
"Show everything from this window" is always available, which is what makes a
tight default safe rather than annoying.

The measurement therefore decides *which row of that table people mostly land
on*, not whether any of it works. Run the probe before assuming the top row.

The selection logic lives in `@parea/autoselect` and is shared, by fixture,
with the probe — so what the probe measures is what the app will do.

Permission is asked for **after** a first contribution, never in front of one:
the picker path needs no permission at all, and the upgrade is pitched as
"next time we can find them for you".

## Building and submitting

Identifiers are `photos.parea` on both platforms and `parea.photos` for links.
**Both application identifiers are permanent from the first store upload** —
they are asserted in `test/config.test.ts` alongside the two places the domain
has to match, because three of those four can be wrong without anything
failing to build. Deep links just quietly stop opening the app.

```
npm install -g eas-cli && eas login
eas build --profile development --platform ios     # a dev client, not Expo Go
eas build --profile production --platform all
eas submit --profile production --platform ios
```

Three profiles. `development` builds a dev client against `localhost` —
everything native here (background upload, granular photo permissions, the
camera) is unavailable in Expo Go. `preview` is a release build against
staging, installable without a store, and is the app-side half of the private
soak in [`../../docs/deploy.md`](../../docs/deploy.md). `production` is the
store build; EAS owns the build number, because a duplicate one is rejected at
upload after you have already paid for and waited on the build.

Submit credentials are referenced, never written down:

```
eas secret:create --scope project --name APPLE_ID --value you@example.com
eas secret:create --scope project --name ASC_APP_ID --value 1234567890
eas secret:create --scope project --name APPLE_TEAM_ID --value ABCDE12345
eas secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY_PATH --value ./play.json
```

Android submits to the `internal` track, not straight to production.

### Still missing before a build is submittable

- **An icon.** There is no `assets/` directory, so Expo's default is what ships.
  App Store Connect wants 1024×1024 and will not take a placeholder twice.
- **`APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` on the web deployment.**
  Both `.well-known` files are served by the web app now, and both 404 until
  those are set — absent rather than wrong, because Apple caches the AASA hard
  and a file naming the wrong team is a link that stays broken long after
  someone fixes the variable. Android needs *both* certificates: the upload key
  and the one Google re-signs with under Play App Signing. `eas credentials`
  prints them.
- **Nutrition labels**, in App Store Connect rather than in this repository.
  The privacy manifest here declares photos, the push token and the optional
  display name — all unlinked, none for tracking.

  **One question in there is genuinely open and should not be answered by a
  programmer.** Precise location is *not* declared, on the reading that it is
  never stored: it arrives inside the original, and the deriver strips it
  before the photo is served or kept. But the un-stripped original does sit in
  R2 between upload and ingest, which is longer than "servicing the request in
  real time" — so the other reading is defensible too. Declaring it makes the
  label say this app collects precise location, which materially misdescribes
  the product; not declaring it and being wrong is a rejection at best. The
  facts are all here; the call is not a technical one.
- **An age rating and a EULA.** Guideline 1.2 wants terms with explicit zero
  tolerance for objectionable content and abusive users, on top of the
  filtering, reporting, blocking and published contact that exist. And a
  user-generated-content app does not get to claim 4+.

## Notes

Identity is a bearer token in the keychain, the same signed value the web
client keeps in a cookie. On iOS keychain items can outlive an uninstall, which
would silently restore an identity someone thought they discarded; nothing here
depends on it either way.

The event link is held in the keychain and presented per request rather than
exchanged for a scoped capability. That differs from the web, where the point
of the exchange is keeping the token out of the address bar and out of referer
headers — neither of which exists on native.
