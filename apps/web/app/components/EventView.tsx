'use client';

/**
 * Browse and contribute — screens 2 and 3 of design §3.
 *
 * The upload client is deliberately unglamorous but follows the rules in
 * design §8:
 *   - files stream straight into `fetch` bodies; nothing is read into memory,
 *     because one `arrayBuffer()` over a 200-file selection is a tab crash;
 *   - concurrency 3, because more hurts throughput on cellular;
 *   - progress is per-file, so a partial upload is partial photos, not zero;
 *   - the queue is persisted, so a reload resumes rather than restarts;
 *   - the UI says the tab has to stay open, because on iOS that is true and
 *     pretending otherwise loses people's photos.
 *
 * What changed here is the shape of the page around all that. It used to be a
 * static header, then a panel of upload prose, then a download panel, then the
 * grid — so on an event with two hundred photos the count, the download and
 * the picker were all above a screen and a half of pictures, and the answer to
 * "whose is this one?" was nowhere. Now the head is sticky and holds the three
 * things you reach for, the contributors are a filter, and the upload detail
 * is a collapsed block at the foot of the page where a progress report belongs
 * — near the end, not in front of the photographs.
 *
 * The mechanism is still in `useUploads`; what is here is the part someone
 * looks at.
 */

import { ago } from '@parea/cards';
import type { Message } from '@/messages';
import { ACCEPT_ATTRIBUTE, acceptedMime } from '@parea/upload';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SignIn, useSession } from './SignIn';
import { Menu } from './Menu';
import { Thread, ThreadSheet } from './Thread';
import { PhotoLightbox } from './PhotoLightbox';
import { ShareEvent } from './ShareEvent';
import { PhotoTile } from './PhotoTile';
import { useUploads } from './useUploads';
import { SiteFooter } from './SiteFooter';

type Photo = {
  id: string;
  /** Thumbnail, JPEG — the `<img>` fallback every browser can render. */
  src: string;
  /** The same thumbnail in every encoding that exists, best first (§11). */
  sources?: { type: string; src: string }[];
  /** Larger rendition, for the lightbox. */
  full: string;
  takenAt: string;
  mine: boolean;
  /** Which contributor chip this belongs to. Opaque — see `contributors.ts`. */
  by: string | null;
};

type Person = {
  key: string;
  name: string;
  photoCount: number;
  mine: boolean;
};

type Feed = {
  event: {
    id: string;
    name: string;
    uploadsOpen: boolean;
    canAdminister: boolean;
    groupId: string | null;
    groupName: string | null;
    /** The host's line under the name, if they wrote one. */
    caption: string | null;
    /** ISO, when the host said when it was. Captions the earlier section. */
    startsAt: string | null;
    /** People asking to come in, for a host. Zero for everybody else. */
    waiting: number;
    /** For the share panel. Everybody who can see the event can pass it on. */
    linkToken: string;
    /** The spoken code, when one is assigned. Null once it is released. */
    code: string | null;
    /** What the link does on arrival, so the share panel can say so. */
    accessPolicy: string;
    joinsOpen: boolean;
  };
  contributors: number;
  people: Person[];
  /** The event's thread, seeded server-side like the photos. */
  messages: Message[];
  /** Whether this viewer may post — `contribute`, and signed in. */
  canPost: boolean;
  /** Uploaded and not yet through the deriver — anybody's, not just this tab's. */
  arriving: number;
  count: number;
  photos: Photo[];
};

/**
 * How many 4-second polls to spend waiting on ingest after the last upload.
 *
 * Two minutes. Long enough for a big batch to come through the deriver, short
 * enough that a tab left open on a broken one is not still asking at midnight.
 */
const INGEST_POLLS = 30;

