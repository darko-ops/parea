# Untitled photo app — concept

Working document. Monetization deliberately left open.

## 1. The problem

You went to a party. Six people took photos. You have almost none of them.

The photos exist. Someone has them. Nothing is lost, corrupted, or technically
inaccessible. The blocker is social:

**Asking is a favor, and nobody wants to ask.**

To get a photo of yourself, you have to ask someone to go into their camera
roll, find the ones with you in them, and send them over. That's a real chore
you're imposing on someone. So most people don't ask. They wait, hope it gets
posted, and quietly let it go.

And on the other side, the person holding the photos isn't withholding them.
They just don't want to do the work either. Sorting, selecting, and AirDropping
to four different people is fifteen minutes of tedium with no reward. So they
post six photos to Instagram — the ones they look good in — and the other 190
stay on the phone forever.

The result is a stalemate where everyone would be happy to share and nobody
does.

### Why the existing options don't resolve it

**Where a group chat exists, it's the real incumbent** — not Google Photos.
Someone says "post the pics" and two people do. The request decays immediately;
anyone not looking at their phone in that moment never sees it, and photos that
do get sent are compressed to mush.

**Often there is no group chat at all.** The people at a party frequently don't
share a single thread — they're friends of friends, plus-ones, people from work.
In that case there's no channel that reaches everyone, and collecting photos
means a dozen separate conversations. This is the harder and more common case.

**Shared albums (Google Photos, iCloud)** solve storage but not the social
friction. Someone has to create it, everyone has to be invited, half the group
is on the wrong platform, and it still requires the same explicit ask — it just
moves the ask to a link.

**Instagram** solves distribution but selects for the wrong photos. It surfaces
what the photographer wanted seen, not what you wanted to have.

**Wedding QR products (GuestPix, POV)** solve exactly this for one event type,
priced for a host who's already spending thousands. Nobody buys one for a
Tuesday birthday.

### The two shapes of the problem

Contribution at any given event is bimodal, and the product has to survive both:

- **Few shooters.** One or two people took most of the photos. Everyone else has
  three. The bottleneck is a single person with 200 images and no low-effort way
  to hand them over.
- **Many shooters.** Fifteen people each took a handful. No single person is the
  bottleneck; the problem is that the photos are scattered across fifteen camera
  rolls and no one is going to collect them.

You don't know which mode you're in until after. So the upload path has to be
effortless for someone dumping 200 photos and for someone contributing four from
a link on cellular.

### What "solved" looks like

Everyone leaves with the photos, and nobody had to ask.

## 2. The idea

**A place to put everyone's photos from one thing that happened.**

Someone creates an event and drops the link in the group chat. Anyone with the
link adds their photos — no account, no app, no setup. Everyone gets the full
collection at full quality.

That's the whole product.

### Non-negotiables

**No account on the upload path.** Not "sign up after you've seen the value." No
account at all to contribute. Optional name field. Every signup wall costs
contributors, and contributors are the entire product.

**The link is transport-agnostic, and joining happens while everyone is
together.** There is no single channel that reliably reaches a group — sometimes
there's a chat, often there isn't, and relaying a link through a dozen
one-to-one texts is the same "asking around" chore the product exists to kill.
The party itself is the only moment when reaching everyone is free, so joining
should happen there: a QR someone holds up, an AirDrop to the room, a code you
can say out loud. Photos land later.

The link then travels anywhere — text, DM, forwarded by an attendee to someone
who missed the scan. Requirement: it must be fully self-explanatory out of
context. Someone receiving it cold, with no explanation, should understand what
it is and what to do in two seconds. The preview should carry the event name,
the contribution count, and the action: *"Sarah's birthday · 88 photos from 6
people · add yours."*

Links are lossy — people lose them, and the code and group search exist so that
losing one isn't terminal. This cost only has to be paid once per group of
people anyway: once a group exists, the next event reaches its members directly.

**Contribution state is visible.** People add photos because they see other
people added photos. "6 people, 88 photos" recruits the seventh contributor in a
way an empty grid never will.

**Originals, not compressed copies.** The thing that makes it better than the
group chat.

**Downloading is a first-class action**, not a menu item. The whole point is
leaving with the photos.

### Explicitly not

No likes, comments, follower counts, or feed. No algorithmic ranking. The app
exists to help you leave with the photos, not to keep you scrolling.

## 3. Scope

### Version one

Four screens:

1. **Create** — name, optional date, get a link
2. **Add photos** — select, upload in the background, close the tab
3. **Browse** — a grid, sorted by time
4. **Download** — one, some, or all

Plus: remove a photo you uploaded, report a photo, delete the event.

