# Parea — native client

Design §7. React Native via Expo, iOS and Android, sharing every endpoint with
the web client — "two clients, one protocol".

```
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 npm start
```

`API_BASE` falls back to `http://localhost:3000`, which resolves from the iOS
simulator; the LAN address above is for a real device, which cannot see your
laptop's loopback.

## Running it on a simulator or a phone

`ios/` and `android/` are **generated, not written** — Continuous Native
Generation, so `app.json` is the single source of the bundle id, the
entitlements, the permission strings and the privacy manifest. Both are
gitignored, and a change made in Xcode rather than in `app.json` is a change
the next prebuild silently reverts.

```
brew install cocoapods            # system Ruby is too old for the gem
npx expo prebuild --platform ios  # writes ios/, then runs pod install
npm run ios                       # or open ios/Parea.xcworkspace and ⌘R
```

Two servers, or the app opens on a red screen: `npm start` here for Metro, and
`npm run dev` in `apps/web` for the API. Scheme `Parea`, any simulator. A
device build additionally needs a `DEVELOPMENT_TEAM` chosen under Signing &
Capabilities — prebuild leaves it unset, because it is not in `app.json` and
cannot be.

`npm test` here covers the join path and the API client — the two things that
can run without a device. The upload queue, which is the part worth testing
most, is platform-free by design and lives in `@parea/upload` with its tests;
everything else in `src/` imports Expo at module scope and needs a simulator.

## The chrome

The tab bar floats: one capsule inset from the edges, clear of the home
indicator, with the photographs running underneath it. `BlurView` over
`systemChromeMaterial`, which is the system's own tab-bar material and follows
light and dark without this file asking which it is in.

Two views for the one capsule, and the nesting is load-bearing: iOS clips a
layer's shadow the moment `overflow: 'hidden'` is set, and the blur needs
exactly that to be clipped into a capsule — so the outer view carries the
shadow and the inner one carries the glass.

The four items are **glyphs rather than words**. Four labels across a 365pt
bubble is four pieces of type competing with the photographs running
underneath it, and "Events / Groups / Find / You" is the one row in this
product that is read once and recognised forever after. The drawings are the
web rail's own — `Glyph.tsx` carries `RailIcon.tsx`'s exact path data on the
same 24-unit grid at stroke 2 with round caps, so the app and the site point
at a group with the same picture rather than with two of them. The label
survives as the accessibility name, which is where a word is still worth
having.

There was a second capsule above it, a "have a link or a code?" pill on every
tab. Being sent a link is how most people arrive, so it was never more than
one tap away — and the price was a permanent second bar across the bottom of
every screen for a door most people walk through once. Its screen is now
`Open a link` in the Events header, beside `Start one`, which is where
somebody holding a link they were just sent is already looking. That screen is
still the only way to the QR scanner and the spoken phrase, so it keeps a way
in rather than losing one.

This is the one place a `BlurView` belongs here — see the note on event cards
below for the case where it does not.

## Four tabs

**Events** — the same card the web draws, and it took the same route here. It
was a mosaic of the four most recent photos over a detail strip whose
background was those photos again, mirrored and blurred, under a scrim:
handsome, and it made a wall of evenings look like a wall of listings — four
thumbnails too small to recognise anybody in, inside a panel of chrome.

Now one picture and the people. A tall cover, the faces of whoever was there
overlapping its bottom edge, and two lines under it: the name, whose it is in
both their names, then "6 people · Fri 14 Mar". No border and no panel — the
photograph is the card. The faces overlap deliberately: a row of circles
floating below a picture reads as metadata, and the same row half over it
reads as who was there.

An event with no photographs is a different card rather than this one with the
picture missing — mostly a button, with two filled lenses and a dashed empty
one, the empty one being you. It is the only card in the product whose job is
to get the first photograph out of somebody, so a cover chosen before anybody
contributed does not get to replace it.

The photograph count moved into the accessibility label: "how many
photographs" is a fact somebody navigating by screen reader has no other way
to get, and on screen it was a number competing with the picture.

