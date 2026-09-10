'use client';

import { ACCEPT_ATTRIBUTE, acceptedMime } from '@parea/upload';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { policyFor } from './components/AccessChoice';
import { MemberPicker, type Person } from './components/MemberPicker';
import { PlaceField } from './components/PlaceField';
import { Shell } from './components/Shell';
import { Toggle } from './components/Toggle';
import { SignIn, useSession } from './components/SignIn';
import { useImageFailure } from './components/useImageFailure';
import { coverBytes } from './components/coverBytes';
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
  const [name, setName] = useState('');
  const [caption, setCaption] = useState('');
  const [place, setPlace] = useState('');
  const [members, setMembers] = useState<Person[]>([]);
  /*
   * The picture the event leads with, if they chose one.
   *
   * A `File` and not a URL: it is sent the moment the event exists, before the
   * photographs are staged, so that an event has a face the first time anyone
   * sees it rather than whenever a queue of two hundred pictures reaches the
   * one that was going to be its cover.
   */
  const [cover, setCover] = useState<File | null>(null);
  /*
   * Three switches, and only one of them is the access policy.
   *
   * `policyFor` turns "private" into the column that decides who can see it;
   * the link and the phrase are separate facts about the event. There was a
   * fourth — "manually approve members" — and it is gone with the policy it
   * set: approving people is not a variety of private, it is what private
   * does.
   */
  const [isPrivate, setIsPrivate] = useState(false);
  const [linkJoins, setLinkJoins] = useState(true);
  const [passPhrase, setPassPhrase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
    // Same filter as the event page: `accept` is advice that a drop or "All
    // Files" gets past, and the presign endpoint refuses the whole batch if one
    // file is unacceptable. An empty type is not a rejection — browsers
    // routinely fail to type a HEIC.
    const usable = files.filter((f) => f.type === '' || acceptedMime(f.type) !== null);
    setSkipped(files.length - usable.length);
    setPicked((current) => {
      // Picking twice adds rather than replaces, and picking the same photo
      // twice does not add it twice. The OS dialog does not remember what was
      // chosen last time, so re-opening it to add three more would otherwise
      // silently drop the first forty.
      const seen = new Set(current.map(signature));
      return [...current, ...usable.filter((f) => !seen.has(signature(f)))];
    });
    if (fileRef.current) fileRef.current.value = '';
  }, []);

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
            caption: caption.trim() || undefined,
            place: place.trim() || undefined,
            accessPolicy: policyFor({ isPrivate }),
            linkJoins,
            passPhrase,
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
          await fetch(`/api/events/${created.id}/cover`, {
            method: 'POST',
            headers: { 'content-type': 'image/jpeg' },
            body: await coverBytes(cover),
          }).catch(() => {});
        }

        if (members.length > 0) {
          await fetch(`/api/events/${created.id}/invites`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ actorIds: members.map((m) => m.actorId) }),
          }).catch(() => {});
        }

        await uploads.stage(picked, created.id);
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
      caption,
      place,
      isPrivate,
      linkJoins,
      passPhrase,
      groupId,
      members,
      picked,
      cover,
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
                <h1>Create Event</h1>
                <p className="muted" style={{ margin: 0 }}>
                  Everyone who was there puts their photos in one place, and
                  everyone gets the full set.
                </p>
              </div>
              <SignIn
                why="Making an event needs an account, so the people you invite know whose event it is."
                onSignedIn={session.refresh}
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
              <h1>Create Event</h1>
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
                      ? 'Everything you took. They go up at full quality once the event has a name.'
                      : `${picked.length} ${picked.length === 1 ? 'photo' : 'photos'} ready.`}
                  </p>
                </div>

                {skipped > 0 && (
                  <p className="muted">
                    {skipped === 1 ? '1 file was' : `${skipped} files were`} left out
                    — Parea takes photos, not video or other files.
                  </p>
                )}

                <Thumbs files={picked} onRemove={(f) => setPicked((c) => c.filter((x) => x !== f))} />

                <div className="row">
                  <button type="button" onClick={() => setStep('details')}>
                    Done
                  </button>
                  {picked.length === 0 && (
                    <span className="field-help">
                      You can add them afterwards, but an empty event stays empty.
                    </span>
                  )}
                </div>
              </>
            )}

            {/* ---- step two: what it was --------------------------------- */}
            {step === 'details' && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="name">
                    EVENT TITLE
                  </label>
                  <input
                    id="name"
                    className="big"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sarah's birthday"
                    maxLength={120}
                    required
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="caption">
                    CAPTION
                  </label>
                  <input
                    id="caption"
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="A line about it"
                    maxLength={200}
                  />
                  {/* One line. The name says which evening, this says what it
                      was, and anything longer is what the photographs are for. */}
                  <p className="field-help">Optional, and it shows on the card.</p>
                </div>

                <div className="field">
                  <div className="field-head">
                    <label className="field-label">EVENT COVER</label>
                    <span className="field-note">Optional</span>
                  </div>
                  {/*
                    Chosen from the photographs already picked, because that is
                    what a cover is here — one of the event's own pictures,
                    promoted. Anything else would be a second kind of image
                    living in an event, visible on everybody's home screen and
                    in none of its own grids.
                  */}
                  <CoverPicker files={picked} cover={cover} onChoose={setCover} />
                </div>

                <div className="field">
                  <div className="field-head">
                    <label className="field-label" htmlFor="place">
                      WHERE
                    </label>
                    <span className="field-note">Optional · shows up under Find, by place</span>
                  </div>
                  {/*
                    Type it and pick, or just type it. The lookup is a spelling
                    aid and nothing more: what is stored is the label, never a
                    pin — §7.6 strips GPS from every photo at ingest, and an
                    event that recorded coordinates would undo that for the
                    sake of an autocomplete. See `api/places`.
                  */}
                  <PlaceField value={place} onChange={setPlace} />
                  <p className="field-help">
                    Only ever shown to people already in the event.
                  </p>
                </div>

                <div className="field">
                  <div className="field-head">
                    <label className="field-label">ADD MEMBERS</label>
                    <span className="field-note">Optional</span>
                  </div>
                  {/*
                    Chosen here, asked once the event exists. Nobody is put into
                    an event by somebody else: this writes invitations, and they
                    answer in Activity.
                  */}
                  <MemberPicker picked={members} onChange={setMembers} />
                </div>

                <fieldset className="field">
                  <legend className="field-label">WHO CAN SEE IT</legend>
                  {/*
                    A column of switches rather than a row of named modes. Each
                    line is one decision somebody can predict the result of; the
                    policy underneath is assembled by `policyFor`, which is
                    also what the manage screen writes.
                  */}
                  <div className="toggles">
                    <Toggle
                      label="Private"
                      help={
                        isPrivate
                          ? 'Only the people you add, and anyone you let in after they ask. A forwarded link opens nothing.'
                          : 'Anyone can see it, with no account. Adding photos always needs one.'
                      }
                      on={isPrivate}
                      onChange={setIsPrivate}
                    />
                    <Toggle
                      label="Share link"
                      help={
                        // What the link does depends on the policy above it,
                        // and saying "lets new people in" over a private album
                        // would promise the one thing private does not do.
                        linkJoins
                          ? isPrivate
                            ? 'The link lets new people ask. You answer, under Members.'
                            : 'The link lets new people in.'
                          : 'The link opens nothing for anybody new — only the people you add are in.'
                      }
                      on={linkJoins}
                      onChange={setLinkJoins}
                    />
                    <Toggle
                      label="Pass phrase"
                      help={
                        passPhrase
                          ? 'Three words to say out loud, for the person across the room whose phone you are not holding.'
                          : 'No spoken phrase for this one.'
                      }
                      on={passPhrase}
                      onChange={setPassPhrase}
                    />
                  </div>
                </fieldset>

                <div className="row">
                  <button
                    type="submit"
                    className="create-go"
                    disabled={busy || !name.trim()}
                  >
                    {busy ? 'Creating…' : 'Create Event'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStep('photos')}
                    disabled={busy}
                  >
                    Back to the photos
                  </button>
                </div>
                {error && <p className="muted">{error}</p>}
              </>
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
 * Choosing which of the picked photographs the event leads with.
 *
 * The same strip as `Thumbs`, doing the opposite job: there the button on each
 * tile takes a photograph out, here pressing a tile promotes it. They are not
 * one component with a mode — the two screens are a step apart, and a strip
 * where tapping means "remove" on one page and "choose" on the next is how
 * somebody deletes a photograph they meant to feature.
 *
 * Pressing the chosen one again clears it, which is the only way back to no
 * cover once there is one, and is what pressing a selected thing does
 * everywhere else in this product.
 *
 * With nothing picked there is nothing to choose from, and the line says so
 * rather than offering a file input of its own: a cover that is not in the
 * event would be an image nobody in the event can find.
 */
function CoverPicker({
  files,
  cover,
  onChoose,
}: {
  files: File[];
  cover: File | null;
  onChoose: (file: File | null) => void;
}) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const made = files.map((file) => URL.createObjectURL(file));
    setUrls(made);
    return () => made.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  if (files.length === 0) {
    return (
      <p className="field-help">
        Pick some photos first — a cover is one of them, promoted to the front.
      </p>
    );
  }

  return (
    <>
      <ul className="picked picked-cover">
        {files.map((file, i) => {
          const chosen = cover === file;
          return (
            <li key={signature(file)}>
              <button
                type="button"
                className={`cover-choice${chosen ? ' cover-chosen' : ''}`}
                aria-pressed={chosen}
                aria-label={
                  chosen ? `${file.name} is the cover` : `Use ${file.name} as the cover`
                }
                onClick={() => onChoose(chosen ? null : file)}
              >
                <Thumb src={urls[i] ?? ''} name={file.name} />
                {chosen && <span className="cover-badge">Cover</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="field-help">
        {cover
          ? 'This one leads, wherever the event is shown.'
          : 'Optional. Without one the event leads with its newest photo.'}
      </p>
    </>
  );
}

function Thumbs({ files, onRemove }: { files: File[]; onRemove: (file: File) => void }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const made = files.map((file) => URL.createObjectURL(file));
    setUrls(made);
    return () => made.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

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

  if (!src || failed) {
    return (
      <span className="picked-dead" title={name}>
        {name}
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} onError={onError} src={src} alt="" />;
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
  }
  return res.status >= 500
    ? `The server failed (${res.status}). Check /api/health for what is missing.`
    : `Could not create the event (${res.status}).`;
}