**Persistent groups.** An event can roll into a group when the same people keep
doing things together — a house, a friend group, a team. This is the answer to
the distribution problem: once a group exists, the host doesn't re-solve "how do
I reach everyone" for the next event. Creating one notifies the group, and the
photos land in a running archive instead of a series of orphaned links.

Contributing to an event still never requires an account. Group membership is a
durable identity, but it's an opt-in taken *after* someone has already received
photos — the payoff being that they never have to be invited again. The signup
ask sits at the moment of demonstrated value, not in front of the first upload.

Deliberately thin: a name, a member list, and the events under it. No group
profiles, bios, roles, or public pages until something forces them.

### Joining and finding things

Three ways in, in order of primacy:

**Link.** The main path. Works forever, travels anywhere, self-explanatory out
of context.

**Code.** For when a link can't get to someone — the person across the room, the
one who joins late. System-generated word pairs (`amber-fox`), never
user-chosen: chosen names get squatted within a week and drag in trademark
complaints and moderation. Codes stay valid while the event is active and
recycle only after it goes dormant, which keeps them short without cutting off
late arrivals. Wordlist curated and pre-filtered for unfortunate combinations.

**Search.** The backstop for when the link is lost, which happens constantly.
Two kinds:

- *Inside what you've joined* — "find that thing from March." Pure retrieval, no
  exposure. Necessary once anyone has twenty events.
- *For a group by name* — you find the group, see its name and member count, and
  request to join. No photos until you're in.

The governing rule: **groups can be findable, photos never are.** Search returns
a door, not a room. There is no open discovery of events or their contents —
browsable parties are a surveillance surface and a moderation problem that can't
be staffed.

Defaults do the real work. One-off events are unlisted with no decision
required; nobody chose to make their birthday a public entity. Groups get asked
once at creation whether they should be findable — clubs and teams will say yes,
friend groups won't.

### Staying open

Three independent switches, all defaulting open:

- **Can new people join?** Indefinitely. The person who gets photos two weeks
  later is a real user.
- **Is the code valid?** While the event is active; recycles after dormancy.
- **Can people still upload?** Yes. Late photos are the point.

Closing any of them is a host decision — sealing a wedding album, shutting down
after a stranger got the link — not a default the product imposes.

### Cut from version one

- **Profiles, usernames, friend requests, mutual friends.** Stacks a
  social-graph cold start on top of an album cold start. Group and event
  membership already encode every relationship the product needs.
- **Open discovery of events.** Nobody is browsing strangers' parties, and
  letting them is a moderation problem that can't be staffed. Group name search
  is in; event and photo discovery is not.
- **Face matching / "find my photos."** Worth reconsidering later, but a party
  is 200 photos and people will scroll. It's not the reason anyone shows up, and
  it pulls in serious biometric-privacy exposure (Illinois BIPA and its
  Texas/Washington analogues carry statutory damages, and the people in the
  photos never consented) for very little v1 benefit.
- **Comments, DMs, stories, editing, feeds.**

Feature test for anything proposed later: *does this help people contribute,
find, or retrieve shared photos?* If not, it's out.

## 4. Known hard parts

**Web vs. native.** Guests must be able to contribute from a browser —
requiring an install will gut contribution rates. But bulk uploading 200 HEIC
originals through mobile Safari is genuinely difficult: tab suspension, memory
limits on large multi-file selection, no background continuation, format
conversion. Likely resolution is web for casual contributors and native later
for heavy shooters, but that's two clients. Decide it deliberately rather than
discovering it mid-build.

**Egress, not storage.** The core action is bulk downloading originals. A
250-photo event is roughly 1GB; twenty people each pulling the full set is 20GB
per event. Storage is cheap; S3-class egress is what kills photo startups.
Zero-egress object storage (R2, B2) is a precondition, not an optimization.

**Getting people in.** Joining at the event asks the host to do a small piece of
coordination during the party, which is the moment nobody wants to do anything.
And it misses whoever wasn't there for the scan — often the person who most
wants the photos. The forwardable link is the backstop for both, but neither is
fully solved.

**The empty event.** One person creates it, nobody adds anything. Mitigations:
make the creator's own upload part of creation, show contribution counts, and
send one well-timed reminder — not notification spam.

**Unwanted photos.** Anyone can upload anything of anyone. Needs, from day one:
remove your own uploads, request removal of a photo of you, report, and event
deletion. Strip precise location metadata by default.

**Minors.** Any use case centered on children (youth sports, school events)
combines guest uploads from unverified accounts with images of minors. Avoid as
a target market; if it happens organically, private-only and no matching.

## 5. Open questions

**Monetization is undecided.** Marginal costs are low enough to run cheaply for
a while, and no payment moment is committed. Current ranking of directions:

1. **Group subscription** (~$4–8/mo, unlimited events, permanent archive,
   originals). Best fit now that groups are in v1 — a group is a recurring
   entity whose archive genuinely accrues value, unlike a single party. One
   payer covers many free riders, so it never blocks distribution.
2. **Retention window on ungrouped events** (30–60 days, then expire). Less a
   revenue line than the forcing function that makes groups worth paying for. If
   nothing expires, nobody needs a group.
3. **Video as the premium gate.** Photos free, full video paid. Storage and
   egress actually explode on video, and it's the one limit people don't resent
   because everyone intuits video is heavier. Cost and price align, and unlike
   quality-gating photos the difference is visible.
4. **Physical artifacts.** Books at 50–70% margin, and the book of everyone's
   photos is an object Instagram can't make. Needs volume that doesn't exist
   yet, and it's a fulfillment business bolted onto software. Year two or three.
5. **Host-pays-per-event** ($10–20 one-time). Proven by the wedding products but
   transactional with no retention.

Unranked and worth exploring: venue and bar hosting (real budgets, but turns
this into B2B sales); recap export (auto-generated highlight reel, free to
watch, paid to export — cheap to build, no storage implication); tip jars (send
the person who shot the whole party five dollars — captures the "they did work"
impulse without gating access); group cost-splitting (members chip in on one
subscription rather than one person eating it — same money, probably better
conversion).

Current leaning is **1 + 2 with 3 as the upgrade trigger**: casual things are
free and fade, the groups you care about are cheap and permanent.

### Deferred branch: paid galleries

A group charging for access to a collection — races, conferences, photographer
collectives, paid communities. This is a real business with disliked incumbents
(Sportograf, MarathonFoto), and it's structurally different from an individual
paywalling party photos: there's a defined seller, buyers who knew the
arrangement before showing up, and no ambiguity about who is monetizing whom.

Not built now, for three reasons. Apple takes 30% of in-app digital goods, and
gallery access is unambiguously that. Payouts mean Stripe Connect with KYC,
1099-Ks, chargebacks, and marketplace liability — real weight under a product
with no revenue. And it's less a feature than a second company: organizer sales,
support obligations, refund policy, branded pages, analytics, download
restrictions. Building both at once usually kills both, and the paid side wins
the internal fight every time because it's the one with money attached.

**Architectural constraint that follows: don't build it, don't build against
it.** Events own their photos, groups own their events, and access control lives
as a policy layer rather than being hardcoded to "everyone who is in gets
everything." That costs nothing now and makes this a build rather than a
rewrite.

Signal to watch for: organizers arriving unprompted — someone running a race, a
conference, a photographer delivering to clients. If that shows up, it may be
the better business, and the honest move is a deliberate pivot rather than
bolting it onto a consumer app.

Individual users charging for their own uploads stays ruled out regardless. It
reinstates the ask the product exists to remove, and it monetizes photos of
people who never agreed to be sold.

**Does anyone form groups?** The whole model above collapses if usage is
overwhelmingly one-off parties that never recur — at which point this is
per-event pricing and a wedding app with worse positioning.

**Does anyone want permanence?** The half-life of caring about party photos is
about a week. Most retention-based pricing assumes an archival impulse that may
not exist for this use case.

**Party vs. recurring group.** The party case is the emotionally true problem
and the harder business — irregular, no organizer, changing group, nobody pays.
Recurring groups (clubs, teams) retain better and have someone in charge, but
that's a different product with different distribution. Current choice is the
party case; worth revisiting if usage says otherwise.

**Is the behavior actually there?** Untested.

## 6. Next step before writing code

Next party: make a plain shared album, get the link to everyone there by
whatever means the situation allows, and count. How much effort that
distribution took is itself a finding — note whether one broadcast covered it or
whether you had to chase people individually.

The metric is not views. It's whether anyone *other than you* uploads.

- **Two or more other people upload** → the behavior exists, build it.
- **Only you upload** → the problem is real but the behavior isn't, and no
  amount of product polish fixes that. Worth knowing now.

Secondary things to watch: how long between the link going out and the first
outside upload; whether it's one heavy contributor or several light ones;
whether anyone comes back a second time to download; whether the same set of
people shows up for a second event; and whether anyone with an
organizer-shaped need turns up unprompted.

## 7. Name

Undecided. Leading direction is **Rollcall** — a roll call is who was there, and
a roll is where the photos live. Runners-up: Scene, Trove.

Ruled out: bare function words (There, With, Among), which can't be searched,
said unambiguously, or owned. Positioning line worth keeping regardless of name:

> Every photo from everyone who was there.

Trademark, App Store, domain, and handle checks still pending on everything.