`ago`, `dateLabel`, `isLive` and `CARD_FACES` come from `@parea/cards`. The
words around them are the app's; what is shared is the part that could ever
disagree, which is the rounding — this file had a second `ago` of its own, and
it is gone.

**Groups** — the rooms you are in, drawn as what is in them. It was a
directory: a letter tile, a name, a line of counts, repeated. A list of rooms
with no photographs in it, on a tab of a product whose whole subject is
photographs.

Each group is its evenings now — three recent covers under its name, how many
more there are on the third one, and the newest event's name in the line
underneath. The **door is still a letter**: the tile beside the name is the
group's lens colour, hashed from its id, because a group has no picture of its
own and giving it one out of an event inside it would put a photograph from a
room on the thing that is merely the way in.

The strip is not that, and the difference is where the pictures come from.
Those covers are read off the actor's own event listing — the albums they can
already open, the same list the Events tab draws — and never off the group or
its detail response. Somebody who was never in one of a group's events, or who
has since been removed from it, has no listing for it and gets a dashed empty
slot where that cover would be. The server is not asked for a group's
photographs and does not answer with any.

The cluster suggestion is one line above a rule rather than a card. It is a
remark about the list above it — "these three were at four of the same
evenings" — and a bordered box with a filled button on it gave that the weight
of a room somebody had already made.

**Find** — one field, scoped by chips, and the policy said once at the foot.

It was a card per kind: "Somebody, by handle", "A group, by name", "Your
events, by place" — three bordered panels, two text fields, and a paragraph of
policy above each one. So a screen whose whole job is a search asked which of
two boxes to type in, and said what could never be searched three times before
anything had been searched for at all. Switching chips re-runs what was typed
against the other namespace rather than clearing it, which is the whole reason
it is one field.

The three scopes are still different in kind. People and Groups reach the
server: group search is the only discovery surface in the product and returns
findable groups by name. There is deliberately no event scope — §3's rule is
that groups can be findable and photos never are, and searching events is
searching photos. Places is the reverse and reaches nothing: it groups events
you are already in by where they were, which is why it can answer before the
two-character floor the other two wait for.

**You** — a profile, laid out the way profiles are laid out: the name, the
handle and one line of numbers, the picture beside them, then the line
somebody wrote about themselves, two buttons, and a grid.

It was a form until recently — a name field in a card, a paragraph explaining
what the field was for, and two lists of events under headings — while
`/api/account/session` had been answering with the picture, the handle and the
bio all along.

The grid is **albums, not photographs**, which is the one place it departs
from the shape it borrows: a square of somebody's photographs is a wall of
images with no way to tell one evening from another, and the unit here is the
evening. Two across rather than three — at 166 points a cover is a photograph
and at 111 it was a swatch — with the name and the date *under* the picture
rather than over it, because a scrim block across the bottom of every tile
makes a shelf read as captioned stock photography.

The three numbers are albums, photographs and friends, and all three are facts
about this person's own shelf — nothing on the page counts anything about
anybody else, and the photograph number is the size of the shelf rather than a
claim about who took what. A number that has not arrived is a dash, because
"0 friends" is a claim. They are **one line of text at the size of the
handle**: three stacked pairs of figure and label, spread across the space
beside the picture, gave a shelf of eleven albums the visual weight of an
analytics panel, and none of the three is a score.

`Edit profile` and `Settings` are two halves of one row, and neither is the
screen's primary action — which is opening an album. `Settings` holds what was
loose at the foot of this scroll: the address this device is signed in as,
signing out, deleting the account, and the safety and reporting link. All of
it used to be under a rule below the grid, which meant the two destructive
verbs in the product were reached by scrolling past somebody's photographs and
the app had no settings entry point anywhere.

Editing sends only the fields that changed, so an empty bio typed by accident
cannot clear a handle, and a refused handle repeats the route's own sentence:
it knows whether the problem is the shape, a reserved word, or somebody else
already having it. A new picture streams from disk through the same uploader a
cover uses, and the endpoint re-encodes it — so a selfie taken at home does
not carry the coordinates of the home.

