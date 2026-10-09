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
import { CONTRIBUTE_CREATOR, CONTRIBUTE_HOST, PRIVATE } from '@parea/core/settings';
import type { Message } from '@/messages';
import { ACCEPT_ATTRIBUTE, MAX_PER_SELECTION, refuseFile } from '@parea/upload';
import { capSelection, selectionNote } from './capSelection';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SignIn, useSession } from './SignIn';
import { Menu } from './Menu';
import { Thread } from './Thread';
import { ShareEvent } from './ShareEvent';
import { PhotoTile } from './PhotoTile';
import { UploadTile } from './UploadTile';
import { useUploadPreviews, type UploadPreview } from './uploadPreviews';
import type { Member, Roster } from '@/members';

import { Face, Faces } from './Faces';
import { IconGlyph } from './IconGlyph';
import { AlbumRequests } from './AlbumRequests';
import { AddRefused } from './AddRefused';
import { RailIcon } from './RailIcon';
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
  /**
   * Whether this reader has starred it, and nobody else's answer.
   *
   * The route has sent this on every photograph since the phone got the star,
   * and nothing here read it. It is a shortlist, never a score: there is no
   * count of who else starred a picture, because `photo_favourite` is a table
   * of its own so that a read of an album cannot become one.
   */
  favourite: boolean;
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
    /**
     * Who may add photographs, as the album has it.
     *
     * A different question from whether *this* reader may — that is `canAdd`
     * below. This one is for the People tab, which offers "Make a host" only
     * on an album where being one means anything.
     */
    contributePolicy: string;
    canAdminister: boolean;
    /** Where this reader stands: only a `member` is offered Leave roll. */
    membership?: 'creator' | 'member' | 'none';
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
  /*
   * Whether *this* reader may add photographs, which is the server's decision
   * rather than a fact about the album. It was `event.uploadsOpen`, which
   * answered a question about the album: on a host-only one that would have
   * drawn the add button for everybody and had it refused at the server.
   *
   * Beside `canPost` rather than inside `event`, because the two are the same
   * kind of thing — what this person may do — and neither is a property of the
   * album.
   */
  canAdd: boolean;
  /**
   * Where this reader stands with the album's set of hosts.
   *
   * Beside `canAdd` rather than inside it: `canAdd` answers "draw the add
   * button", and this answers "and if not, is there something to do about it".
   * Both are the server's, for the same reason — re-deriving either here would
   * be the policy written a third time.
   */
  hosting: {
    isHost: boolean;
    canAsk: boolean;
    asked: 'open' | 'approved' | 'declined' | null;
  };
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

/**
 * The four panes, in the order the header draws them.
 *
 * Photographs, then the ones you picked out of them, then what was said, then
 * who was there. Two pairs: the first two are the pictures — all of them, and
 * your own cut of them — and the second two are the people around them. That
 * is the order somebody arrives in, and it puts the shortlist next to the
 * thing it is a shortlist *of* rather than across the row from it.
 *
 * Favourites was third, after Thread, which is where a fourth tab lands when
 * it is simply appended before People. It reads as an afterthought there, and
 * it separates the two panes that are both grids of the same photographs.
 */
