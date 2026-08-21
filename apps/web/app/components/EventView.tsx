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
import { Thread } from './Thread';
import { ShareEvent } from './ShareEvent';
import { PhotoTile } from './PhotoTile';
import type { Member, Roster } from '@/members';

import { Face, Faces } from './Faces';
import { Mark } from './Mark';
import { useUploads } from './useUploads';

/** Faces in the head before the count takes over. Three, as on the cards. */
const HEAD_FACES = 4;
import { SiteFooter } from './SiteFooter';

type Photo = {
  id: string;
  /** Thumbnail, JPEG — the `<img>` fallback every browser can render. */
  src: string;
  /** The same thumbnail in every encoding that exists, best first (§11). */
  sources?: { type: string; src: string }[];
  /** 320 and 1280 as one `srcset`, so a tile is not drawn from a 320. */
  srcSet?: string | null;
  srcSetAvif?: string | null;
  /** Larger rendition, for the photo page and the download chip. */
  full: string;
  takenAt: string;
  /** Pixels, as the deriver read them. Null before it has. See the page. */
  width: number | null;
  height: number | null;
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
    /** Where it was, if the host said. Null draws nothing. */
    place: string | null;
    /** When it was last added to, worded by the server. See the route. */
    added: string;
  };
  contributors: number;
  /** Everybody in it: the faces in the header. */
  members: Member[];
  /** The People tab: everybody, with what they put in, plus who was asked. */
  roster: Roster[];
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

/** The three panes, in the order the header draws them. */
const TABS = [
  ['photos', 'Photos'],
  /*
   * "Thread", and the route is still `?tab=conversation`.
   *
   * The same split the rail makes between what a row is called and where it
   * goes: renaming the id would break every link anybody has already sent to
   * an event's conversation, and the word on screen is free to change without
   * that. Thread is what people call this — a run of messages about one thing
   * — and it is a shorter word in a row of three.
   */
  ['conversation', 'Thread'],
  ['people', 'People'],
] as const;

export type EventTab = (typeof TABS)[number][0];

/**
 * One line of facts about the evening.
 *
 * The date first, and it is the event's own: `startsAt` when the host said
 * when it was, else the earliest photograph, else nothing. It used to be a
 * relative time — "3 days ago" — which answers when it was last *added to*,
 * a fact about the upload rather than about the night.
 *
 * The place reads as a phrase rather than a tag: "At home" rather than a pin
 * glyph and a word, because it is free text a host typed and the sentence it
 * belongs in is this one.
 */
function metaLine(feed: Feed): string {
  const parts: string[] = [];
  const day = feed.event.startsAt ?? feed.photos[0]?.takenAt ?? null;
  if (day) {
    parts.push(
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(day)),
    );
  }
  if (feed.event.place) parts.push(`At ${feed.event.place}`);
  const people = feed.members.length;
  parts.push(`${people} ${people === 1 ? 'person' : 'people'}`);
  parts.push(`${feed.count} ${feed.count === 1 ? 'photo' : 'photos'}`);
  return parts.join(' · ');
}