An event's place is typed by whoever starts it, and never derived. The obvious
source is the photos and it is the one source that must not be used: §7.6
strips GPS at ingest and the deriver *fails* a photo if any survives, so there
is no location in this system to derive from, on purpose. The map opens the
system maps app rather than embedding one — a map view is a native module
nothing here can test, and handing the place to the maps app someone already
uses gets them directions as well as a pin.

Adding people to an album is here now, and it was the half of "private" the
app could not do: you could make one, send the link and wait to be asked, but
you could not ask anybody. `InvitePeople.tsx` is the picker — friends, plus
anybody by handle — used twice, and the two callers do opposite things with
what it holds. The create screen keeps the choice until there is an album to
attach it to, because backing out of that form has to ask nobody. The event
screen — in the `⋯` sheet, since the redesign — sends immediately, because the
album is already there.

Picking somebody asks them. The route writes an `open` invitation and nothing
else, so the copy says asked rather than added: a host who could add people
outright would be writing their guest list into somebody else's account. The
count on screen is the one the server returned, not the number that was sent
— it drops anybody it will not write and refuses to say which, because that
would report whether each of them has blocked you.

Finding people is built and lives on Find's People chip, against
`/api/people`. It was once marked as impossible here, on the grounds that §3
has no accounts to look up — which stopped being true when a handle became
something somebody chooses. What survives of that argument is the bound: a
search returns a handle, a name and a face, and never their events, their
photographs, or who else they know.

## The album, and the conversation in it

Opening an event used to show, in order: a back link, the name, a count, an
Add photos button, a Save all button, a "who can see it" card, a cover row, an
invite card and an offer to start a group. Eight full-width slabs before the
first photograph, on the screen whose entire subject is photographs. And the
messenger that shipped on the web was not reachable from the app at all — the
one feature people could use from a browser and not from the thing they take
to the event.

**The cover is the head.** Full-bleed, 232 points, with the name, the faces of
whoever is in it and "48 photos · Fri 14 Mar" over its bottom scrim. The page
starts underneath it and the grid runs to the bottom edge.

**Who can see it is a padlock, not a paragraph.** Open on a public album,
closed on a private one, in the line somebody reads immediately before handing
the link on — which is the moment the answer matters. It used to be a sentence
three slabs down.

**Everything that was a slab is behind one `⋯`.** Share, save all to the
camera roll, the cover, who can see it, asking people in, starting a group.
Same copy, same calls, same gates — only the presentation moved. The account
prompt moved with them: it was a permanent sign-in card above the grid for
anybody not signed in, which is a form in front of the one thing on the screen
that needs no account, and it opens on pressing `+` now.

**Three panes, one screen.** Photos, Talk and People as a segmented control,
with the unread count on Talk. Client state rather than a route, deliberately:
an event's link must open on its photographs, never on its roster or halfway
down somebody's conversation — and the thread pushed as its own screen would
give the conversation a back button to the album it is already inside.

### The thread

`Thread.tsx` here is the web's `Thread.tsx` with the same rules, because two
implementations of "who may post" is how one of them comes to be wrong:

- Posting is `contribute` **and** an account; everybody who may see the event
  may read. The screen takes `canPost` off the feed rather than inferring it
  from holding a link, which would draw a composer for somebody the server was
  always going to refuse.
- A deleted message leaves a gap saying so. The ones either side of a silently
  removed message appear to be answering each other.
- The mention list offers this event's contributors and nobody else. A picker
  that reaches further is a way to find out who exists by typing letters at
  it, and this is the one text field a link-holder can use.
- `@name` is marked, not resolved. It says what somebody typed; it does not
  assert the person exists and cannot be made to render anything but
  characters that were already going to be shown.
- The empty state is an invitation. "Nothing said yet" describes what you can
  already see.
- Reaching the bottom is what marks it read.

**No new server work.** `GET/POST /api/events/[id]/messages`, `PATCH/DELETE
/api/messages/[id]` and `POST /api/messages/[id]/reactions` are the routes the
web already talks to, and the thread itself arrives folded into the photo feed
— which the event screen already polls. A second poller would be a second
schedule to reason about and twice the requests from a phone in a pocket, so
every write here ends by re-reading the feed rather than keeping a second list
in step with it.

