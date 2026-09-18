# Charter

**What Parea is, what it will not become, and how to tell which one a proposal
is.**

This is the live document. [`concept.md`](./concept.md) is the founding
argument — the problem, why the existing options do not resolve it, and the
reasoning that led here — and it is worth reading first and worth keeping. It
is not worth consulting to decide whether to build something: it describes a
product that has since been built into something more specific, and its
"explicitly not" list now rules out features that shipped months ago.

That gap is the reason this file exists. Every one of those features was argued
on its own merits, in the docblock above the code that implements it, and won.
What was missing was any single place where the *new* rule was written down —
so the only way to answer "should we build X" was archaeology, and archaeology
gives a different answer depending on which file you open first.

Where this and `concept.md` disagree, this wins. Where this and
[`design.md`](./design.md) disagree, design.md is describing the mechanism and
this is describing the intent; fix whichever is actually wrong.

---

## 1. What the product is

The problem is unchanged and still the whole point:

> You went to a party. Six people took photos. You have almost none of them.
> Asking is a favour, and nobody wants to ask.

Parea is **a place to put everyone's photos from one thing that happened**, and
**a way for the people who keep doing things together to stop re-solving the
distribution problem every time**. The first is an album. The second is a
group. Everything in the product is one of those two things or is in service of
them.

The positioning line still holds: *every photo from everyone who was there.*

### Vocabulary

The schema says `event`; the interface says **album**. This is deliberate — an
"event" is the thing that happened and an "album" is what you get — and it is
a trap for anyone reading code and UI side by side. A group is a group in both.
Nothing else has two names, and nothing else should.

## 2. What changed since the concept

Stated plainly, because pretending it did not happen is how the next
contributor ends up arguing against shipped code:

| The concept said | The product has |
|---|---|
| No account to contribute | An account to contribute; none to look at a public album |
| No likes | Reactions on photographs, which name who left them, and on messages, which tally |
| No comments | Threads on albums and on groups; a remark can be about one photograph |
| No profiles, usernames, friend requests, mutual friends | All four, plus avatars and a page per person |
| Three notifications | Ten, enumerated in `@parea/push` |
| Name undecided (*Rollcall*) | Parea, at parea.photos |

None of that is drift, and all of it is load-bearing:

- **The account** is what makes an upload attributable, which is what makes
  the child-safety runbook workable. `concept.md` §2 already reversed this and
  said why.
- **Reactions and comments** are how an album stays worth opening in the week
  after the party, which is the week the photographs actually get collected.
- **Tags** answer "which of these am I in" without face matching, which is the
  version of that feature with no biometric exposure.
- **Friends** are an address book: one tap to put somebody in an album instead
  of finding a link to send them.

What has *not* changed is who any of it is for. Every one of those features
operates inside a room that already exists, among people who were already
there. That is the line, and §4 is how to apply it.

## 3. The invariants

Five. These do not move without a deliberate decision recorded here, and four
of the five are enforced in code rather than by agreement.

**1. Photographs are never findable. Groups may be.**
Search returns a door, not a room. There is no global album search, no photo
search, and no browsing of anything you were not let into. A group may be
`findable` — asked once at creation — and what comes back is a name and a
member count and never what is inside. *Enforced:* `/api/groups/search`,
`/api/people` (prefix-only, ten results), `FindView`.

**2. Nothing is recommended except a findable group.**
An album must never be suggested, ranked, or surfaced to somebody who does not
already hold it. Possession of the link, or membership, *is* the access model,
and a recommended album is a door nobody sent you. The one exception is a
findable group a friend is already in — reachable by asking that friend anyway,
which is why the card names them. *Enforced:* `authorize()`, and said out loud
at the foot of the search page.

**3. An upload names who made it; a look does not.**
Contributing requires an account. Viewing a public album requires nothing.
*Enforced:* `authorize()`'s `contribute` branch.

**4. No number measures a person.**
No follower count, no view count, no friend count, no ranking, and no "people
you may know" beyond friends-of-friends who could already reach you by asking.
A profile carries one number — how many albums you and the viewer are both in —
and that is a fact about the viewer's own shelf. A count *inside* a room is
fine and exists: three reactions on a photograph, eleven people in a group.
What is ruled out is a score attached to somebody, which would make the search
box a way to measure strangers. *Enforced:* by review, and by `people.ts`
declining to add one.

**5. `ready` is the gate.**
Nothing is listed, served, or downloaded before ingest completes: stripped,
scanned, derived. Ingest fails closed in both directions. *Enforced:*
`visiblePhotos`, and a test that fails the build if bytes route around it.

## 4. The feature test