export function EventView({
  eventId,
  tab,
  initial,
}: {
  eventId: string;
  /** Which pane, from the URL — so a link to the roster is a link. */
  tab: EventTab;
  initial: Feed;
}) {
  const [feed, setFeed] = useState<Feed>(initial);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /** How many of the last selection were not photos. */
  const [skipped, setSkipped] = useState(0);
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
   * The host, and the first few faces beside them.
   *
   * `membersOf` puts the creator first, so the head's own picture is
   * `members[0]` and the row beside the name is everybody else — the same
   * person twice on one bar reads as two people.
   */
  const host = feed.members.find((m) => m.isCreator);
  /*
   * Everybody, host first — not "the guests".
   *
   * The row used to draw the people *other than* the host, because the host's
   * own picture was a 38px circle beside the title. That circle is gone: the
   * header names them in words instead ("Created by Demetri"), so a row that
   * still skipped them was an event with four people in it showing three faces.
   */
  const faces = [
    ...(host ? [host] : []),
    ...feed.members.filter((m) => !m.isCreator),
  ];
  const shown = faces.slice(0, HEAD_FACES).map((m) => m.avatarUrl);

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

  const visible = feed.photos;
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
      {/*
        The header, and what it stopped being.

        It was a sticky bar with the host's picture beside the name, `@handle ·
        caption` on its own line, a row of faces with the place and a relative
        time, and three glyphs. Two of those were doing the event's job badly:
        the relative time answered "when was this added to" where somebody
        wants to know when the evening *was*, and the handle belongs to a
        person rather than to their event — it lives on People and on profiles.

        Now: the name, one line of facts about the evening, who is in it, and
        the host's own line if they wrote one. The actions say what they do in
        words rather than in glyphs, because a filled `+` and a `···` at the
        top of a page make somebody guess twice.
      */}
      <header className="event-head">
        <div className="event-head-row">
          {/* The way back, as a glyph and a hit area rather than a word: it is
              the one control here that is about the page rather than about the
              event. */}
          <a href="/events" className="event-back" aria-label="Back to your events">
            {'\u2039'}
          </a>

          <div className="event-head-text">
            <h1>{feed.event.name}</h1>

            {/*
              One line of facts about the evening, in the order somebody asks
              them: when it was, where, who, how much. The date is the event's
              own — `startsAt`, or the first photograph — never "3 days ago",
              which is a fact about the upload.

              This is the only place the photograph count appears on screen.
              It used to sit above the grid, which is the one place it did not
              need saying.
            */}
            <p className="event-meta">{metaLine(feed)}</p>

            <p className="event-who">
              <Faces avatars={shown} size={24} />
              {faces.length > shown.length && (
                <span className="event-more">+{faces.length - shown.length}</span>
              )}
              {host && (
                <span className="event-by">
                  Created by <span className="event-by-name">{host.name}</span>
                </span>
              )}
              {feed.event.groupId && (
                <a href={`/group/${feed.event.groupId}`}>{feed.event.groupName}</a>
              )}
            </p>

            {/* The host's own line. A description of the evening, on a line of
                its own — never appended to the title, where it read as part of
                the name. */}
            {feed.event.caption && (
              <p className="event-said">{feed.event.caption}</p>
            )}
          </div>

          <div className="event-actions">
            {feed.event.uploadsOpen && session.account && (
              /*
                A label, not a button that calls `.click()`. A label *is* the
                control for the input it names, so keyboard, pointer and screen
                reader all work with nothing scripted. `aria-disabled` rather
                than `disabled`, which a label does not have: the real
                disabling is on the input, and this is so it does not look
                pressable while a batch is running.
              */
              <label
                htmlFor="add-photos"
                className="button-like primary event-add"
                aria-disabled={uploads.running || undefined}
              >
                {uploads.running ? 'Adding…' : 'Add photos'}
              </label>
            )}

            {/*
              Words on a wide screen, and folded into the `···` on a phone —
              see the pair of `wide-only` / `narrow-only` classes. Four controls
              beside a title on a 390px screen leaves the title nowhere to go,
              and the one that has to stay visible is the one this page is for.
            */}
            <button
              type="button"
              className="event-invite wide-only"
              onClick={() => setSharing(true)}
            >
              Invite
            </button>

            {feed.photos.length > 0 && (
              <Menu label="Download" glyph={'\u2193'} tone="quiet" className="wide-only">
                {(close) => (
                  <>
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
                    <button
                      onClick={() => {
                        close();
                        setPicked(new Set());
                      }}
                    >
                      Select images
                    </button>
                  </>
                )}
              </Menu>
            )}

            {/*
              A count on the menu itself, because what is behind it is the only
              place these can be answered — and somebody waiting to be let into
              an evening is waiting on a host who has no other reason to open
              Manage.
            */}
            <Menu
              label={
                feed.event.waiting > 0
                  ? `This event — ${feed.event.waiting} waiting`
                  : 'This event'
              }
              glyph="···"
              tone="quiet"
              badge={feed.event.waiting}
            >
              {(close) => (
                <>
                  {/*
                    The two controls the header stops showing on a phone. Both
                    are `display: none` above the breakpoint, which takes them
                    out of the accessibility tree as well — so a wide screen has
                    them as buttons and a narrow one has them here, and neither
                    has both.
                  */}
                  <button
                    className="narrow-only"
                    onClick={() => {
                      close();
                      setSharing(true);
                    }}
                  >
                    Invite
                  </button>
                  {feed.photos.length > 0 && (
                    <>
                      <button
                        className="narrow-only"
                        disabled={downloading}
                        onClick={() => {
                          close();
                          void download('original');
                        }}
                      >
                        {downloading ? 'Preparing…' : 'Download all'}
                      </button>
                      <button
                        className="narrow-only"
                        disabled={downloading}
                        onClick={() => {
                          close();
                          void download('jpeg');
                        }}
                      >
                        Download all as JPEG
                      </button>
                      <button
                        className="narrow-only"
                        onClick={() => {
                          close();
                          setPicked(new Set());
                        }}
                      >
                        Select images
                      </button>
                    </>
                  )}
                  {feed.event.canAdminister ? (
                    <a href={`/event/${eventId}/manage`} onClick={close}>
                      Manage event
                      {feed.event.waiting > 0 && (
                        <span className="badge">{feed.event.waiting}</span>
                      )}
                    </a>
                  ) : (
                    <a href="/safety" onClick={close}>
                      Safety and reporting
                    </a>
                  )}
                </>
              )}
            </Menu>
          </div>
        </div>

        {/*
          Three tabs, and the state is the URL.

          It was a column of conversation beside the photographs, taking a
          third of the width on every screen whether anybody was talking or
          not, plus a sheet on a phone — one thread in two shapes. A tab is one
          shape, and `?tab=` means a link to the roster is a link somebody can
          send and Back is the way out of it.
        */}
        <nav className="event-tabs" aria-label="This event">
          {TABS.map(([id, label]) => (
            <a
              key={id}
              href={id === 'photos' ? `/event/${eventId}` : `/event/${eventId}?tab=${id}`}
              className={`event-tab${tab === id ? ' event-tab-on' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
            >
              {label}
              {id === 'conversation' && unread > 0 && (
                <span className="event-tab-count">{unread}</span>
              )}
            </a>
          ))}
        </nav>

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

      {tab === 'photos' && (
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
            Said out loud, because the alternative is a count that silently
            does not match what was chosen. Photos only is a real limitation
            and worth naming as one rather than letting somebody conclude the
            upload dropped their video.
          */}
          {skipped > 0 && (
            <p className="muted">
              {skipped === 1 ? '1 file was' : `${skipped} files were`} not added
              — Parea takes photos, not video or other files.
            </p>
          )}

          {/*
            Only when there is something in it. A section head reading "JUST
            ADDED" over an empty gallery is furniture describing a state that
            is not happening, so when nothing has arrived since you got here
            this is one gallery, as it always was.
          */}
          {fresh.length > 0 && (
            <>
              <SectionHead
                label="Just added"
                caption={freshCaption(fresh, feed.people)}
                arriving={feed.arriving}
              />
              <Masonry
                photos={fresh}
                eventId={eventId}
                picked={picked}
                onPick={togglePick}
                people={feed.people}
                lead={null}
              />
              <SectionHead label="Earlier" caption={earlierCaption(feed.event.startsAt, earlier)} />
            </>
          )}

          {/*
            The gallery, with the contribute tile first.

            First even when the event is full: it is the affordance, not a
            result, and an event that fills up is exactly the one whose next
            photograph is easiest to forget to add. It is the same control as
            the header button — a label over the same input — so there is one
            file dialog and one disabled state.
          */}
          <Masonry
            photos={fresh.length > 0 ? earlier : visible}
            eventId={eventId}
            picked={picked}
            onPick={togglePick}
            people={feed.people}
            lead={
              feed.event.uploadsOpen && session.account && !picked ? (
                <label htmlFor="add-photos" className="tile-add">
                  <span className="tile-add-lenses" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <strong>{uploads.running ? 'Adding…' : 'Add your photos'}</strong>
                  <span className="muted">Everyone here can contribute.</span>
                </label>
              ) : null
            }
          />

          {visible.length === 0 && (
            <p className="muted empty">
              Nothing here yet. Add yours and everyone else will see there is
              something to add to.
            </p>
          )}

          {/*
            The bar for a selection, at the foot of the body rather than
            floating over the gallery: it appears when the mode starts and it
            says how to leave, because while it is up a tile picks instead of
            going to the photograph's own page — which is where the reporting
            actions are.
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
      )}

      {tab === 'conversation' && (
        <div className="event-body event-column">
          <Thread
            eventId={eventId}
            messages={feed.messages}
            canPost={feed.canPost}
            people={feed.people}
            members={feed.members}
            onChanged={refresh}
            onSeen={markSeen}
          />
          <SiteFooter />
        </div>
      )}

      {tab === 'people' && (
        <div className="event-body event-column">
          <People
            roster={feed.roster}
            linkToken={feed.event.linkToken}
            onInvite={() => setSharing(true)}
          />
          <SiteFooter />
        </div>
      )}

      {/*
        In front of everything, not in the flow. It was a panel at the foot of
        the body, which put it under the whole grid — so choosing it from a
        menu in the sticky head looked like nothing had happened.
      */}
      {sharing && (
        <ShareEvent
          linkToken={feed.event.linkToken}
          accessPolicy={feed.event.accessPolicy}
          joinsOpen={feed.event.joinsOpen}
          onClose={() => setSharing(false)}
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

/**
 * The line above a run of photographs.
 *
 * A label, what it is (`Maya, 8 minutes ago`), a rule filling whatever is
 * left, and — on the live one — how many are still coming. The rule is what
 * makes it a section rather than a heading: it separates without taking a line
 * of its own.
 */
function SectionHead({
  label,
  caption,
  arriving = 0,
}: {
  label: string;
  caption: string | null;
  arriving?: number;
}) {
  return (
    <div className="section-head">
      <span className="section-label">{label}</span>
      {caption && <span className="section-caption">{caption}</span>}
      <span className="section-rule" aria-hidden="true" />
      {arriving > 0 && (
        <span className="arriving">
          <span className="arriving-dot" aria-hidden="true" />
          {arriving} arriving
        </span>
      )}
    </div>
  );
}

/**
 * The gallery: photographs at their own shape, in columns.
 *
 * They were 150px squares in a fixed grid, which is a contact sheet — every
 * picture cropped to the same box regardless of what is in it, and a portrait
 * of somebody reduced to their middle third. Here each one keeps its aspect
 * ratio and the columns take up the slack.
 *
 * ## Laid out here rather than by the browser
 *
 * CSS columns would do this in one line and would order the photographs down
 * column one, then down column two — so the newest picture is at the top left
 * and the second newest is a screen below it. Filling the shortest column
 * next keeps the reading order the feed's order across the row, which is what
 * somebody scanning for "the one from the end of the night" is doing.
 *
 * The shapes come from the server, so the layout is final on the first paint.
 * Measuring after load means the whole gallery reflows under the reader's hand
 * as each photograph arrives.
 */
const COLUMN_COUNTS = 4;

function Masonry({
  photos,
  eventId,
  picked,
  onPick,
  people,
  lead,
}: {
  photos: Photo[];
  /** For each tile's own address — a photograph is a page now, not a dialog. */
  eventId: string;
  picked: Set<string> | null;
  onPick: (id: string) => void;
  /** For the name on a tile's overlay. Keyed by the contributor digest. */
  people: Person[];
  /** The contribute tile, which is first in the first column. */
  lead: React.ReactNode;
}) {
  const columns = useMemo(() => {
    const out: { photo: Photo; ratio: number }[][] = Array.from(
      { length: COLUMN_COUNTS },
      () => [],
    );
    // Heights in units of column width. The lead tile is a fixed 210px in a
    // ~290px column, so it starts its column part-filled.
    const heights = Array.from({ length: COLUMN_COUNTS }, (_, i) =>
      i === 0 && lead ? 0.72 : 0,
    );
    for (const photo of photos) {
      // 3:2 for anything the deriver has not measured yet — right often
      // enough, and wrong by a few pixels of column height when it is not.
      const ratio = photo.width && photo.height ? photo.height / photo.width : 2 / 3;
      let shortest = 0;
      for (let i = 1; i < heights.length; i++) {
        if (heights[i]! < heights[shortest]!) shortest = i;
      }
      out[shortest]!.push({ photo, ratio });
      heights[shortest]! += ratio;
    }
    return out;
  }, [photos, lead]);

  if (photos.length === 0 && !lead) return null;

  return (
    <div className="masonry">
      {columns.map((column, i) => (
        <div className="masonry-column" key={i}>
          {i === 0 && lead}
          {column.map(({ photo, ratio }) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              href={`/event/${eventId}/p/${photo.id}`}
              ratio={ratio}
              by={people.find((person) => person.key === photo.by)?.name ?? null}
              picking={picked !== null}
              picked={picked?.has(photo.id) ?? false}
              onPick={() => onPick(photo.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Everybody in the event, and everybody who was asked.
 *
 * A page of rows rather than a list of faces: the point of it is what each
 * person has put in, which is the one number that turns "who is here" into
 * "who has not added theirs yet". The role beside a name describes what
 * somebody has done, never a rank — management is on the manage screen.
 */
function People({
  roster,
  linkToken,
  onInvite,
}: {
  roster: Roster[];
  linkToken: string;
  onInvite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const joined = roster.filter((person) => person.role !== 'invited');

  return (
    <div className="people-tab">
      <div className="people-head">
        <div>
          <h2>
            {joined.length} {joined.length === 1 ? 'person has' : 'people have'} joined
          </h2>
          <p className="muted">
            Invite everyone who was there so the event has every perspective.
          </p>
        </div>
        <button type="button" onClick={onInvite}>
          Invite
        </button>
      </div>

      <ul className="roster">
        {roster.map((person) => (
          <li
            key={`${person.actorId}-${person.role}`}
            className={person.role === 'invited' ? 'roster-waiting' : undefined}
          >
            <Face
              src={person.role === 'invited' ? null : person.avatarUrl}
              size={44}
              className="roster-face"
              fallback={
                <span aria-hidden="true">
                  {person.name.replace('@', '').slice(0, 1).toUpperCase()}
                </span>
              }
            />
            <div className="roster-who">
              <div className="roster-name">
                {person.handle ? (
                  <a href={`/u/${encodeURIComponent(person.handle)}`}>{person.name}</a>
                ) : (
                  <span>{person.name}</span>
                )}
                {person.handle && <span className="roster-handle">@{person.handle}</span>}
              </div>
              <div className="roster-did">
                {person.role === 'invited'
                  ? `Invited ${person.invitedAt ? relativeDay(person.invitedAt) : 'recently'} · not opened`
                  : person.photoCount > 0
                    ? `${person.photoCount} ${person.photoCount === 1 ? 'photo' : 'photos'} added`
                    : 'Nothing added yet'}
              </div>
            </div>
            <span className={`role role-${person.role}`}>{ROLE_WORDS[person.role]}</span>
          </li>
        ))}
      </ul>

      {/*
        The link, at the foot, said plainly. The Invite button above opens the
        panel with the choices in it; this is for somebody who has already
        decided and wants the thing to paste.
      */}
      <div className="people-foot">
        <Mark size={26} />
        <p>Anyone with the link can add photos — no account needed to look.</p>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await navigator.clipboard
              .writeText(`${window.location.origin}/e/${linkToken}`)
              .catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}

const ROLE_WORDS: Record<Roster['role'], string> = {
  creator: 'Creator',
  contributor: 'Contributor',
  viewer: 'Viewer',
  invited: 'Invited',
};

/** "2 days ago", for an invitation that has been sitting there. */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

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
