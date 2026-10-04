'use client';

import { ACCEPT_ATTRIBUTE, MAX_PER_SELECTION, refuseFile } from '@parea/upload';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CONTRIBUTE_EVERYONE, CONTRIBUTE_HOST } from '@parea/core';

import { policyFor } from './components/AccessChoice';
import { ContributeList, type ContributePolicy } from './components/ContributeChoice';
import { InviteFaces } from './components/InviteFaces';
import type { Person } from './components/MemberPicker';
import { Shell } from './components/Shell';
import { thumbnailUrl } from './components/thumbnails';
import { SignIn, useSession } from './components/SignIn';
import { useImageFailure } from './components/useImageFailure';
import { capSelection, selectionNote } from './components/capSelection';
import { coverBytes } from './components/coverBytes';
import { CENTRED, CoverFramer, framingQuery, type CoverFraming } from './components/CoverFramer';
import { useUploads } from './components/useUploads';
import { SiteFooter } from '@/../app/components/SiteFooter';

/**
 * Create — design §3 screen 1, and the design handoff's 3a-3.
 *
 * ## Photos first
 *
 * The old order was: name it, place it, date it, get a link, and then a
 * sentence suggesting you open the event and add some photos. Which meant the
 * one thing that makes an event worth sending was the last thing anyone was
 * asked for, on a different page, after the part that felt like the task was
 * over. An empty event is not half an event — it is nothing at all, and the
 * person best placed to fix that is the one who was just there.
 *
 * So the photos come first and the questions come second. The questions are
 * easier to answer that way too: "what was it?" is a different question when
 * forty pictures of it are on the screen.
 *
 * The two steps are one page and not two routes on purpose. A `File` is lent
 * to the tab that picked it and a navigation ends the loan — routing between
 * the steps would mean either re-picking or writing the bytes to IndexedDB
 * before there is an event to attach them to. Steps in state cost nothing and
 * the files stay live.
 *
 * ## Why the share panel is beside the form rather than after it
 *
 * The share step used to be a page you were sent to after creating, which put
 * the most important moment in the product behind a state transition — the
 * event is worth nothing until the link reaches the group chat, and the second
 * after making it is when someone is most likely to send it. It is visible
 * from the moment there are questions on screen, and simply fills in.
 *
 * This is also the public landing page and the only indexable one, so the
 * subheading is the pitch rather than an instruction.
 *
 * ## Why it asks when, and why native does not
 *
 * A window is what lets other people's own photos from the right hours be
 * found for them later instead of asking them to scroll. The native client no
 * longer asks: it reads the last few days off the phone and offers the runs it
 * finds, which is exact where a phrase is approximate. A browser has no
 * library to read, so here the question stands — and §17's rule still holds
 * that a *wrong* window is worse than none, which is why nothing is
 * pre-selected and "Not sure yet" is a real answer rather than the result of
 * skipping the question.
 */