export function EventView({ eventId, initial }: { eventId: string; initial: Feed }) {
  const [feed, setFeed] = useState<Feed>(initial);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<Photo | null>(null);
  /** How many of the last selection were not photos. */
  const [skipped, setSkipped] = useState(0);
  /** Which contributor's photos to show. Null is everyone. Client-only. */
  const [only, setOnly] = useState<string | null>(null);
  /**
   * Picking photos, and which ones.
   *
   * Null is not picking at all, which is a different state from picking none —
   * the grid only grows checkboxes in the first case, and the bar at the foot
   * only appears in the second. The endpoint has taken a `photoIds` selection
   * since it was written ("a selection can be hundreds of ids"); this is the
   * screen that finally sends one.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  /** The share panel, which is what somebody who cannot manage gets instead. */
  const [sharing, setSharing] = useState(false);

  /*
   * Whether the thread column is showing, remembered per browser.
   *
   * Somebody who folds it away wants the photographs wider, and wanting that
   * once is wanting it on the next event too — so the choice outlives the
   * page. Default open, and read after mount rather than during render:
   * touching `localStorage` while rendering makes the server's HTML and the
   * client's disagree, which throws the whole tree away.
   *
   * Nothing to do with the sheet. Below the breakpoint the column is hidden by
   * the stylesheet regardless, and the head's Thread button opens the sheet.
   */
  const [threadOpen, setThreadOpen] = useState(true);
  useEffect(() => {
    try {
      setThreadOpen(localStorage.getItem('pa_thread_folded') !== '1');
    } catch {}
  }, []);

  const foldThread = useCallback((open: boolean) => {
    setThreadOpen(open);
    try {
      localStorage.setItem('pa_thread_folded', open ? '0' : '1');
    } catch {}
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useSession();

  /*
   * What was already here when this page opened.
   *
   * "Just added" means *since you have been looking*, which is the only
   * definition that makes the section worth having — a photo uploaded an hour
   * before you arrived is not news to you, however recent its timestamp. A ref
   * rather than state because it must never change: recomputing it on a
   * refresh would empty the section a moment after filling it.
   */
  const atArrival = useRef(new Set(initial.photos.map((photo) => photo.id)));

  /*
   * When this person last read the thread, per event.
   *
   * In `localStorage` rather than on the server, and that is a deliberate
   * limit rather than a shortcut: a read receipt on the server is a record of
   * when somebody looked at something, which is a fact about a person this
   * product has no other reason to keep. The cost is that the count is
   * per-browser — a laptop and a phone each get their own idea of unread —
   * which is the right side of that trade for a badge on a message list.
   *
   * Read once into state so the first render matches the server's, then moved
   * forward when the thread is actually seen. Reading it during render would
   * make the server and client HTML disagree and hydrate to a mismatch.
   */
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const seenKey = `pa_thread_seen_${eventId}`;
  useEffect(() => {
    try {
      setLastSeen(localStorage.getItem(seenKey));
    } catch {
      // Private browsing, or storage turned off. Everything reads as unread,
      // which is wrong in the harmless direction.
    }
  }, [seenKey]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeen(now);
    try {
      localStorage.setItem(seenKey, now);
    } catch {}
  }, [seenKey]);

  /** Somebody else's, since you last looked. Your own are never unread. */
  const unread = feed.messages.filter(
    (m) => !m.author.mine && !m.deleted && (!lastSeen || m.createdAt > lastSeen),
  ).length;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/photos`);
    if (res.ok) setFeed(await res.json());
  }, [eventId]);

  const uploads = useUploads(eventId, refresh);

  /*
   * Photos appear as ingest finishes, which is seconds behind the upload.
   *
   * Keyed on anything being in flight, not on this tab being the one sending
   * it. Polling only while `uploads.running` was enough when the page said
   * nothing about photos it could not yet show; it stopped being enough the
   * moment the head grew "12 arriving", because the last upload finishes
   * *before* the last photo is ready — so the pill would sit there claiming
   * something was coming, and nothing would ever come until a reload. It also
   * never picked up somebody else's upload, which is most of them.
   *
   * Bounded, because "arriving" is a claim about work somewhere else and that
   * work can fail: a photo whose deriver died stays pending forever, and an
   * unbounded poll would be a tab quietly asking a server for news for as long
   * as it is left open. After this many tries it stops and a reload is the
   * remedy — which is the honest position, since by then something is wrong.
   */
  useEffect(() => {
    if (!uploads.running && feed.arriving === 0) return;

    let tries = 0;
    const timer = setInterval(() => {
      if (!uploads.running && ++tries > INGEST_POLLS) {
        clearInterval(timer);
        return;
      }
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [uploads.running, feed.arriving, refresh]);

  const pick = useCallback(
    async (picked: File[]) => {
      /*
       * `accept` on the input is advice, not a rule — a drop, or "All Files"
       * in the OS dialog, gets past it. The presign endpoint refuses the whole
       * request if any one file is unacceptable, so without this a single
       * video dropped alongside two hundred photos loses all two hundred.
       *
       * An empty `type` is not a rejection. Browsers routinely fail to type a
       * HEIC, and the deriver reads the real format out of the bytes anyway;
       * refusing those would turn "we could not guess" into "you may not
       * upload your iPhone photos".
       */
      const usable = picked.filter(
        (file) => file.type === '' || acceptedMime(file.type) !== null,
      );
      setSkipped(picked.length - usable.length);

      if (usable.length > 0) await uploads.add(usable);
      if (inputRef.current) inputRef.current.value = '';
    },
    [uploads],
  );

  const download = useCallback(
    async (format: 'original' | 'jpeg', photoIds?: string[]) => {
      setDownloading(true);
      setDownloadError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/download`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ format, photoIds }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(explainDownloadFailure(body));
        }
        const { url } = (await res.json()) as { url: string };
        // A plain navigation, so the browser or OS owns the download: real
        // progress, a real filename, and no tab that has to stay open.
        window.location.href = url;
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : String(err));
      } finally {
        setDownloading(false);
      }
    },
    [eventId],
  );

  /*
   * Filtering is subtractive, always. It narrows what is drawn out of what the
   * server already decided this person may see — it never asks for more, and
   * an unknown key shows nothing rather than everything.
   */
  const visible = useMemo(
    () => (only === null ? feed.photos : feed.photos.filter((p) => p.by === only)),
    [feed.photos, only],
  );

  const fresh = visible.filter((photo) => !atArrival.current.has(photo.id));
  const earlier = visible.filter((photo) => atArrival.current.has(photo.id));

  const togglePick = useCallback((id: string) => {
    setPicked((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const mine = feed.people.find((person) => person.mine) ?? null;
  const others = feed.people.filter((person) => !person.mine);

  return (
    /*
      One element, because `Shell` drops its children straight into the flex
      row beside the rail. A fragment here made the head and the body two flex
      items *next to each other* — the rail, then a column of headings, then a
      narrow column of photographs, side by side. It looked like a stylesheet
      failure and was a markup one.
    */
    <main className="event">
      {/*
        Sticky, and the reason is the grid underneath it. Two hundred photos is
        several screens, and the count, the download and the picker were all
        above them — which is to say, gone. Translucent with a blur behind it
        so the photographs scrolling under it are still visibly photographs.
      */}
      <header className="event-head">
        <div className="event-head-text">
          <h1>{feed.event.name}</h1>
          {/*
            The host's own line, above the counts rather than below them: it
            says what the evening was, and the counts say how much of it there
            is. One line, ellipsised — the head is a bar, not a paragraph.
          */}
          {feed.event.caption && (
            <p className="event-caption">{feed.event.caption}</p>
          )}
          <p className="muted">
            {feed.count} {feed.count === 1 ? 'photo' : 'photos'} from{' '}
            {feed.contributors} {feed.contributors === 1 ? 'person' : 'people'}
            {feed.event.groupId && (
              <>
                {' · '}
                <a href={`/group/${feed.event.groupId}`}>{feed.event.groupName}</a>
              </>
            )}

          </p>
        </div>

        {/*
          Everybody's uploads, not this tab's. The number that matters to
          somebody looking at a half-full grid is how much more is coming, and
          most of it is usually not theirs.
        */}
        {feed.arriving > 0 && (
          <span className="arriving">
            <span className="arriving-dot" aria-hidden="true" />
            {feed.arriving} arriving
          </span>
        )}

        {/*
          The thread, on a phone. The column beside the grid is hidden below
          the breakpoint, so this is how the same conversation is reached — and
          it carries the unread count, which the column does not need because
          the column is already on screen.

          It went missing when the head was rebuilt as two menus, which left a
          phone with no route to the thread at all. Nothing failed; the control
          simply was not there, and the desktop layout it was tested on hides
          it anyway.
        */}
        <ThreadSheet
          eventId={eventId}
          messages={feed.messages}
          canPost={feed.canPost}
          people={feed.people}
          onChanged={refresh}
          unread={unread}
          onOpened={markSeen}
        />

        {/*
          Share, add, everything else.

          The head used to be a pill, a Download button and a filled Add photos
          button, which is three things competing at the top of a page whose
          subject is underneath them. It became a `+` and a `···`, and this is
          the one thing worth lifting back out of the menu: sending the link is
          what an album is *for*, and it was two presses behind a glyph that
          means "other". It draws for everybody, because everybody who can see
          an event can pass it on — the same rule the menu item had.
        */}
        <button
          type="button"
          className="head-action"
          aria-label="Share this event"
          onClick={() => setSharing(true)}
        >
          {/*
            A box with something leaving it. The three-dots-and-two-lines
            share glyph is Android's and reads as a diagram; this one is what
            the phone in most people's hand draws.
          */}
          <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true">
            <path
              d="M10 13V3.5M10 3.5 6.75 6.75M10 3.5l3.25 3.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 9.5H4.25a.75.75 0 0 0-.75.75v5.5a.75.75 0 0 0 .75.75h11.5a.75.75 0 0 0 .75-.75v-5.5a.75.75 0 0 0-.75-.75H15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {feed.event.uploadsOpen && session.account && (
          <Menu label="Add to this event" glyph="+" tone="primary">
            {(close) => (
              <>
                {/*
                  A label, not a button that calls `.click()`. A label *is* the
                  control for the input it names, so keyboard, pointer and
                  screen reader all work with nothing scripted — and the input
                  itself lives outside the menu, because a menu that unmounts
                  on choose would take the file dialog's own input with it.
                */}
                {/*
                  `aria-disabled`, never `disabled` — a label has no such
                  attribute and setting one is inert. The real disabling is on
                  the input; this is so the item does not look pressable while a
                  batch is running, which it would otherwise do while quietly
                  doing nothing.
                */}
                <label
                  htmlFor="add-photos"
                  aria-disabled={uploads.running || undefined}
                  onClick={close}
                >
                  {uploads.running ? 'Adding…' : 'Add photos'}
                </label>
                {feed.event.groupId && (
                  <a href={`/?group=${feed.event.groupId}`}>
                    New event in {feed.event.groupName}
                  </a>
                )}
              </>
            )}
          </Menu>
        )}

        {/*
          A count on the menu itself, because what is behind it is the only
          place these can be answered — and somebody waiting to be let into an
          evening is waiting on a host who has no other reason to open Manage.
        */}
        <Menu
          label={
            feed.event.waiting > 0
              ? `This event — ${feed.event.waiting} waiting`
              : 'This event'
          }
          glyph="···"
          badge={feed.event.waiting}
        >
          {(close) => (
            <>
              {/*
                Settings, for the people who have any. Sharing used to live at
                the bottom of this menu and is now its own button in the head,
                so this list is only the things that are not sharing.
              */}
              {feed.event.canAdminister && (
                <a href={`/event/${eventId}/manage`}>
                  Manage event
                  {feed.event.waiting > 0 && (
                    <span className="badge">{feed.event.waiting}</span>
                  )}
                </a>
              )}
              {feed.photos.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      close();
                      setPicked(new Set());
                    }}
                  >
                    Select images
                  </button>
                  <button
                    disabled={downloading}
                    onClick={() => {
                      close();
                      void download('original');
                    }}
                  >
                    {downloading ? 'Preparing…' : 'Download all'}
                  </button>
                  <button
                    disabled={downloading}
                    onClick={() => {
                      close();
                      void download('jpeg');
                    }}
                  >
                    Download all as JPEG
                  </button>
                </>
              )}
            </>
          )}
        </Menu>
        {feed.event.uploadsOpen && session.account && (
          <input
            id="add-photos"
            className="visually-hidden"
            ref={inputRef}
            type="file"
            multiple
            // The same list the presign endpoint enforces, spelled out rather
            // than an image wildcard. The wildcard is a superset — it offers
            // TIFF, BMP and SVG, which the server then refuses, and one refusal
            // fails the whole batch rather than the one file.
            //
            // Written without the literal wildcard token on purpose: it
            // contains a block-comment opener, and a source-scanning test that
            // strips comments will swallow this attribute along with it. That
            // is not hypothetical — see test/accepted-types.test.ts.
            accept={ACCEPT_ATTRIBUTE}
            disabled={uploads.running}
            onChange={(e) => pick(Array.from(e.target.files ?? []))}
          />
        )}
      </header>

      <div className="event-split">
        <div className="event-body">
        {feed.event.uploadsOpen && session.known && !session.account && (
          // Adding names who added. Shown here rather than behind a link to
          // /account, because being sent away mid-task loses the picker they
          // were about to use — and on a phone, the photos they had chosen.
          <SignIn
            why="Adding photos needs an account. Looking does not — you can carry on browsing without one."
            onSignedIn={session.refresh}
          />
        )}

        {/*
          Said out loud, because the alternative is a count that silently does
          not match what was chosen. Photos only is a real limitation and worth
          naming as one rather than letting someone conclude the upload dropped
          their video.
        */}
        {skipped > 0 && (
          <p className="muted">
            {skipped === 1 ? '1 file was' : `${skipped} files were`} not added —
            Parea takes photos, not video or other files.
          </p>
        )}

        {/*
          One chip per contributor. Only over photographs this person can
          already see: the feed was filtered before it left the server, so
          somebody blocked has no chip and no total — they are not hidden from
          the list, they were never in it.
        */}
        {feed.people.length > 1 && (
          <div className="chips" role="group" aria-label="Whose photos to show">
            <Chip
              label="Everyone"
              count={feed.count}
              on={only === null}
              onPick={() => setOnly(null)}
            />
            {others.map((person) => (
              <Chip
                key={person.key}
                label={person.name}
                count={person.photoCount}
                face={person.name}
                on={only === person.key}
                onPick={() => setOnly(person.key)}
              />
            ))}
            {mine && (
              // Last, and called "Mine" rather than by name: on your own
              // screen you are not one of the six people, you are the one
              // looking at them.
              <Chip
                label="Mine"
                count={mine.photoCount}
                on={only === mine.key}
                onPick={() => setOnly(mine.key)}
              />
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="muted empty">
            {feed.photos.length === 0
              ? 'Nothing here yet. Add yours and everyone else will see there is something to add to.'
              : 'None of theirs are here.'}
          </p>
        ) : (
          <>
            {/*
              Only when there is something in it. A section head reading "JUST
              ADDED" over an empty grid, or an "EARLIER" label on a page where
              nothing is recent, is furniture describing a state that is not
              happening — so when nothing has arrived since you got here, this
              is one plain grid, as it always was.
            */}
            {fresh.length > 0 && (
              <Section
                label="JUST ADDED"
                caption={freshCaption(fresh, feed.people)}
                photos={fresh}
                highlight
                picked={picked}
                onPick={togglePick}
                onOpen={setOpenPhoto}
              />
            )}
            {earlier.length > 0 &&
              (fresh.length > 0 ? (
                <Section
                  label="EARLIER"
                  caption={earlierCaption(feed.event.startsAt, earlier)}
                  photos={earlier}
                  picked={picked}
                  onPick={togglePick}
                  onOpen={setOpenPhoto}
                />
              ) : (
                <Grid
                  photos={earlier}
                  picked={picked}
                  onPick={togglePick}
                  onOpen={setOpenPhoto}
                />
              ))}
          </>
        )}

        {/*
          The bar for a selection, at the foot of the body rather than floating
          over the grid: it appears when the mode starts and it says how to
          leave, because while it is up a tile picks instead of opening — and
          the lightbox is where the reporting actions are.
        */}
        {picked && (
          <div className="picking">
            <span className="picking-count">
              {picked.size === 0
                ? 'Pick the ones you want'
                : `${picked.size} selected`}
            </span>
            <button
              disabled={picked.size === 0 || downloading}
              onClick={() => download('original', [...picked])}
            >
              {downloading ? 'Preparing…' : 'Download these'}
            </button>
            <button
              className="secondary"
              disabled={picked.size === 0 || downloading}
              onClick={() => download('jpeg', [...picked])}
            >
              As JPEG
            </button>
            <button className="secondary" onClick={() => setPicked(null)}>
              Done
            </button>
          </div>
        )}

        {downloadError && <p className="muted">{downloadError}</p>}

        {/*
          At the foot, and folded away. It is a progress report: worth being
          able to open, never worth sitting between somebody and the pictures.
        */}
        <Uploads uploads={uploads} onPick={() => inputRef.current?.click()} />

          <SiteFooter />
        </div>

        {/*
          The column, beside the grid. Below the breakpoint the stylesheet
          hides it and the head's `ThreadSheet` takes over — one thread, two
          shapes, no resize listener deciding which.
        */}
        {/*
          The way back, in the place it left from.

          It was a chip in the head, three controls away — so folding the
          column and unfolding it were two different gestures in two different
          corners. Here it lands under the same finger: same distance from the
          right edge, same distance below the head, so the pair reads as one
          switch rather than two buttons that happen to be opposites.
        */}
        {!threadOpen && (
          <button
            className="thread-unfold"
            aria-label="Show the thread"
            onClick={() => foldThread(true)}
          >
            {'\u2039'}
            {unread > 0 && <span className="thread-unread">{unread}</span>}
          </button>
        )}

        {threadOpen && (
          <Thread
            eventId={eventId}
            messages={feed.messages}
            canPost={feed.canPost}
            people={feed.people}
            onChanged={refresh}
            onSeen={markSeen}
            onCollapse={() => foldThread(false)}
          />
        )}
      </div>

      {/*
        In front of everything, not in the flow. It was a panel at the foot of
        the body, which put it under the whole grid — so choosing it from a
        menu in the sticky head looked like nothing had happened.
      */}
      {sharing && (
        <ShareEvent
          linkToken={feed.event.linkToken}
          code={feed.event.code}
          accessPolicy={feed.event.accessPolicy}
          joinsOpen={feed.event.joinsOpen}
          onClose={() => setSharing(false)}
        />
      )}

      {openPhoto && (
        <PhotoLightbox
          photo={openPhoto}
          eventId={eventId}
          messages={feed.messages}
          canPost={feed.canPost}
          onClose={() => setOpenPhoto(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}

/** One contributor filter. A button, because it changes what is on screen. */
function Chip({
  label,
  count,
  face,
  on,
  onPick,
}: {
  label: string;
  count: number;
  face?: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button className="chip" aria-pressed={on} onClick={onPick}>
      {face && (
        <span className="chip-face" aria-hidden="true">
          {face.replace(/^@/, '').slice(0, 1).toUpperCase()}
        </span>
      )}
      {label} · {count}
    </button>
  );
}

function Section({
  label,
  caption,
  photos,
  highlight,
  picked,
  onPick,
  onOpen,
}: {
  label: string;
  caption: string | null;
  photos: Photo[];
  highlight?: boolean;
  picked: Set<string> | null;
  onPick: (id: string) => void;
  onOpen: (photo: Photo) => void;
}) {
  return (
    <section>
      <div className="section-head">
        <strong>{label}</strong>
        {caption && <span>{caption}</span>}
      </div>
      <Grid
        photos={photos}
        highlight={highlight}
        picked={picked}
        onPick={onPick}
        onOpen={onOpen}
      />
    </section>
  );
}

function Grid({
  photos,
  highlight,
  picked,
  onPick,
  onOpen,
}: {
  photos: Photo[];
  highlight?: boolean;
  /** Null when not selecting. A tile opens the lightbox; otherwise it picks. */
  picked: Set<string> | null;
  onPick: (id: string) => void;
  onOpen: (photo: Photo) => void;
}) {
  return (
    <div className="grid">
      {/*
        Every photo is a way in to the safety actions, which is why the tile
        stays a button even when its thumbnail will not load — guideline 1.2
        wants reporting reachable, not merely implemented.
      */}
      {photos.map((photo) => (
        <PhotoTile
          key={photo.id}
          src={photo.src}
          sources={photo.sources}
          className={[
            highlight ? 'tile-new' : '',
            picked?.has(photo.id) ? 'tile-picked' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined}
          // While selecting, a tile picks rather than opens. The lightbox is
          // where the safety actions live, so this is the one mode in which
          // they are a mode away — which is why the bar at the foot says how
          // to leave it.
          selected={picked ? picked.has(photo.id) : undefined}
          onOpen={() => (picked ? onPick(photo.id) : onOpen(photo))}
        />
      ))}
    </div>
  );
}

/**
 * The upload block: what is happening, per file, folded away.
 *
 * One honest omission. The design asks for a percentage against each file, and
 * the queue does not have one — `Deps.upload` is a single `fetch` PUT with the
 * `File` as its body, and `fetch` reports nothing about a request body as it
 * goes. So each row shows the state the queue actually knows, and the bar that
 * does move is the one across the whole batch, which is a real fraction of
 * real files. Inventing per-file percentages would mean animating a number
 * nothing measured.
 */
function Uploads({
  uploads,
  onPick,
}: {
  uploads: ReturnType<typeof useUploads>;
  onPick: () => void;
}) {
  /*
   * Open while it is working or while something needs a decision; closed once
   * it is done and nothing is wrong. `null` means "nobody has said", so
   * somebody who folds it away mid-batch keeps it folded away — the automatic
   * rule is a starting position, not a hand on the lid.
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const needsAttention = uploads.stale.length > 0 || uploads.failed > 0;
  const open = choice ?? (uploads.running || needsAttention);

  if (uploads.items.length === 0) return null;

  const total = uploads.items.length;
  const done = uploads.done;

  return (
    <details
      className="uploads"
      open={open}
      onToggle={(e) => setChoice((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="uploads-mark" aria-hidden="true">
          ▾
        </span>
        <span className="uploads-title">
          <strong>
            {uploads.running
              ? `Adding ${total} ${total === 1 ? 'photo' : 'photos'} · ${done} done`
              : `Added ${done} of ${total}`}
          </strong>
          <span className="muted">
            {uploads.running
              ? 'Keep this tab open. A reload carries on from here.'
              : needsAttention
                ? 'Some of these need another look.'
                : 'Finished.'}
          </span>
        </span>
        <span className="bar" aria-hidden="true">
          <span
            className={`bar-fill${uploads.running ? ' bar-moving' : ''}`}
            style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
          />
        </span>
        <span className="uploads-left">
          {uploads.remaining > 0 ? `${uploads.remaining} to go` : 'done'}
        </span>
      </summary>

      <div className="uploads-list">
        {uploads.resumed && (
          <p className="muted">
            Picking up where the last tab left off.{' '}
            <button className="link" onClick={() => uploads.discard()}>
              Start over instead
            </button>
          </p>
        )}

        {uploads.items.map((item) => (
          <div className="upload" key={item.id}>
            <span
              className={item.status === 'stale' ? 'upload-dead' : 'upload-thumb'}
              aria-hidden="true"
            >
              {item.status === 'stale' ? '!' : ''}
            </span>
            <span className="upload-text">
              <span className="upload-name">{item.name}</span>
              {item.status === 'stale' ? (
                /*
                  Not an error, a request. These bytes were held by a tab that
                  is gone and the browser will not hand them over again —
                  nothing retries them into existence, so "failed" would send
                  somebody to a button that cannot work.
                */
                <span className="muted">
                  Could not be read after the reload — your browser only lends a
                  file to the tab that picked it.
                </span>
              ) : (
                <span className="upload-bar" aria-hidden="true">
                  <span
                    className="upload-bar-fill"
                    style={{ width: `${fractionOf(item.status)}%` }}
                  />
                </span>
              )}
            </span>
            {item.status === 'stale' ? (
              <button className="secondary small" onClick={onPick}>
                Pick again
              </button>
            ) : (
              <span className="upload-state">{stateOf(item.status)}</span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * How far along one file is, as far as anything actually knows.
 *
 * Three real steps, not a percentage: queued, sent, and confirmed by the
 * server. The bar moves in thirds because that is the resolution the queue
 * has — see the note on `Uploads`.
 */
function fractionOf(status: string): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'presigned':
      return 15;
    case 'uploaded':
      return 70;
    case 'done':
      return 100;
    default:
      return 0;
  }
}

function stateOf(status: string): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'presigned':
    case 'uploaded':
      return 'Sending';
    case 'done':
      return 'Added';
    case 'failed':
      return 'Failed';
    default:
      return '';
  }
}

/** "Maya, a minute ago" — who added the newest of these, and when. */
function freshCaption(photos: Photo[], people: Person[]): string | null {
  const newest = photos[photos.length - 1];
  if (!newest) return null;
  const who = people.find((person) => person.key === newest.by);
  const when = ago(new Date(newest.takenAt), new Date());
  return who ? `${who.mine ? 'You' : who.name}, ${when}` : when;
}

/**
 * When the earlier ones are from.
 *
 * The event's own window if the host set one, because that is the answer a
 * person would give; the first photograph's timestamp otherwise, which is the
 * best guess available and is sometimes wrong — six phones disagree about the
 * time and iOS Safari strips EXIF on upload (design §8).
 */
function earlierCaption(startsAt: string | null, photos: Photo[]): string | null {
  const from = startsAt ?? photos[0]?.takenAt ?? null;
  if (!from) return null;
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString(undefined, { weekday: 'long' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time} onwards`;
}

/**
 * The two 409s mean different things and want different next steps.
 *
 * `not_ready` resolves by waiting. `jpeg_unavailable` does not — those photos
 * were derived before the archive path needed their sizes, and nothing gets
 * regenerated by asking again — so the useful answer is the other button.
 */
function explainDownloadFailure(body: { error?: string; pending?: number; missing?: number }) {
  switch (body.error) {
    case 'not_ready':
      return `${body.pending} photo(s) are still being processed. Try again in a moment.`;
    case 'jpeg_unavailable':
      return `${body.missing} photo(s) have no JPEG version. Download the originals instead.`;
    default:
      return 'Could not start the download.';
  }
}