The list is **inverted** rather than scrolled to the end after layout: it
starts on the newest message with no measuring pass, which is the difference
between opening on the conversation and watching it jump once. The vocabulary
goes upside down with it — reaching the bottom is `onStartReached` — and the
behaviour does not.

A message arriving while you are on the photographs drops one line in over the
cover and takes itself away after six seconds. Dismissing it does not mark the
thread read; only reaching the bottom does. The mark is set to whatever was
already there on the first feed, so opening an event cannot announce the whole
history of the conversation as new.

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

Making one is offered from an event's `⋯` sheet, to its host, and only while
the event has no group: "the same people keep doing things together" is
something you notice afterwards, so the flow is roll this event into a group
rather than create an empty one and fill it. The Groups tab offers it too, and
what makes that safe is what sits beside the button — the people this actor
keeps ending up in the same events as, so creating is confirming a set that
already exists rather than inventing one. Nobody who attended is auto-enrolled — conscripting
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

## Sharing, and the contacts row that is not here

After creating, a sheet comes up over the new, empty event rather than a
separate page: the link reaching the group chat is the most important moment
in the product, and the empty event visible behind the sheet is what makes
"an empty event stays empty" a fact rather than a slogan.

The design's contact-avatar row is deliberately absent. `/privacy` says "No
contacts, no address book, no social graph import" in a dated public document,
and reading the address book would need a native dependency, a usage string, a
privacy-manifest entry and a different nutrition label — a decision about what
the app collects, not a styling one. The system share sheet reaches the same
people and tells this app nothing about them. See design §17b.

## Auto-selection

The reason this client exists (design §1). With photo-library access and a
known time window, "Add photos" opens on what it thinks are your photos from
the event, already ticked — one tap instead of scrolling a camera roll.

### Where the window comes from

The create screen does not ask. It reads the last three days, splits them into
runs on a four-hour gap, and offers the recent ones as cards — "Last night · 34
photos · 8:14pm – 1:40am". Tapping one sets the event's window from the real
first and last capture, padded by an hour, and prefills the name.

It used to ask: a radio list of Tonight / Last night / Today / Yesterday. That
put the question to the wrong party. The phone already held the answer and held
it exactly, and §17's worry about a careless answer turns out to be best solved
by not asking. The picker survives as the fallback for the case detection
cannot serve — an event created before it has been photographed — and on the
web, which has no library to read.

Detection changes *which* photos get offered, not how confidently. Everything
below still applies to the run once it is found.

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
camera) is unavailable in Expo Go. `preview` is a release build installable
without a store, and is the app-side half of the private soak in
[`../../docs/deploy.md`](../../docs/deploy.md). `production` is the store
build; EAS owns the build number, because a duplicate one is rejected at
upload after you have already paid for and waited on the build.

`preview` and `production` talk to the same deployment, because there is only
one. It used to name `staging.parea.photos`, which has never existed — a build
against it would have failed at its first request, on a tester's phone, after
a build had been paid for and waited on. Universal links would not have worked
either: the entitlement lists `parea.photos` and nothing else, so a tapped
link on a staging build opens the browser.

That is correct during the soak, where the deployment *is* the thing being
soaked. It stops being correct the day real people are on it, because an
internal build then reaches live data with no separation but the release
channel. Standing up a second environment is a second database, bucket and
pair of Workers; when there is one, `preview`'s URL and the allow-list in
`test/config.test.ts` change together.

Submit credentials are referenced, never written down:

```
eas secret:create --scope project --name APPLE_ID --value you@example.com
eas secret:create --scope project --name ASC_APP_ID --value 1234567890
eas secret:create --scope project --name APPLE_TEAM_ID --value ABCDE12345
eas secret:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY_PATH --value ./play.json
```

Android submits to the `internal` track, not straight to production.

### Still missing before a build is submittable

- **A look at it on a device.** No screen in this client has ever been
  rendered. Everything typechecks and none of it has been seen, so the icon
  under a launcher mask, the layout on a small phone and every permission
  prompt in sequence are all still unobserved. This is the item that needs a
  day, not a command.
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