export default function CreatePage() {
  /*
   * The group this event belongs to, if it was started from one.
   *
   * Read off the URL rather than held in state anywhere, because the journey
   * that sets it is a link from another page — "New event in Sunday Crew" in
   * an event's `+` menu. The API has always taken a `groupId` and checked
   * membership before honouring it; nothing on the web ever sent one.
   *
   * `window.location` rather than `useSearchParams`, which would put this
   * page's whole subtree behind a Suspense boundary for one string.
   */
  const [groupId, setGroupId] = useState<string | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('group');
    setGroupId(value && /^[0-9a-f-]{36}$/i.test(value) ? value : null);
  }, []);

  const [step, setStep] = useState<'photos' | 'details'>('photos');
  const [picked, setPicked] = useState<File[]>([]);
  const [skipped, setSkipped] = useState(0);
  /** Said when the last pick went over the limit; null when it did not. */
  const [overLimit, setOverLimit] = useState<string | null>(null);
  // Shared by both strips below — see `usePreviewUrls`.
  const previews = usePreviewUrls(picked);
  const [name, setName] = useState('');
  /* Who gets asked, held until there is a roll to ask them into. */
  const [invitees, setInvitees] = useState<Person[]>([]);
  /*
   * The people who will hold the camera with them, on a roll set to `host`.
   *
   * Its own list rather than a flag on `invitees`, because the two questions
   * are asked separately: being in the roll is the ordinary case, and naming a
   * co-host is also asking them in — which is why the create call below sends
   * this list on its own rather than repeating those names under members.
   *
   * Kept when the setting moves off "Hosts" rather than cleared. Somebody
   * clicking between the three answers has not withdrawn anything, and a list
   * that emptied itself on the way past "Just me" would cost them the picking.
   */
  const [coHosts, setCoHosts] = useState<Person[]>([]);
  /*
   * The picture the album leads with: the first photograph, unless another
   * was promoted — the app's rule, so a roll made in a browser has a face just
   * as one made on a phone does.
   *
   * Held as a promotion rather than by reordering `picked`, because the
   * previews are keyed on that array and reordering it would remake every
   * thumbnail. The strip draws the cover first instead.
   *
   * A `File` and not a URL: it is sent the moment the album exists, before the
   * photographs are staged, so that an album has a face the first time anyone
   * sees it rather than whenever a queue of two hundred pictures reaches the
   * one that was going to be its cover.
   */
  const [promoted, setPromoted] = useState<File | null>(null);
  const cover = promoted && picked.includes(promoted) ? promoted : (picked[0] ?? null);
  /*
   * How the cover sits in the card, from the framer — the app's question,
   * asked here too. Null is "not framed", which the server answers by
   * centring on what its own model finds interesting, as it always did.
   */
  const [coverFraming, setCoverFraming] = useState<CoverFraming | null>(null);
  /** The file the framer is open on, or null when it is closed. */
  const [framing, setFraming] = useState<File | null>(null);
  /*
   * Three switches, and only one of them is the access policy.
   *
   * `policyFor` turns "private" into the column that decides who can see it;
   * the link and the phrase are separate facts about the album. There was a
   * fourth — "manually approve members" — and it is gone with the policy it
   * set: approving people is not a variety of private, it is what private
   * does.
   */
  const [isPrivate, setIsPrivate] = useState(false);
  /* Everyone, which is what an album is usually for. The other two are
     choices somebody makes on purpose. */
  const [contribute, setContribute] = useState<ContributePolicy>(CONTRIBUTE_EVERYONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /*
   * The top of the details step: the name, then the photos under it.
   *
   * Arriving at the details used to leave the page wherever the photo step
   * had scrolled it — often halfway down a long grid — so the first field was
   * somewhere above, and the ones after it were easy to scroll straight past.
   * So the step opens with this at the top of the screen and the cursor in the
   * title, and every field after it is the next thing down.
   */
  const detailsTop = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step !== 'details') return;
    detailsTop.current?.scrollIntoView({ block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);
  /*
   * A sharper copy of a picked photo for the cover framer, made once per file.
   * The grid's previews are 320px, which is soft at the frame's size.
   */
  const sharpCopies = useRef(new Map<string, Promise<string | null>>());
  const sharpen = useCallback(
    (id: string) => {
      const file = picked.find((f) => signature(f) === id);
      if (!file) return Promise.resolve(null);
      let made = sharpCopies.current.get(id);
      if (!made) {
        made = thumbnailUrl(file, 1600).catch(() => null);
        sharpCopies.current.set(id, made);
      }
      return made;
    },
    [picked],
  );

  /** Leaving a photo out — and its framing with it, if it was the cover. */
  const leaveOut = useCallback(
    (file: File) => {
      setPicked((c) => c.filter((x) => x !== file));
      if (cover === file) {
        setPromoted(null);
        setCoverFraming(null);
      }
    },
    [cover],
  );

  /*
   * This one leads, from now on — or, pressed when it already does, reframe it.
   * A framing was a decision about a different photograph, so promoting clears
   * it.
   */
  const promote = useCallback(
    (file: File) => {
      if (file === cover) {
        setFraming(file);
        return;
      }
      setPromoted(file);
      setCoverFraming(null);
    },
    [cover],
  );
  const session = useSession();

  // Mounted before there is an event, and handed the id the moment there is
  // one. `useUploads` sits out the empty case rather than opening a queue for
  // an event that does not exist.
  /*
   * Mounted with no event on purpose. Nothing uploads from this page any more;
   * the only thing wanted from the hook here is `stage` — somewhere to leave
   * the photos for the event page to pick up and send.
   */
  const uploads = useUploads('');
  const router = useRouter();

  const pick = useCallback((files: File[]) => {
    // Same filter as the event page, and the same function rather than the
    // same idea written twice: `accept` is advice that a drop or "All Files"
    // gets past, and the presign endpoint refuses the whole batch if one file
    // is unacceptable — including one that is zero bytes. An empty type is
    // still not a rejection; see `sendableMime`.
    const usable = files.filter((f) => refuseFile(f) === null);
    setSkipped(files.length - usable.length);
    // Picking twice adds rather than replaces, and picking the same photo
    // twice does not add it twice. The OS dialog does not remember what was
    // chosen last time, so re-opening it to add three more would otherwise
    // silently drop the first forty.
    const seen = new Set(picked.map(signature));
    const fresh = usable.filter((f) => !seen.has(signature(f)));
    // The roll as a whole, not each pick, is held to the limit — the photos
    // all go up together once it has a name. Duplicates are out first so they
    // do not take up room.
    const { kept, dropped } = capSelection(picked.length, fresh, MAX_PER_SELECTION);
    setOverLimit(dropped > 0 ? selectionNote(kept.length, MAX_PER_SELECTION) : null);
    if (kept.length > 0) {
      setPicked([...picked, ...kept]);
      /*
       * Straight on to naming it.
       *
       * Choosing photos was followed by a "Done" press to reach the next step,
       * after iOS's own picker had already made somebody wait while it got the
       * photos ready. The photos are here; the strip on the next step fills in
       * its thumbnails while the roll is being named, and "Back to photos" is
       * there for adding more.
       */
      setStep('details');
    }
    if (fileRef.current) fileRef.current.value = '';
  }, [picked]);

  /**
   * Make it, ask the people, hand over the photos, and go there.
   *
   * The order is forced: invitations and photos both need an id, so neither
   * can happen before the event exists, and the navigation has to be last
   * because until the queue is written there is nothing for the event page to
   * pick up.
   *
   * The photos are *staged*, not uploaded. Uploading here is what the old
   * "your event is ready" screen was for — somewhere to stand while a hundred
   * photographs went up. The queue goes into IndexedDB under the new event's
   * id and the handles stay in memory, and the event page resumes them while
   * you look at what arrives.
   */
  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            accessPolicy: policyFor({ isPrivate }),
            contributePolicy: contribute,
            // No link or pass-phrase switches here any more — the app has
            // never asked, and the server's defaults are its answers: the link
            // lets people in, and there is no spoken phrase. Both are on the
            // manage screen for the roll that wants something else.
            // Ignored by the server unless this person is in that group.
            groupId: groupId ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(await explain(res));
        const created = (await res.json()) as { id: string };

        /*
         * Before the invitations and before the photographs, because it is the
         * only one of the three that changes what the event looks like when it
         * opens a second from now.
         *
         * Failing does not fail the event, on the same reasoning as a failed
         * invitation: the event is made, and a cover is the easiest of the
         * three things to do again. It is scaled down in the browser first —
         * see `coverBytes` — so this is one small request rather than the
         * twelve megabytes that came off the camera.
         */
        if (cover) {
          /*
           * Still not fatal, and no longer silent.
           *
           * `.catch(() => {})` only ever caught a dropped connection. A 400
           * resolves like any other response, so the one failure this actually
           * had — a picture the browser could not re-encode, posted anyway and
           * refused — went into the void, and the album opened with no cover
           * and no reason. The server names it in its log now; this names it
           * where whoever is looking at the screen can see it.
           */
          const bytes = await coverBytes(cover);
          const set = bytes
            ? await fetch(
                `/api/events/${created.id}/cover${coverFraming ? `?${framingQuery(coverFraming)}` : ''}`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'image/jpeg' },
                  body: bytes,
                },
              ).catch(() => null)
            : null;
          if (!set?.ok) {
            console.warn(
              `cover: not set on ${created.id} — ` +
                (bytes ? `server answered ${set ? set.status : 'nothing'}` : 'no decoder read it'),
            );
          }
        }

        /*
         * The invitations, members and co-hosts in one call, because the route
         * counts them as one guest list and applies its cap of fifty to the
         * pair. A failure costs the roll nothing — it is made, and asking again
         * is under Manage.
         *
         * The co-hosts are only sent *as* co-hosts where the setting means
         * anything. Somebody who picked two and then chose "Just me" has
         * changed their mind about the roll; they are still asked in, as
         * members, which is what inviting meant.
         */
        const hosting = contribute === CONTRIBUTE_HOST;
        const asHosts = hosting ? coHosts : [];
        const asMembers = [...invitees, ...(hosting ? [] : coHosts)];
        if (asHosts.length > 0 || asMembers.length > 0) {
          await fetch(`/api/events/${created.id}/invites`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              actorIds: asMembers.map((m) => m.actorId),
              hostActorIds: asHosts.map((m) => m.actorId),
            }),
          }).catch(() => {});
        }

        await uploads.stage(picked, created.id, cover);
        /*
         * A client navigation, and it is load-bearing rather than a nicety.
         *
         * This was `location.href`, on the grounds that the create response set
         * the capability cookie and a full load was the way to pick it up. But
         * `/event/[id]` is `force-dynamic`, so a client navigation fetches it
         * from the server too and sends that cookie exactly the same — the
         * reload bought nothing there.
         *
         * What it cost was the photographs. Tearing the document down ends the
         * loan on every picked `File`, and on iOS the temp copy behind an
         * asset picked from the library goes with it; the event page then read
         * back handles that could no longer produce bytes, marked all of them
         * `stale`, and presigned nothing. Staying in the same document keeps
         * the loan alive, which is the same reason the two steps above this one
         * are one page rather than two routes.
         */
        router.push(`/event/${created.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [
      name,
      isPrivate,
      groupId,
      invitees,
      coHosts,
      contribute,
      picked,
      cover,
      coverFraming,
      uploads,
      router,
    ],
  );


  if (session.known && !session.account) {
    return (
      <Shell>
        <main className="main" style={{ padding: '36px 40px' }}>
          <div className="create">
            <form className="create-form" onSubmit={(e) => e.preventDefault()}>
              <div>
                <h1>Create Roll</h1>
                <p className="muted" style={{ margin: 0 }}>
                  Everyone who was there puts their photos in one place, and
                  everyone gets the full set.
                </p>
              </div>
              <SignIn
                why="Making a roll needs an account, so the people you invite know whose roll it is."
                // A new account carries on to the roll it came to make;
                // somebody signing back in lands on their home, not a blank form.
                onSignedIn={({ created }) =>
                  created ? session.refresh() : globalThis.location.assign('/events')
                }
              />
            </form>
          </div>
          <SiteFooter />
        </main>
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="main" style={{ padding: '36px 40px' }}>
        <div className="create">
          <form className="create-form" onSubmit={create}>
            <div>
              <h1>Create Roll</h1>
              <p className="muted" style={{ margin: 0 }}>
                {step === 'photos'
                  ? 'Start with the photos. The questions are easier to answer with them on the screen.'
                  : 'Everyone who was there puts their photos in one place, and everyone gets the full set.'}
              </p>
            </div>

            {/* ---- step one: the photos ---------------------------------- */}
            {step === 'photos' && (
              <>
                <input
                  id="create-photos"
                  className="visually-hidden"
                  ref={fileRef}
                  type="file"
                  multiple
                  // Spelled out rather than an image wildcard, and written
                  // without the literal wildcard token: it contains a
                  // block-comment opener, and a source-scanning test that
                  // strips comments swallows the attribute with it. See
                  // test/accepted-types.test.ts.
                  accept={ACCEPT_ATTRIBUTE}
                  onChange={(e) => pick(Array.from(e.target.files ?? []))}
                />

                <div className="picker">
                  <label className="button-like primary" htmlFor="create-photos">
                    {picked.length === 0 ? 'Select photos' : 'Add more'}
                  </label>
                  <p className="field-help" style={{ margin: 0 }}>
                    {picked.length === 0
                      ? 'Everything you took. They go up at full quality once the roll has a name.'
                      : `${picked.length} ${picked.length === 1 ? 'photo' : 'photos'} ready.`}
                  </p>
                </div>

                {skipped > 0 && (
                  <p className="muted">
                    {skipped === 1 ? '1 file was' : `${skipped} files were`} left out
                    — Parea takes photos, not video or other files.
                  </p>
                )}

                {overLimit && <p className="muted">{overLimit}</p>}

                <Thumbs files={picked} urls={previews} onRemove={leaveOut} />

                <div className="row">
                  <button type="button" onClick={() => setStep('details')}>
                    Done
                  </button>
                  {picked.length === 0 && (
                    <span className="field-help">
                      You can add them afterwards, but an empty roll stays empty.
                    </span>
                  )}
                </div>
              </>
            )}

            {/* ---- step two: what it was --------------------------------- */}
            {/*
              The app's create screen, in a browser: the name as the heading, a
              strip of what is going in, who can see it, who can add, and one
              card for inviting. The caption, the place, the cover chooser and
              the co-host picker are gone from it, as they are from the app's.
            */}
            {step === 'details' && (
              <div ref={detailsTop} className="create-details details-top">
                <div className="field">
                  <input
                    ref={titleRef}
                    id="name"
                    className="roll-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name this roll"
                    aria-label="Name this roll"
                    maxLength={120}
                    required
                  />
                </div>

                {/*
                  What is going in, cover first. Clicking one makes it the cover
                  — clicking the cover reframes it — and its × leaves it out. See
                  `detailsTop` for why the step opens here.
                */}
                {picked.length > 0 && (
                  <div className="roll-strip">
                    <div className="field-head">
                      <span className="field-label">IN THIS ROLL</span>
                      <span className="field-note">
                        {picked.length} {picked.length === 1 ? 'photo' : 'photos'}
                      </span>
                    </div>
                    <ul className="roll-thumbs">
                      {[...(cover ? [cover] : []), ...picked.filter((f) => f !== cover)].map((file) => {
                        const isCover = file === cover;
                        return (
                          <li key={signature(file)}>
                            <button
                              type="button"
                              className={`roll-thumb${isCover ? ' is-cover' : ''}`}
                              aria-pressed={isCover}
                              aria-label={
                                isCover ? `Reframe the cover, ${file.name}` : `Use ${file.name} as the cover`
                              }
                              onClick={() => promote(file)}
                            >
                              <Thumb src={previews[picked.indexOf(file)] ?? ''} name={file.name} />
                            </button>
                            <button
                              type="button"
                              className="roll-remove"
                              aria-label={`Leave out ${file.name}`}
                              onClick={() => leaveOut(file)}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {framing && (
                      <CoverFramer
                        photos={picked.map((file, i) => ({ id: signature(file), src: previews[i] ?? '' }))}
                        coverId={signature(framing)}
                        initial={framing === cover && coverFraming ? coverFraming : CENTRED}
                        sharpen={sharpen}
                        onCancel={() => setFraming(null)}
                        onConfirm={(id, chosenFraming) => {
                          setPromoted(picked.find((file) => signature(file) === id) ?? framing);
                          setCoverFraming(chosenFraming);
                          setFraming(null);
                        }}
                      />
                    )}
                  </div>
                )}

                <fieldset className="field create-see">
                  <legend className="field-label">WHO CAN SEE IT</legend>
                  <div className="pills">
                    {(
                      [
                        [false, 'Public'],
                        [true, 'Private'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        className="pill"
                        aria-pressed={isPrivate === value}
                        onClick={() => setIsPrivate(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="field-help">
                    {isPrivate
                      ? 'Only people you invite. A forwarded link opens nothing.'
                      : 'Anyone with the link can see it, no account needed.'}
                  </p>
                </fieldset>

                {/*
                  Second of the two, and the order is load-bearing: this
                  question's first answer is named by the other one's — "Anyone"
                  on a public roll, "Members" on a private one — so it reads the
                  live switch above rather than a saved policy.
                */}
                <fieldset className="field create-add">
                  <legend className="field-label">WHO CAN ADD PHOTOS</legend>
                  <ContributeList
                    value={contribute}
                    accessPolicy={policyFor({ isPrivate })}
                    onChange={setContribute}
                  />
                  {/*
                    And who those hosts are, asked under the answer that raises
                    it. Picking somebody asks them in *and* records that
                    accepting makes them a co-host; Manage answers it again
                    afterwards.
                  */}
                  {contribute === CONTRIBUTE_HOST && (
                    <InviteFaces
                      kind="hosts"
                      picked={coHosts}
                      onChange={setCoHosts}
                      exclude={new Set(invitees.map((p) => p.actorId))}
                    />
                  )}
                </fieldset>

                {/*
                  Chosen here, asked once the roll exists. Nobody is put into a
                  roll by somebody else: this writes invitations, and they
                  answer in Activity.
                */}
                <InviteFaces
                  picked={invitees}
                  onChange={setInvitees}
                  exclude={new Set(coHosts.map((p) => p.actorId))}
                />

                <div className="create-foot">
                  {error && <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{error}</p>}
                  <button
                    type="submit"
                    className="create-go"
                    disabled={busy || !name.trim()}
                  >
                    {busy ? 'Creating…' : 'Create roll'}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setStep('photos')}
                    disabled={busy}
                  >
                    Back to the photos
                  </button>
                </div>
              </div>
            )}

          </form>

        </div>

        <SiteFooter />
      </main>
    </Shell>
  );
}

/**
 * What was chosen, at a size you can recognise a night out from.
 *
 * Object URLs rather than data URLs: a hundred photographs base64'd into the
 * DOM is a hundred copies of them in memory. They are revoked when the set
 * changes, which is the whole reason this is a component with an effect rather
 * than a `src` computed inline — inline, every render would leak one URL per
 * photo and nothing would ever release them.
 */
/**
 * One small preview per picked file, made once for the whole screen.
 *
 * Both strips show the same photographs, so they share these. Previews are
 * thumbnails made one at a time (`thumbnailUrl`), not the originals: a strip of
 * full-size iPhone originals is what ran Safari out of memory mid-upload. Each
 * fills in as it is ready; one this browser cannot shrink falls back to the
 * original, which is what was shown before.
 */
function usePreviewUrls(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setUrls(files.map(() => ''));
    void (async () => {
      for (let i = 0; i < files.length; i++) {
        if (cancelled) return;
        const url = (await thumbnailUrl(files[i]!)) ?? URL.createObjectURL(files[i]!);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        made.push(url);
        setUrls((was) => {
          const next = [...was];
          next[i] = url;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);
  return urls;
}

function Thumbs({
  files,
  urls,
  onRemove,
}: {
  files: File[];
  urls: string[];
  onRemove: (file: File) => void;
}) {

  if (files.length === 0) return null;

  return (
    <ul className="picked">
      {files.map((file, i) => (
        <li key={signature(file)}>
          <Thumb src={urls[i] ?? ''} name={file.name} />
          <button
            type="button"
            aria-label={`Leave out ${file.name}`}
            onClick={() => onRemove(file)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One of them, with somewhere to go when it will not draw.
 *
 * An object URL for a file the browser just handed over looks like it cannot
 * fail, and it can: the browser lends a `File` to the tab that picked it and
 * the loan can end — a HEIC it will not decode fails the same way. Both come
 * back as a broken-image glyph, which describes nothing. The name is a better
 * answer, because the next thing this person does is decide whether they still
 * want that photo in.
 */
function Thumb({ src, name }: { src: string; name: string }) {
  const { ref, failed, onError } = useImageFailure(src);

  // Still being made: an empty tile, so the strip does not flash a list of
  // names and then swap pictures in.
  if (!src) return <span className="picked-dead" title={name} aria-label={name} />;

  if (failed) {
    return (
      <span className="picked-dead" title={name}>
        {name}
      </span>
    );
  }

  // `decoding="async"` for the fallback, which can be an original when this
  // browser could not make a thumbnail — see `usePreviewUrls`.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} onError={onError} src={src} alt="" decoding="async" />;
}

/** Enough to recognise the same file picked twice. Matches the queue's dedupe. */
function signature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function explain(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  switch (body.error) {
    case 'name_required':
      return 'Give it a name.';
    case 'no_actor':
      return 'This browser has no identity yet. Reload and try again.';
    case 'not_configured':
      return 'This deployment is not finished — it has no database yet. Check /api/health.';
    case 'sign_in_required':
      return 'Sign in first — a roll belongs to an account.';
    case 'too_many_requests':
      return 'That is a lot of rolls at once. Wait a moment and try again.';
  }
  if (res.status >= 500) {
    return `The server failed (${res.status}). Check /api/health for what is missing.`;
  }
  /*
   * The code, where there is one and no wording for it.
   *
   * This said "Could not create the album (400)" and stopped, which is a
   * sentence with the useful half removed: the server had already named the
   * problem and the number was all that reached the screen. What it hid was
   * `invalid_contribute_policy` — the route refusing "Only me" because its
   * list of policies had gone stale — and a bare 400 sent somebody looking at
   * their own form for a mistake that was not in it.
   *
   * Every case above is a sentence because somebody can act on it. The rest
   * are for whoever is going to read them in a report, so they are shown as
   * they are rather than translated into a friendlier nothing.
   */
  return body.error
    ? `Could not create the roll (${res.status}: ${body.error}).`
    : `Could not create the roll (${res.status}).`;
}