const TABS = [
  ['photos', 'Photos', 'photos'],
  /*
   * The shortlist, which is a pass over a list already in hand.
   *
   * `favourite` is on every photograph the feed returns, so this filters
   * rather than fetches — and it stays right the instant a star is pressed on
   * a photograph's own page, because coming back here re-reads the feed.
   *
   * Favorites, where the phone says Kept. The two clients differ here on
   * purpose and it is the third place they do: a phone's is a glyph on a
   * two-segment switch with the word only in its accessible name, and this is
   * a word in a row of four that a reader actually reads. Favorites is what
   * a browser has taught them a starred shortlist is called.
   *
   * The id is `favourites` as well, unlike the rail's rows and the thread's
   * tab. Those keep older ids because renaming one breaks links people have
   * already sent; this shipped an hour ago and nobody has sent one — so the
   * URL, the route and the label can all be the one word the schema already
   * uses, which is `photo_favourite`.
   */
  ['favourites', 'Favorites', 'star'],
  /*
   * "Thread", and the route is still `?tab=conversation`.
   *
   * The same split the rail makes between what a row is called and where it
   * goes: renaming the id would break every link anybody has already sent to
   * an event's conversation, and the word on screen is free to change without
   * that. Thread is what people call this — a run of messages about one thing
   * — and it is a shorter word in a row of four.
   *
   * One bubble, where a group's chat carries two. The distinction is the
   * app's and it is worth having on both clients: one is a remark about a
   * thing, which is what an album's comments are, and two is people going
   * back and forth, which is a room. See `RailIcon`.
   */
  ['conversation', 'Thread', 'bubble'],
  ['people', 'People', 'groups'],
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
  const day = feed.event.startsAt ?? earliestTaken(feed.photos);
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
  backHref = '/events',
}: {
  eventId: string;
  /** Which pane, from the URL — so a link to the roster is a link. */
  tab: EventTab;
  initial: Feed;
  /** Where the back arrow goes: the group it came from, or the rolls list. */
  backHref?: string;
}) {
  const [feed, setFeed] = useState<Feed>(initial);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /** How many of the last selection were not photos. */
  const [skipped, setSkipped] = useState(0);
  /** Said when the last selection went over the limit; null when it did not. */
  const [overLimit, setOverLimit] = useState<string | null>(null);
  /** The share panel, which is what somebody who cannot manage gets instead. */
  const [sharing, setSharing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const session = useSession();

  /*
   * Leaving the roll: it comes off your list, and nothing else moves — the
   * photographs you added stay, because they belong to the evening, and a
   * public link still opens it. The same words the app's confirmation uses.
   */
  const leaveRoll = async () => {
    const name = feed?.event.name ?? 'this roll';
    if (
      !confirm(
        `Leave ${name}? It comes off your list. Photos you added stay — they belong to the evening.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/events/${eventId}/participation`, { method: 'DELETE' });
    if (!res.ok) {
      alert('Could not leave the roll. Try again in a moment.');
      return;
    }
    const { throughGroup } = (await res.json().catch(() => ({}))) as {
      throughGroup?: string | null;
    };
    // Inside a group it still reaches the home list through the membership,
    // which reads as Leave having failed unless it is said.
    if (throughGroup) {
      alert(
        `${name} belongs to a group you are in, so it stays in your list. Leaving the group is what takes it off.`,
      );
    }
    window.location.href = '/';
  };

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
   * When this person last read the thread, per album.
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

  /*
   * Only the newest answer is kept.
   *
   * Two schedules ask for this — the 4-second poll and every upload as it
   * lands — and their answers can come back in either order. An older one
   * landing last used to put the page back a step: the "arriving" pill
   * vanished and returned, and photos already shown blinked out and in.
   */
  const latestRefresh = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++latestRefresh.current;
    const res = await fetch(`/api/events/${eventId}/photos`).catch(() => null);
    if (!res?.ok) return;
    const next = (await res.json()) as Feed;
    if (ticket !== latestRefresh.current) return;
    setFeed(next);
  }, [eventId]);

  const uploads = useUploads(eventId, refresh);

  // Which uploads have become photos on the page — see `Uploads`.
  const shownIds = useMemo(() => new Set(feed.photos.map((p) => p.id)), [feed.photos]);
  // And the ones that have not, drawn in the gallery from the file in hand.
  const previews = useUploadPreviews({
    eventId,
    items: uploads.items,
    fileOf: uploads.fileOf,
    shown: shownIds,
    arriving: feed.arriving,
    running: uploads.running,
  });

  /**
   * Handing somebody the camera, or taking it back.
   *
   * Straight to a refresh rather than an optimistic flip: the roster is the
   * server's list and this writes to it, so the honest thing for the row to
   * show is what came back. It is one click on a page nobody is scrolling
   * fast, which is the case where a round trip is affordable.
   */
  const setHost = useCallback(
    async (actorId: string, host: boolean) => {
      const res = await fetch(`/api/events/${eventId}/hosts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId, host }),
      });
      if (res.ok) await refresh();
    },
    [eventId, refresh],
  );

  /**
   * Taking somebody out of a private roll. The answer comes back as a sentence
   * for the People tab to show, or null when it worked — the roster then
   * redraws from the server rather than from a guess.
   */
  const removeMember = useCallback(
    async (actorId: string, name: string): Promise<string | null> => {
      const res = await fetch(
        `/api/events/${eventId}/members?actorId=${encodeURIComponent(actorId)}`,
        { method: 'DELETE' },
      );
      if (res.ok || res.status === 404) {
        await refresh();
        return null;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === 'group_member'
        ? `${name} is in this roll's group, so it stays open to them. Remove them from the group instead.`
        : 'Could not remove them. Try again.';
    },
    [eventId, refresh],
  );

  /** Handing the roll to somebody else, asked first. */
  const makeHost = useCallback(
    async (actorId: string, name: string) => {
      if (
        !confirm(
          `Make ${name} the Host? They will run this roll — its name, who is in it and who can add. You stay in as a co-host.`,
        )
      ) {
        return;
      }
      const res = await fetch(`/api/events/${eventId}/handover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId }),
      });
      if (res.ok) await refresh();
      else {
        alert(
          res.status === 409
            ? `${name} can’t be this roll’s Host.`
            : 'Could not hand it over. Try again.',
        );
      }
    },
    [eventId, refresh],
  );

  /**
   * Asking to be one of the people who may add.
   *
   * The server's answer is what lands, not an assumed `open`: a repeat ask on
   * something already declined comes back `declined` rather than reopening it,
   * and a line that said "Asked" over that would be pressing past somebody's
   * no on their behalf.
   */
  const [hostAsk, setHostAsk] = useState<string | null>(null);
  /*
   * An ask in flight, so the button in the dialog can say so.
   *
   * The line beside the gallery never needed this — it is a link in a
   * sentence, and a sentence that changes under a click is enough of an
   * acknowledgement. A button somebody presses and watches is the case where
   * one round trip is long enough to feel ignored.
   */
  const [asking, setAsking] = useState(false);
  const askToHost = useCallback(async () => {
    setAsking(true);
    try {
      const res = await fetch(`/api/events/${eventId}/host-requests`, { method: 'POST' });
      if (!res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      setHostAsk(body.status ?? 'open');
      // Approved happens when the host had already promoted them and this page
      // had not come round yet: the album can be added to now.
      if (body.status === 'approved') await refresh();
    } finally {
      setAsking(false);
    }
  }, [eventId, refresh]);

  /*
   * The answer to a `+` this reader may not press.
   *
   * State rather than a branch on `canAdd`, because it is a thing they did:
   * the album says nothing about adding until the control is pressed, and then
   * it says everything — see `AddRefused`. Closed again on `OK`, on Escape and
   * on the scrim.
   */
  const [refused, setRefused] = useState(false);

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
  /*
   * Also while the gallery shows photos it kept from an earlier visit as
   * processing. They wait for a read of this page's own before believing
   * "nothing arriving" — see `useUploadPreviews` — and without a poll a page
   * opened on a feed that already said so would never make that read.
   */
  const waiting = previews.some((p) => p.state === 'processing');
  useEffect(() => {
    if (!uploads.running && feed.arriving === 0 && !waiting) return;

    let tries = 0;
    const timer = setInterval(() => {
      if (!uploads.running && ++tries > INGEST_POLLS) {
        clearInterval(timer);
        return;
      }
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [uploads.running, feed.arriving, waiting, refresh]);

  const pick = useCallback(
    async (picked: File[]) => {
      /*
       * `accept` on the input is advice, not a rule — a drop, or "All Files"
       * in the OS dialog, gets past it. The presign endpoint refuses the whole
       * request if any one file is unacceptable, so without this a single
       * video dropped alongside two hundred photos loses all two hundred.
       *
       * `refuseFile` rather than a type check written here, because a type
       * check written here is what this was, and it missed the size. A zero-
       * byte `File` is well typed and perfectly ordinary — a folder dropped
       * instead of its contents, a cloud file the OS never materialised — and
       * it took the whole batch down with it. An empty `type` is still not a
       * rejection; see `sendableMime`.
       */
      const usable = picked.filter((file) => refuseFile(file) === null);
      setSkipped(picked.length - usable.length);
      // Per pick, not per roll: what is already here or on its way does not
      // count, so the next pick can add fifty more.
      const { kept, dropped } = capSelection(0, usable, MAX_PER_SELECTION);
      setOverLimit(dropped > 0 ? selectionNote(kept.length, MAX_PER_SELECTION) : null);

      if (kept.length > 0) await uploads.add(kept);
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
  /*
   * The part of the album this reader has starred.
   *
   * A pass over a list in hand rather than a second request: `favourite` is
   * already on every photograph the feed returns, so the shortlist costs
   * nothing and is right the moment the feed is re-read — which is what
   * happens on coming back from a photograph's own page, where the star is.
   */
  const favourites = visible.filter((photo) => photo.favourite);



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
          <a
            href={backHref}
            className="event-back"
            aria-label={
              backHref === '/events'
                ? 'Back to your rolls'
                : backHref === '/account'
                  ? 'Back to your profile'
                  : backHref.startsWith('/u/')
                    ? 'Back to their profile'
                    : 'Back to the group'
            }
          >
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
                    {/* Only the ones you starred — the Favorites tab, as a zip. */}
                    {favourites.length > 0 && (
                      <button
                        disabled={downloading}
                        onClick={() => {
                          close();
                          void download('original', favourites.map((photo) => photo.id));
                        }}
                      >
                        Download favorites
                      </button>
                    )}
                  </>
                )}
              </Menu>
            )}

            {/*
              No count on it any more. It carried one because what was behind
              it — `Manage album` — was the only place a request could be
              answered, which made the badge a number two hops from the thing
              it was about. The queues are on the People tab now and so is the
              pip.

              The product's round chrome, like the `+` beside it and like every
              corner control on a phone.
            */}
            <Menu label="This roll" glyph="···" tone="round">
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
                      {favourites.length > 0 && (
                        <button
                          className="narrow-only"
                          disabled={downloading}
                          onClick={() => {
                            close();
                            void download('original', favourites.map((photo) => photo.id));
                          }}
                        >
                          Download favorites
                        </button>
                      )}
                    </>
                  )}
                  {feed.event.canAdminister ? (
                    <a
                      href={`/event/${eventId}/manage${backHref === '/account' ? '?from=profile' : ''}`}
                      onClick={close}
                    >
                      Manage roll
                    </a>
                  ) : (
                    <a href="/safety" onClick={close}>
                      Safety and reporting
                    </a>
                  )}
                  {/*
                    Leaving, for anybody in it who did not make it — the app's
                    sheet has had this beside Download since it existed. The
                    creator is not offered it: they end the roll for everybody
                    from Manage, and the server refuses them here anyway.
                  */}
                  {session.account && feed.event.membership === 'member' && (
                    <button
                      className="menu-danger"
                      onClick={() => {
                        close();
                        void leaveRoll();
                      }}
                    >
                      Leave roll
                    </button>
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
        <div className="event-tabrow">
          <nav className="event-tabs" aria-label="This roll">
            {TABS.map(([id, label, glyph]) => (
              <a
                key={id}
                href={tabHref(eventId, id, backHref)}
                className={`event-tab${tab === id ? ' event-tab-on' : ''}`}
                aria-current={tab === id ? 'page' : undefined}
              >
                <RailIcon glyph={glyph} weight={tab === id ? 2.5 : 2} />
                {/*
                  Its own element so a phone can draw the row as glyphs alone
                  — four words and a disc do not fit across one — while the
                  word stays the tab's accessible name.
                */}
                <span className="event-tab-label">{label}</span>
                {id === 'conversation' && unread > 0 && (
                  <span className="event-tab-count">{unread}</span>
                )}
                {/*
                  The same pip, about the same kind of fact: something on this
                  tab is waiting on you. It was a badge on the `···`, pointing
                  at a menu item pointing at `/manage` — two hops from a number
                  to the thing it was about. The queues are on People now, so
                  the count is on People.
                */}
                {id === 'people' && feed.event.waiting > 0 && (
                  <span className="event-tab-count">{feed.event.waiting}</span>
                )}
              </a>
            ))}
          </nav>

          {/*
            Add photos, at the end of the tab row — the app's own placement,
            and the group screen's.

            It was a filled accent label up in the header among Invite, a
            download menu and the `···`, which is four controls beside a title
            that has a name, a date, a place, a row of faces and sometimes a
            caption under it. The one this page is actually for was hard to
            find among the other three.

            Still a `<label>` rather than a button that calls `.click()`: a
            label *is* the control for the input it names, so pointer, keyboard
            and screen reader all work with nothing scripted. `aria-disabled`
            rather than `disabled`, which a label does not have — the real
            disabling is on the input.
          */}
          {feed.canAdd && session.account ? (
            <label
              htmlFor="add-photos"
              className="round event-add"
              aria-label={uploads.running ? 'Adding photos' : 'Add photos'}
              aria-disabled={uploads.running || undefined}
            >
              <RailIcon glyph="plus" />
            </label>
          ) : (
            session.account && (
              /*
                The same control, for somebody who may not add — and it is a
                control rather than a gap.

                It was absent, which is the page looking broken: the reader can
                see the album, can talk in it, and cannot work out where the
                button went. There is a sentence beside the gallery saying who
                adds here, and it is the half of the answer nobody reads —
                somebody who came to add photographs goes for the `+` in the
                corner. So the corner answers: pressing it says why, and offers
                the ask where asking is a thing. See `AddRefused`.

                A `<button>` rather than the label above, because it opens a
                dialog instead of a file picker. It carries the same name and
                the same round chrome, so the one thing that differs between
                the two readers is what happens when it is pressed.

                Only once there is an account. Signing in is the step in front
                of this one and it has its own panel in the body — a dialog
                about who may add, shown to somebody the server has not been
                told the name of yet, would be answering the wrong question.
              */
              <button
                type="button"
                className="round event-add"
                aria-label="Add photos"
                onClick={() => setRefused(true)}
              >
                <RailIcon glyph="plus" />
              </button>
            )
          )}
        </div>

        {feed.canAdd && session.account && (
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
          {feed.canAdd && session.known && !session.account && (
            // Adding names who added. Shown here rather than behind a link to
            // /account, because being sent away mid-task loses the picker they
            // were about to use — and on a phone, the photos they had chosen.
            <SignIn
              why="Adding photos needs an account. Looking does not — you can carry on browsing without one."
              onSignedIn={session.refresh}
            />
          )}

          {/*
            Who adds here, said before anybody presses anything.

            The `+` has its own answer now — see `AddRefused` — and this line
            is still worth drawing: it is the rule stated in front of the grid,
            for somebody deciding whether to reach for the corner at all.
            Saying "hosts add the photographs here" is the difference between a
            refusal and a rule.

            Only where asking is actually a thing — `canAsk` is the server's
            answer, not a reading of `contributePolicy`, so an album set to
            "Only me" says its piece and offers nothing, which is correct:
            there is no set to join and a button to ask would make "Only me"
            something its owner has to keep defending.

            A declined ask reads as the album's rule rather than as a verdict.
            Telling somebody they were turned down is the host's to do, not the
            page's — the same reasoning a friend request follows.
          */}
          {!feed.canAdd && feed.hosting.canAsk && (
            <p className="panel-note host-ask">
              {hostAsk === 'open' || feed.hosting.asked === 'open' ? (
                'Asked to be a host. You can add photos once that is answered.'
              ) : (
                <>
                  Hosts add the photographs here.{' '}
                  <button type="button" className="link-button" onClick={askToHost}>
                    Ask to be a host
                  </button>
                </>
              )}
            </p>
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
          {overLimit && <p className="muted">{overLimit}</p>}

          {/*
            Only when there is something in it. A section head reading "JUST
            ADDED" over an empty gallery is furniture describing a state that
            is not happening, so when nothing has arrived since you got here
            this is one gallery, as it always was.
          */}
          {(fresh.length > 0 || previews.length > 0) && (
            <>
              <SectionHead
                label="Just added"
                caption={freshCaption(fresh, feed.people)}
                arriving={feed.arriving}
              />
              {/*
                Photos on their way go on top, where they will land: see
                `outstandingUploads` for why the slot is the same one.
              */}
              <Masonry
                photos={fresh}
                pending={previews}
                onRetry={() => void uploads.retry()}
                onPickAgain={() => inputRef.current?.click()}
                eventId={eventId}
                people={feed.people}
                lead={null}
              />
              {/* Not over nothing: a new roll's first photos are all "just added". */}
              {earlier.length > 0 && (
                <SectionHead label="Earlier" caption={earlierCaption(feed.event.startsAt, earlier)} />
              )}
            </>
          )}

          {/*
            The gallery, with the contribute tile first while it is empty.

            Only while it is empty: once there are photographs the tile is a
            dashed box in among them, repeating the `+` at the end of the tab
            row, which is where adding more lives. It is the same control as
            that button — a label over the same input — so there is one file
            dialog and one disabled state.
          */}
          <Masonry
            photos={fresh.length > 0 ? earlier : visible}
            eventId={eventId}
            people={feed.people}
            lead={
              feed.canAdd &&
              session.account &&
              visible.length === 0 &&
              previews.length === 0 ? (
                <label htmlFor="add-photos" className="tile-add">
                  <span className="tile-add-lenses" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <strong>{uploads.running ? 'Adding…' : 'Add your photos'}</strong>
                  {/*
                    Who else can, which is not always everybody.

                    It said "Everyone here can contribute" on every album,
                    written when that was the only thing an album could be. On
                    one set to "Hosts" it is false to everybody reading it, and
                    on "Only me" it is false in the other direction — the person
                    seeing this tile is the only one who will ever see it.

                    Drawn only where `canAdd` is already true, so this is never
                    the sentence that tells somebody they cannot add; it says
                    who is standing beside them.
                  */}
                  <span className="muted">{contributeNote(feed.event.contributePolicy)}</span>
                </label>
              ) : null
            }
          />

          {visible.length === 0 && previews.length === 0 && (
            <p className="muted empty">
              Nothing here yet. Add yours and everyone else will see there is
              something to add to.
            </p>
          )}

          {downloadError && <p className="muted">{downloadError}</p>}

          {/*
            At the foot, and folded away. It is a progress report: worth being
            able to open, never worth sitting between somebody and the pictures.
          */}
          <Uploads
            uploads={uploads}
            shown={shownIds}
            arriving={feed.arriving}
            onPick={() => inputRef.current?.click()}
          />
          <SiteFooter />
        </div>
      )}

      {tab === 'conversation' && (
        <div className="event-body event-column">
          <Thread
            room={{ kind: 'event', id: eventId }}
            messages={feed.messages}
            canPost={feed.canPost}
            people={feed.people}
            members={feed.members}
            /*
             * The photograph a line is about, for the reactions merged into
             * this column. The page already holds every photograph in the
             * event, so this is a lookup rather than a second way to ask for
             * one — and a reaction that cannot say which picture it is on is
             * a line nobody can act on.
             */
            photoOf={(photoId) => {
              const photo = feed.photos.find((one) => one.id === photoId);
              return photo ? { id: photo.id, src: photo.src } : null;
            }}
            onChanged={refresh}
            onSeen={markSeen}
          />
          <SiteFooter />
        </div>
      )}

      {tab === 'favourites' && (
        <div className="event-body">
          {/*
            The shortlist, and what it says when there is none.

            Filtered from `visible` rather than from `feed.photos`, so the
            contributor chips and the moderation state apply here exactly as
            they do on the gallery — a photograph hidden from you is hidden on
            both, and a filter applied on one page and not the other is two
            answers to what this album contains.

            No `Just added` split and no contribute tile. This is a page about
            what you chose, so a section of what arrived while you were away
            belongs on the album, and an invitation to add more belongs where
            the adding is.
          */}
          {favourites.length === 0 ? (
            <p className="muted empty">
              No favorites yet. Open a photograph and press the star, and it
              turns up here. Only you see this.
            </p>
          ) : (
            <Masonry
              photos={favourites}
              eventId={eventId}
              people={feed.people}
              lead={null}
            />
          )}
        </div>
      )}

      {tab === 'people' && (
        <div className="event-body event-column">
          {/*
            Who is waiting, above who is already in — the shape a group's
            People tab has, for the same reason: this is the pane about people,
            and a request to be let in is a request to join the list under it.

            Only for somebody who can answer. A reader who cannot administer is
            not shown the queue and never fetches it; the component is not
            rendered at all rather than rendering empty, so there is no request
            for the route to refuse.
          */}
          {feed.event.canAdminister && (
            <AlbumRequests eventId={eventId} onApproved={refresh} />
          )}
          <People
            roster={feed.roster}
            linkToken={feed.event.linkToken}
            accessPolicy={feed.event.accessPolicy}
            canAdminister={feed.event.canAdminister}
            contributePolicy={feed.event.contributePolicy}
            onSetHost={(actorId, host) => void setHost(actorId, host)}
            onMakeHost={
              feed.event.membership === 'creator'
                ? (actorId, name) => void makeHost(actorId, name)
                : undefined
            }
            onInvite={() => setSharing(true)}
            group={
              feed.event.groupId
                ? { id: feed.event.groupId, name: feed.event.groupName ?? 'the group' }
                : null
            }
            onRemove={
              feed.event.canAdminister && feed.event.accessPolicy === PRIVATE
                ? removeMember
                : undefined
            }
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

      {/*
        Why the `+` did nothing, on the press that asked.

        Beside the share panel and portalled the same way, for the same reason:
        it is opened from the sticky head. `hostAsk` first and the feed behind
        it, so the ask this tab just sent outranks a poll that has not come
        round — and dropping the local one is how the dialog would go back to
        offering a button for something already asked.

        It stays open after the ask rather than closing on it: what somebody
        pressed the button to find out is whether the ask went, and a dialog
        that vanishes answers that with nothing.
      */}
      {refused && (
        <AddRefused
          eventId={eventId}
          canAsk={feed.hosting.canAsk}
          canAdminister={feed.event.canAdminister}
          asked={(hostAsk as 'open' | 'approved' | 'declined' | null) ?? feed.hosting.asked}
          asking={asking}
          onAsk={askToHost}
          onClose={() => setRefused(false)}
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
/**
 * How many columns, at which widths — the one table both halves read.
 *
 * The layout was always worked out for four columns while the stylesheet
 * drew three below 1200px, two below 900 and one below 600. With a handful
 * of photographs that did not show: the fourth column was empty. The moment
 * somebody added enough to fill it, it had nowhere to go in a three-column
 * row and dropped underneath the first — so a roll that opened as a collage
 * grew a vertical stack of its newest pictures under it. The count now comes
 * from the width the gallery is actually drawn at, and the grid is told the
 * same number, so the two cannot disagree.
 */
const COLUMN_BREAKS: [minWidth: number, columns: number][] = [
  [1201, 4],
  [901, 3],
  [601, 2],
  [0, 1],
];

function columnsFor(width: number): number {
  return COLUMN_BREAKS.find(([min]) => width >= min)![1];
}

/**
 * The column count for this window, following it as it is resized.
 *
 * Four before the browser has said how wide it is — the server's render and
 * the first frame — which is right for the widest windows and corrected on
 * the next frame for the rest.
 */
function useColumnCount(): number {
  const [count, setCount] = useState(4);
  useEffect(() => {
    const measure = () => setCount(columnsFor(window.innerWidth));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return count;
}

function Masonry({
  photos,
  pending = [],
  onRetry,
  onPickAgain,
  eventId,
  people,
  lead,
}: {
  photos: Photo[];
  /** Uploads not yet in the feed, laid out ahead of the photographs. */
  pending?: UploadPreview[];
  onRetry?: () => void;
  onPickAgain?: () => void;
  /** For each tile's own address — a photograph is a page now, not a dialog. */
  eventId: string;
  /** For the name on a tile's overlay. Keyed by the contributor digest. */
  people: Person[];
  /** The contribute tile, which is first in the first column. */
  lead: React.ReactNode;
}) {
  const count = useColumnCount();
  const columns = useMemo(() => {
    const out: ({ photo: Photo; ratio: number } | { upload: UploadPreview; ratio: number })[][] =
      Array.from({ length: count }, () => []);
    // Heights in units of column width. The lead tile is a fixed 210px in a
    // ~290px column, so it starts its column part-filled.
    const heights = Array.from({ length: count }, (_, i) =>
      i === 0 && lead ? 0.72 : 0,
    );
    const place = (entry: (typeof out)[number][number]) => {
      let shortest = 0;
      for (let i = 1; i < heights.length; i++) {
        if (heights[i]! < heights[shortest]!) shortest = i;
      }
      out[shortest]!.push(entry);
      heights[shortest]! += entry.ratio;
    };
    // An upload at its preview's shape, so the photograph that replaces it
    // takes the same room in the same column.
    for (const upload of pending) place({ upload, ratio: upload.ratio ?? 2 / 3 });
    for (const photo of photos) {
      // 3:2 for anything the deriver has not measured yet — right often
      // enough, and wrong by a few pixels of column height when it is not.
      place({ photo, ratio: photo.width && photo.height ? photo.height / photo.width : 2 / 3 });
    }
    return out;
  }, [count, photos, pending, lead]);

  if (photos.length === 0 && pending.length === 0 && !lead) return null;

  return (
    <div
      className="masonry"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {columns.map((column, i) => (
        <div className="masonry-column" key={i}>
          {i === 0 && lead}
          {column.map((entry) => {
            if ('upload' in entry) {
              return (
                <UploadTile
                  key={entry.upload.id}
                  upload={entry.upload}
                  ratio={entry.ratio}
                  progress={fractionOf(entry.upload.status)}
                  onRetry={onRetry}
                  onPickAgain={onPickAgain}
                />
              );
            }
            const { photo, ratio } = entry;
            return (
              <PhotoTile
                key={photo.id}
                photo={photo}
                href={`/event/${eventId}/p/${photo.id}`}
                ratio={ratio}
                by={people.find((person) => person.key === photo.by)?.name ?? null}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A roster row's person, as a link to their profile when they have one. */
function RosterPerson({ handle, children }: { handle: string | null; children: React.ReactNode }) {
  return handle ? (
    <a className="roster-person" href={`/u/${encodeURIComponent(handle)}`}>
      {children}
    </a>
  ) : (
    <div className="roster-person">{children}</div>
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
  accessPolicy,
  canAdminister,
  contributePolicy,
  onSetHost,
  onMakeHost,
  onInvite,
  onRemove,
  group,
}: {
  roster: Roster[];
  linkToken: string;
  /**
   * The group this roll is in, when it is in one. Who is in it is decided
   * there — everyone in the group, nobody else — so the tab says where to go
   * to change it rather than leaving somebody looking for a control here.
   */
  group: { id: string; name: string } | null;
  /** Half of what the line under the link is allowed to promise. */
  accessPolicy: string;
  /**
   * Whether this reader may hand the camera over.
   *
   * Promotion is `administer`-only on the server, so the set of people who can
   * add cannot grow without the album's owner — the property that makes
   * "Hosts" safe to offer as a contribute setting at all. Drawing the control
   * for anybody else would be the page promising what the server refuses.
   */
  canAdminister: boolean;
  /**
   * Who may add photographs, as the album has it — the other half.
   *
   * The policy rather than the `hosted` boolean it used to be, because this
   * component now asks two different questions of it: whether being a co-host
   * means anything here, and what the link is allowed to promise. The second
   * has to tell "Only me" from "Hosts", which a boolean about `host` cannot,
   * and deriving one of them from a boolean derived from the other is how the
   * two come to disagree.
   */
  contributePolicy: string;
  onSetHost: (actorId: string, host: boolean) => void;
  /**
   * Only for the roll's Host — not a group admin who can also administer it.
   * Being Host is the one thing about a roll that is a person's own to hand on.
   */
  onMakeHost?: (actorId: string, name: string) => void;
  onInvite: () => void;
  /**
   * Only for somebody who runs a private roll: on a public one being a member
   * is not what lets anybody see it, so there is nothing to take. Resolves to
   * a sentence when it could not be done.
   */
  onRemove?: (actorId: string, name: string) => Promise<string | null>;
}) {
  /** Only worth asking about on an album actually set to `host`. */
  const hosted = contributePolicy === CONTRIBUTE_HOST;
  const [copied, setCopied] = useState(false);
  const joined = roster.filter((person) => person.role !== 'invited');
  /*
   * Two presses, the second on the page rather than in a dialog — the way a
   * group asks before taking somebody out — naming them and saying what it
   * costs. `removing` is who the line is about; null is no line.
   */
  const [removing, setRemoving] = useState<{ actorId: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeNote, setRemoveNote] = useState<string | null>(null);

  return (
    <div className="people-tab">
      <div className="people-head">
        <div>
          <h2>
            {joined.length} {joined.length === 1 ? 'person has' : 'people have'} joined
          </h2>
          <p className="muted">
            Invite everyone who was there so the roll has every perspective.
          </p>
        </div>
        <button type="button" onClick={onInvite}>
          Invite
        </button>
      </div>

      {group && (
        <p className="people-group-note">
          Everyone in <strong>{group.name}</strong> is in this roll. To add or remove
          people, do it in the group. <a href={`/group/${group.id}`}>Open {group.name}</a>
        </p>
      )}

      {removing && onRemove && (
        <div className="strip-confirm" role="group" aria-label="Confirm removal">
          <span>
            Remove {removing.name}? They will no longer see this roll, and can come back only if
            you invite them. Their photos stay.
          </span>
          <button
            type="button"
            className="danger"
            disabled={removeBusy}
            onClick={async () => {
              setRemoveBusy(true);
              const note = await onRemove(removing.actorId, removing.name).catch(
                () => 'Could not remove them. Try again.',
              );
              setRemoveBusy(false);
              setRemoveNote(note ?? `${removing.name} was removed.`);
              setRemoving(null);
            }}
          >
            {removeBusy ? 'Removing…' : 'Remove'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={removeBusy}
            onClick={() => setRemoving(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {removeNote && !removing && <p className="muted">{removeNote}</p>}

      <ul className="roster">
        {roster.map((person) => (
          <li
            key={`${person.actorId}-${person.role}`}
            className={person.role === 'invited' ? 'roster-waiting' : undefined}
          >
            {/*
              The person — face, name and what they have added — is one link
              to their profile, not just the name: the whole of that is what
              somebody reaches for. The controls at the end of the row stay
              outside it. No handle, no page, so no link.
            */}
            <RosterPerson handle={person.handle}>
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
                  <span>{person.name}</span>
                  {person.handle && <span className="roster-handle">@{person.handle}</span>}
                </div>
                <div className="roster-did">
                  {person.role === 'invited'
                    ? /*
                        A co-host who has not answered says so, because the two
                        facts are different and both matter to whoever is reading
                        the row: they were asked to hold the camera, and they
                        cannot hold it yet. The role lives on the participant row,
                        so until they accept there is nothing to grant — see
                        `event_invite.as_host`.
                      */
                      `${person.hostAsked ? 'Asked to co-host' : 'Invited'} ${person.invitedAt ? relativeDay(person.invitedAt) : 'recently'} · not opened`
                    : person.photoCount > 0
                      ? `${person.photoCount} ${person.photoCount === 1 ? 'photo' : 'photos'} added`
                      : 'Nothing added yet'}
                </div>
              </div>
            </RosterPerson>
            {/*
              The toggle, and the three things that have to be true for it.

              Somebody already in — an open invitation has no participant row
              and therefore no role to set. Not the creator, who is a host by
              being the creator and whose row the server refuses to write. And
              only where the setting means anything: on `everyone` they can
              already add, and on `creator` the point is that there is no set to
              join, so a "Make a host" beside every name would be offering a
              promotion into a group of one.
            */}
            {canAdminister &&
            hosted &&
            person.actorId &&
            person.role !== 'invited' &&
            person.role !== 'creator' ? (
              <button
                type="button"
                className={person.isHost ? 'secondary small' : 'small'}
                aria-pressed={person.isHost}
                onClick={() => onSetHost(person.actorId!, !person.isHost)}
              >
                {/*
                  "Co-host", not "Host", and the distinction is the one the
                  setting rests on: the album has one host — whoever made it,
                  who cannot stop being one — and these are the people they
                  handed the camera to. Calling both "Host" made the list read
                  as though the album had several owners, which is the thing a
                  co-host is deliberately not.
                */}
                {person.isHost ? 'Co-host' : 'Make a co-host'}
              </button>
            ) : (
              /*
                And the word for everybody else, which is a co-host before it is
                anything else.

                `role` describes what somebody has done here — made it, added to
                it, only looked — and being a co-host is something they were
                granted, so the two can both be true of one person. The grant
                wins the label: on an album set to `host` it is the fact the row
                is about, and "Contributor" beside somebody holding the camera
                tells the rest of the album nothing it did not already know from
                the photographs.

                Read off `hosted` so it says this only where it means something.
                On `everyone` every member may add and the word would be noise;
                the creator keeps theirs, since they are the host rather than a
                co-host of their own album.
              */
              <span
                className={`role role-${person.isHost && hosted && person.role !== 'creator' ? 'cohost' : person.role}`}
              >
                {person.isHost && hosted && person.role !== 'creator'
                  ? 'Co-host'
                  : person.hostAsked && person.role === 'invited' && hosted
                    ? 'Co-host asked'
                    : ROLE_WORDS[person.role]}
              </span>
            )}
            {onMakeHost && person.actorId && person.role !== 'invited' && person.role !== 'creator' && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onMakeHost(person.actorId!, person.name)}
              >
                Make Host
              </button>
            )}
            {onRemove && person.actorId && person.role !== 'invited' && person.role !== 'creator' && (
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove ${person.name} from this roll`}
                onClick={() => {
                  setRemoveNote(null);
                  setRemoving({ actorId: person.actorId!, name: person.name });
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {/*
        The link, at the foot, said plainly. The Invite button above opens the
        panel with the choices in it; this is for somebody who has already
        decided and wants the thing to paste.
      */}
      <div className="people-foot">
        <span className="brand-glyph">
          <IconGlyph size={17} />
        </span>
        {/*
          The sentence has to match the policy — both of them.

          It said "anyone with the link" on every event, which on a private one
          is the opposite of true. That half was fixed by reading `accessPolicy`,
          and the fix stopped one question short: a public album set to "Hosts"
          or "Only me" still promised that whoever holds the link can add
          photographs, which is exactly what those settings exist to refuse.

          The two questions compose, so the sentence has to as well — and this
          is the line somebody reads while deciding who to send the link to, so
          getting it wrong sends the link to people who will find they can only
          look.
        */}
        <p>
          {accessPolicy === PRIVATE
            ? 'The link lets somebody ask to come in. You let them in, under Members.'
            : linkPromise(contributePolicy)}
        </p>
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

/**
 * What the contribute tile says under "Add your photos".
 *
 * Only ever drawn for somebody the server has already said may add, so this is
 * never a refusal — it answers "and who else", which is the thing that decides
 * whether they wait for other people's photographs or accept that the album is
 * theirs to fill.
 *
 * `nobody` has no wording because it has no tile: it denies `upload` to
 * everybody, the creator included, so `canAdd` is false and this is not
 * reached. It falls through to the neutral line rather than being asserted
 * about — nothing writes that policy any more, and a client that meets one is
 * meeting a row older than the migration that retired it.
 */
function contributeNote(contributePolicy: string): string {
  switch (contributePolicy) {
    case CONTRIBUTE_CREATOR:
      return 'Only you can add to this one.';
    case CONTRIBUTE_HOST:
      // Not "you and your co-hosts": a co-host reads this too, and the album is
      // not theirs to speak of that way.
      return 'You and the roll’s other hosts can add.';
    default:
      return 'Everyone here can contribute.';
  }
}

/**
 * What the link is worth on a public album, which is two facts and not one.
 *
 * Seeing it and adding to it are separate permissions, and the link only ever
 * carried the first. Saying "anyone with the link can add photos" over an album
 * set to "Hosts" promised the thing that setting exists to refuse — and this is
 * the line somebody reads while deciding who to send the link to.
 *
 * Private albums never reach this: the link is a way to ask, not a way in, and
 * the caller says so in its own sentence.
 */
function linkPromise(contributePolicy: string): string {
  switch (contributePolicy) {
    case CONTRIBUTE_CREATOR:
      return 'Anyone signed in with the link can see it. You are the only one who adds photos.';
    case CONTRIBUTE_HOST:
      return 'Anyone signed in with the link can see it. Only the hosts add photos.';
    default:
      return 'Anyone signed in with the link can see it and add photos.';
  }
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
  shown,
  arriving,
  onPick,
}: {
  uploads: ReturnType<typeof useUploads>;
  /** Ids of the photos the page is showing — a photo is only done once here. */
  shown: Set<string>;
  /** Photos uploaded and still being processed, from the server. */
  arriving: number;
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
  if (uploads.items.length === 0) return null;

  const total = uploads.items.length;
  /*
   * Done means on the page, not merely sent.
   *
   * The bar used to count an upload as finished when its bytes landed, and the
   * photo appears a few seconds later, after processing — so the bar sat full
   * over an album that had not changed. Now a sent photo is finished once it is
   * showing, or once nothing is left arriving (a duplicate is dropped by
   * processing and will never show; nothing arriving means it has been
   * decided).
   */
  const finished = (item: (typeof uploads.items)[number]) =>
    item.status === 'done' && ((item.photoId != null && shown.has(item.photoId)) || arriving === 0);
  const done = uploads.items.filter(finished).length;
  const processing = uploads.items.filter((i) => i.status === 'done' && !finished(i)).length;
  /*
   * Folded by default: the summary line and its bar say how it is going, and
   * the photos themselves are already in the grid as previews. Opens on its
   * own only when something needs a decision — a failure or a photo to pick
   * again. Tapping it shows every photo's progress.
   */
  const open = choice ?? needsAttention;
  const progress =
    total === 0
      ? 0
      : Math.round(
          uploads.items.reduce((sum, i) => sum + (finished(i) ? 100 : fractionOf(i.status)), 0) /
            total,
        );

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
              : processing > 0
                ? `Finishing ${processing} ${processing === 1 ? 'photo' : 'photos'}…`
                : `Added ${done} of ${total}`}
          </strong>
          <span className="muted">
            {uploads.running
              ? 'Keep this tab open. A reload carries on from here.'
              : needsAttention
                ? 'Some of these need another look.'
                : processing > 0
                  ? 'Sent. They appear here as they finish processing.'
                  : 'Finished.'}
          </span>
        </span>
        <span className="bar" aria-hidden="true">
          <span
            className={`bar-fill${uploads.running || processing > 0 ? ' bar-moving' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </span>
        <span className="uploads-left">
          {uploads.remaining > 0
            ? `${uploads.remaining} to go`
            : processing > 0
              ? 'processing'
              : 'done'}
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
                    style={{ width: `${finished(item) ? 100 : fractionOf(item.status)}%` }}
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
      return 60;
    case 'done':
      // Sent, and being processed; 100 is for when it is on the page — see
      // `finished` in `Uploads`.
      return 85;
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
  // First, now that a roll is a stack with its latest addition on top.
  const newest = photos[0];
  if (!newest) return null;
  const who = people.find((person) => person.key === newest.by);
  const when = ago(new Date(newest.takenAt), new Date());
  return who ? `${who.mine ? 'You' : who.name}, ${when}` : when;
}

/**
 * The first photograph's time, by when it was taken.
 *
 * Looked for rather than read off the front of the list: a roll is ordered by
 * when things were added to it, so the front is the latest addition, and an
 * addition can be of pictures from any night.
 */
function earliestTaken(photos: Photo[]): string | null {
  let first: string | null = null;
  for (const photo of photos) {
    if (photo.takenAt && (first === null || photo.takenAt < first)) first = photo.takenAt;
  }
  return first;
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
  const from = startsAt ?? earliestTaken(photos);
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

/**
 * A tab's link, carrying the group or profile the roll was opened from, so
 * switching tabs does not lose the way back to it.
 */
function tabHref(eventId: string, tab: EventTab, backHref: string): string {
  const params = new URLSearchParams();
  if (tab !== 'photos') params.set('tab', tab);
  const group = backHref.startsWith('/group/') ? backHref.slice('/group/'.length) : null;
  if (group) params.set('group', group);
  if (backHref === '/account') params.set('from', 'profile');
  if (backHref.startsWith('/u/')) {
    params.set('person', decodeURIComponent(backHref.slice('/u/'.length)));
  }
  const query = params.toString();
  return query ? `/event/${eventId}?${query}` : `/event/${eventId}`;
}
