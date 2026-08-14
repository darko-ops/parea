'use client';

import { ACCEPT_ATTRIBUTE, acceptedMime } from '@parea/upload';
import { LINK_OPEN } from '@parea/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { WHEN_OPTIONS, eventDateFor, windowFor, type WindowId } from '@parea/autoselect';

import { AccessChoice, type AccessPolicy } from './components/AccessChoice';
import { Shell } from './components/Shell';
import { SignIn, useSession } from './components/SignIn';
import { useImageFailure } from './components/useImageFailure';
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
  const [when, setWhen] = useState<WindowId | ''>('');
  const [access, setAccess] = useState<AccessPolicy>(LINK_OPEN);
  const [eventId, setEventId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const session = useSession();

  // Mounted before there is an event, and handed the id the moment there is
  // one. `useUploads` sits out the empty case rather than opening a queue for
  // an event that does not exist.
  const uploads = useUploads(eventId ?? '');

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

  const create = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!when || !name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const now = new Date();
        const window = windowFor(when, now);
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            caption: caption.trim() || undefined,
            place: place.trim() || undefined,
            eventDate: eventDateFor(when, now),
            // The pair the question exists to collect. Sent together or not at
            // all — the server refuses half a window, because half resolves
            // against an open interval, which is every photo on a device.
            startsAt: window?.startsAt ?? null,
            endsAt: window?.endsAt ?? null,
            accessPolicy: access,
            // Ignored by the server unless this person is in that group.
            groupId: groupId ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(await explain(res));
        const created = (await res.json()) as {
          id: string;
          url: string;
          code: string | null;
        };
        setEventId(created.id);
        setLink(new URL(created.url, globalThis.location.origin).toString());
        setCode(created.code);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [name, place, when, access],
  );

  /**
   * Sending starts when there is somewhere to send to.
   *
   * In an effect rather than at the end of `create`, because `uploads.add`
   * closes over the event id and the copy inside that callback is the one from
   * the render that ran before `setEventId`. Reading it from state after the
   * re-render is the only version of this that uploads to the right event.
   */
  const sent = useRef(false);
  useEffect(() => {
    if (!eventId || sent.current) return;
    sent.current = true;
    if (picked.length === 0) {
      setBusy(false);
      return;
    }
    void uploads.add(picked).finally(() => setBusy(false));
  }, [eventId, picked, uploads]);

  const copy = useCallback(async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    // A label that changes back, rather than a toast. The feedback belongs on
    // the thing that was pressed.
    setTimeout(() => setCopied(false), 2000);
  }, [link]);

  const chosen = WHEN_OPTIONS.find((option) => option.id === when);
  const created = link !== null;

  if (session.known && !session.account) {
    return (
      <Shell>
        <main className="main" style={{ padding: '36px 40px' }}>
          <div className="create">
            <form className="create-form" onSubmit={(e) => e.preventDefault()}>
              <div>
                <h1>Create Album</h1>
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
              <h1>{created ? name : 'Create Album'}</h1>
              <p className="muted" style={{ margin: 0 }}>
                {created
                  ? 'Made. Send the link — an empty event stays empty.'
                  : step === 'photos'
                    ? 'Start with the photos. The questions are easier to answer with them on the screen.'
                    : 'Everyone who was there puts their photos in one place, and everyone gets the full set.'}
              </p>
            </div>

            {/* ---- step one: the photos ---------------------------------- */}
            {!created && step === 'photos' && (
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
            {!created && step === 'details' && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="name">
                    WHAT WAS IT?
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
                  {/*
                    Directly under the name and unlabelled, because it is the
                    same thought continued — a field with its own heading would
                    make it a second question, and it is optional. One line: the
                    name says which evening, this says what it was, and anything
                    longer is what the photographs are for.
                  */}
                  <input
                    id="caption"
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Add a line about it (optional)"
                    maxLength={200}
                    aria-label="A line about the event"
                  />
                </div>

                <div className="field">
                  <div className="field-head">
                    <label className="field-label" htmlFor="place">
                      WHERE
                    </label>
                    <span className="field-note">Optional · shows up under Find, by place</span>
                  </div>
                  <input
                    id="place"
                    type="text"
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    placeholder="Add a location"
                    maxLength={80}
                  />
                  {/*
                    As you would say it, not an address, and never derived from
                    a photo: §7.6 strips GPS at ingest and ingest fails if any
                    survives, so there is nothing to derive it from even if the
                    product wanted to.
                  */}
                  <p className="field-help">
                    As you&rsquo;d say it, not an address. Only ever shown to
                    people already in the event.
                  </p>
                </div>

                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label" style={{ padding: 0 }}>
                    WHEN
                  </legend>
                  <div className="pills">
                    {WHEN_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="pill"
                        aria-pressed={when === option.id}
                        onClick={() => setWhen(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {/*
                    The selected option's own description, then why the question
                    is being asked at all. A date question with no stated reason
                    gets a careless answer, and a careless one here pre-selects
                    the wrong photos on somebody else's phone.
                  */}
                  <p className="field-help">
                    {chosen ? `${capitalise(chosen.hint)}. ` : ''}
                    It is what lets everyone&rsquo;s own photos from the right
                    hours be found for them later, instead of asking them to
                    scroll. &ldquo;Not sure yet&rdquo; is a real answer.
                  </p>
                </fieldset>

                <fieldset className="field">
                  <legend className="field-label">WHO CAN SEE IT</legend>
                  {/* The three, and their copy, live in one file — this was
                      two options here and a different two on the phone, for
                      one column. */}
                  <AccessChoice value={access} onChange={setAccess} />
                </fieldset>

                <div className="row">
                  <button
                    type="submit"
                    className="create-go"
                    disabled={busy || !name.trim() || !when}
                  >
                    {busy ? 'Creating…' : 'Create Album'}
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

            {/* ---- after: what is happening to the photos ----------------- */}
            {created && (
              <div className="create-next">
                {uploads.running && (
                  <p className="muted">
                    Adding your photos — {uploads.remaining} of{' '}
                    {uploads.items.length} to go. Keep this tab open until it
                    finishes; uploads do not continue in the background.
                  </p>
                )}

                {/*
                  Said whatever happened, not only when it went well.

                  Three outcomes and they need different sentences, which is the
                  whole reason this is not one count. The first version reported
                  a number when `done > 0` and was silent otherwise, so a batch
                  where nothing arrived looked exactly like a batch nobody
                  chose. The second version covered failure and was still silent
                  in the case that actually happens: the queue treats a lost
                  connection as a *pause*, deliberately — it leaves items
                  `pending` so a retry costs no attempt — so `done`, `failed`
                  and `stale` are all zero and the paragraph rendered empty.
                  Found by watching the real queue rather than the screen:
                  status `pending`, error "Failed to fetch".
                */}
                {!uploads.running && uploads.items.length > 0 && (
                  <p className="muted">
                    {uploads.done > 0 && `Added ${uploads.done} of ${uploads.items.length}. `}
                    {uploads.remaining > 0 &&
                      `${uploads.remaining} still to go — the connection dropped. Open the event and they will carry on from here. `}
                    {uploads.failed > 0 &&
                      `${uploads.failed} did not upload — open the event and add ${
                        uploads.failed === 1 ? 'it' : 'them'
                      } again. `}
                    {uploads.stale.length > 0 &&
                      `${uploads.stale.length} could not be read after the reload.`}
                  </p>
                )}

                <a className="button-like primary" href={`/event/${eventId}`}>
                  {uploads.done > 0 ? 'Open the event' : 'Add your photos'}
                </a>
                {picked.length === 0 && (
                  <p className="field-help" style={{ margin: 0 }}>
                    An empty event stays empty — yours are what tell everyone else
                    there is something to add to.
                  </p>
                )}
              </div>
            )}
          </form>

          {/*
            Hidden during the photo step. There is no link yet and nothing to
            do with one, and a panel about sending sitting beside "choose your
            photos" is an instruction for later competing with the one on
            screen now.
          */}
          {(step === 'details' || created) && (
            <aside className="aside">
              <div>
                <h2>Then send it</h2>
                <p className="field-help" style={{ margin: 0 }}>
                  The link is the whole invitation — no app to install, and
                  nothing to sign up for to look. Adding photos needs an account.
                </p>
              </div>

              <div className="aside-row">
                {/*
                  Before there is a link this says so rather than showing a
                  plausible-looking one. A greyed example someone might try to
                  copy is worse than an empty state.
                */}
                <span className="aside-link">{link ?? 'Your link appears here'}</span>
                {link && (
                  <button type="button" className="as-text" onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>

              {code && (
                <div>
                  <p className="field-label" style={{ marginBottom: 8 }}>
                    OR SAY IT OUT LOUD
                  </p>
                  <div className="aside-code">{code}</div>
                  <p className="field-help" style={{ marginTop: 8 }}>
                    For the person across the room whose phone you are not
                    holding.
                  </p>
                </div>
              )}

              <p className="aside-foot">
                On a phone you can pick people straight from your contacts. In a
                browser, paste it into the group chat — that is where everyone
                already is.
              </p>
            </aside>
          )}
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

/** The hints read as sentence fragments; this one starts a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