The concept's test — *does this help people contribute, find, or retrieve
shared photos?* — is retired. It rejects reactions, tags, threads and friends,
all of which shipped and all of which were right.

Two questions. A proposal has to pass both.

> **1. Does it help the people who were there end up with the photographs, or
> make the album worth opening again while that is still happening?**
>
> **2. Does it give a photograph an audience nobody in it chose?**
> If yes, it is out — whatever the answer to the first.

The second question is the one that does the work, and it is why this list is
coherent:

- A reaction, a comment, a tag → audience unchanged. **In.**
- A friend request, an invite to an album → a person joins a room by consenting
  to join it. **In.**
- A findable group → a door, and you still have to ask. **In.**
- Posting one photograph to a feed of your friends → a photograph acquires an
  audience the people in it never agreed to, chosen by whoever holds the
  camera. **Out**, and the fact that it is technically cheap does not change
  that.
- A prompt that asks everybody to post a picture of their best friend → the
  same, plus it sources photographs from outside any room at all. **Out** in
  that shape; see §6 for the shape that is not.

And one rule of its own, because it is the part people reach for first:

> **Anything that interrupts somebody must be addressed to them.**

Ten notification kinds, enumerated as a closed union in `@parea/push` so the
set stays countable and the privacy manifest stays honest. Nine are addressed —
somebody did a thing that concerns you. The tenth is `nudge`, one per album
ever, capped in the schema rather than by intention. No digests, no
re-engagement, no "3 new photos". A scheduled broadcast needs an argument made
here first, not a call site.

## 5. Ruled out

Not "not yet" — decided, with the reason, so that proposing one means arguing
against the reason rather than rediscovering it.

- **Open discovery of albums or photographs.** A browsable party is a
  surveillance surface and a moderation problem that cannot be staffed.
- **A feed of individual photographs.** Fails question 2. It also reinstates
  the selection bias the product exists to defeat: Instagram surfaces what the
  photographer wanted seen, and the whole asymmetry here is that you leave with
  pictures of yourself that somebody else took.
- **Face matching, "find my photos", any biometric.** BIPA and its analogues
  carry statutory damages, the people in the photographs did not consent, and
  tagging already answers the question it would answer.
- **Counts, tallies, rankings, streaks.** Invariant 4.
- **Re-engagement notifications and digests.** §4's rule.
- **Individuals charging for their own uploads.** Reinstates the ask the
  product exists to remove, and monetises photographs of people who never
  agreed to be sold.
- **Paid galleries.** Deferred, not refused — `concept.md` §5 has the argument
  and the signal to watch for. The architectural constraint stands: don't build
  it, don't build against it.

## 6. Open, and honestly open

Things the code has a position on and the product does not. Each is a real
question, and none should be closed by a feature that quietly assumes an
answer.

**The friend graph grants nothing.** Request, accept, decline, unfriend,
friend-of-friend suggestions, a phone-hash lookup, and a merge path that has to
clean up friendships when two actors become one — and what friendship buys is a
row in the invite picker and a different empty-state sentence. `authorize()`
does not take friendship as an input. Either it should carry weight or it is
carrying too much code for what it does.

**There is no reason to open the app between albums.** Home is a shelf. Lately
is a list of things that happened *to you* and is empty when nothing did.
Neither pulls. This is the real question behind every feature proposal that
gets called a feed, and the honest answer is that nobody has measured whether
it matters yet: §18's *return rate — a second album with an overlapping set of
people* has never been read once. **No feature justified by retention ships
before that number exists.**

**A weekly prompt is not ruled out; the friends-feed shape of it is.** Scoped to
a group, a prompt is an album in that group with a contribution-gated reveal —
a room that already exists, members who already consented, a `group_event`
notification that is already allowed, and a third branch in `authorize()`,
which is where `policy.ts` says a third policy goes. That passes both
questions. It is still downstream of the paragraph above.

**Blocking has no undo anyone can reach.** `DELETE /api/blocks` exists, no
screen on either client calls it, and it is keyed by a photograph of the person
being unblocked — which the block has just hidden. A block list belongs
somewhere in Settings.

**The two clients are diverging at the surface.** Web search is one box over
three namespaces with suggestions and doors; the app's search tab is still the
older by-place list. "Two clients, one protocol" is true of the API and
slipping above it.

## 7. How this document changes

A proposal runs §4's two questions. If it passes, it says which of §3's
invariants it touches and how it stays inside them, and that paragraph lands
here in the same change that lands the code. If it fails, it goes in §5 with
its reason, so the next person argues with the reason instead of rediscovering
it.

An invariant may be given up. It has not happened yet, and it should look like
a decision with a date on it rather than like a feature that needed room.
