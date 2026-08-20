'use client';

/**
 * The photograph, what is either side of it, and the room it was taken in.
 *
 * Three things are laid out here and the order of them is the argument. The
 * picture is the largest thing on the page and nothing is cropped out of it.
 * Under it, in words, whose it is and when — the two facts a dialog with a
 * `Close` button never said. Beside it, the album's conversation.
 *
 * ## The column is the album's chat
 *
 * Not this photograph's comments. Comments-under-a-photo is a comment section,
 * and a comment section is the shape of a feed: it invites a reply *about the
 * picture* from whoever is looking, and it splits one group of people into as
 * many small threads as there are photographs — so the album's actual
 * conversation is a hundred dead ends. These people are already one group
 * talking to each other. The column is that conversation, in full, the same
 * one the album's Thread tab shows; something typed here is said to the
 * album, and its context is that you can both see what is on screen.
 *
 * Photo-anchored messages still exist as records and still appear, because
 * they always appeared in the album thread too — a photo comment was only ever
 * a message with a `photoId` on it. Nothing new writes one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Member } from '@/members';
import type { Message } from '@/messages';

import { Face } from './Faces';
import { Menu } from './Menu';
import { Thread } from './Thread';
import { useImageFailure } from './useImageFailure';

type Neighbour = { id: string; full: string };

export type PhotoSubject = {
  id: string;
  full: string;
  sources: { type: string; src: string }[];
  /** Yours, which is what decides whether removal needs anybody's approval. */
  mine: boolean;
  /** Whose it is. "Someone" for a guest who arrived by link unnamed. */
  by: string;
  byAvatar: string | null;
  /** "Friday 14 March, 21:40", worded by the server. See the route. */
  when: string;
  whenAgo: string;
};

export function PhotoView({
  event,
  photo,
  position,
  previous,
  next,
  strip,
  messages,
  people,
  members,
  canPost,
}: {
  event: { id: string; name: string };
  photo: PhotoSubject;
  position: { index: number; total: number };
  previous: Neighbour | null;
  next: Neighbour | null;
  /** A window of the album's order around this one, oldest first. */
  strip: { id: string; src: string }[];
  messages: Message[];
  people: { key: string; name: string; photoCount: number; mine: boolean }[];
  members: Member[];
  canPost: boolean;
}) {
  const album = `/event/${event.id}`;
  const href = useCallback((id: string) => `${album}/p/${id}`, [album]);

  const [thread, setThread] = useState(messages);
  const frame = useRef<HTMLDivElement>(null);

  /*
   * The conversation, re-read after somebody posts.
   *
   * From the messages endpoint rather than the feed the album page polls: that
   * one signs a URL for every photograph in the album, which on a page showing
   * one of them is two hundred signatures to find out what somebody typed.
   */
  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${event.id}/messages`);
    if (res.ok) setThread(((await res.json()) as { messages: Message[] }).messages);
  }, [event.id]);

  /*
   * Focus lands on the photograph, not on the first link.
   *
   * `tabindex="-1"` rather than a focus trap: this is a page, so tabbing out
   * of it is allowed and leaving is a normal navigation. What the focus buys
   * is that the arrow keys work on arrival without anybody clicking first.
   */
  useEffect(() => {
    frame.current?.focus({ preventScroll: true });
  }, [photo.id]);

  /*
   * The neighbours, warmed into the cache.
   *
   * The full rendition is a couple of hundred kilobytes and the page it
   * belongs to is a server render away, so without this every step shows an
   * empty frame while the next photograph downloads. `new Image()` rather than
   * a hidden `<img>`: nothing is being laid out, only fetched.
   */
  useEffect(() => {
    for (const neighbour of [previous, next]) {
      if (!neighbour) continue;
      const image = new Image();
      image.src = neighbour.full;
    }
  }, [previous, next]);

  /*
   * Arrows page, Escape goes back — unless somebody is typing.
   *
   * The composer is a text box on the same screen, and a left arrow inside it
   * means "move the caret". Without the check, editing a message you had
   * second thoughts about would navigate away mid-sentence.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const on = document.activeElement;
      if (
        on instanceof HTMLElement &&
        (on.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(on.tagName))
      ) {
        return;
      }
      if (e.key === 'ArrowLeft' && previous) location.assign(href(previous.id));
      else if (e.key === 'ArrowRight' && next) location.assign(href(next.id));
      else if (e.key === 'Escape') {
        /*
         * Escape closes the innermost thing, and the `···` is inner.
         *
         * Both listeners are on the document and neither knows about the
         * other, so without this one press dismissed the menu *and* left the
         * page — which is the classic Escape bug: the key that means "back
         * out of what I just opened" backing out of everything at once.
         */
        if (document.querySelector('[role="menu"]')) return;
        location.assign(album);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previous, next, href, album]);

  /*
   * Swipe, on the frame only.
   *
   * Horizontal and far enough to be deliberate: a swipe that fires at 20px
   * takes the picture away from somebody scrolling the page, which on a phone
   * is what they are doing most of the time.
   */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const point = e.touches[0];
    touch.current = point ? { x: point.clientX, y: point.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    const point = e.changedTouches[0];
    touch.current = null;
    if (!start || !point) return;
    const dx = point.clientX - start.x;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(point.clientY - start.y)) return;
    if (dx > 0 && previous) location.assign(href(previous.id));
    if (dx < 0 && next) location.assign(href(next.id));
  };

  return (
    <main className="photo-page">
      <header className="photo-head">
        {/* A link, not a history call. Somebody arriving from a URL somebody
            sent them has nothing behind them to go back to, and this is
            exactly the page they arrive at that way. */}
        <a href={album} className="photo-back" aria-label={`Back to ${event.name}`}>
          {'‹'}
        </a>
        <span className="photo-back-text">
          Back to{' '}
          <a href={album} className="photo-back-name">
            {event.name}
          </a>
        </span>

        <span className="photo-where">
          {position.index + 1} of {position.total}
        </span>
        <Step href={previous ? href(previous.id) : null} glyph={'←'} label="Previous photo" />
        <Step href={next ? href(next.id) : null} glyph={'→'} label="Next photo" />
      </header>

      <div className="photo-body">
        <div className="photo-main">
          <div
            className="photo-frame"
            ref={frame}
            tabIndex={-1}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <Subject photo={photo} />
          </div>

          <div className="photo-by">
            <Face
              src={photo.byAvatar}
              size={36}
              className="photo-by-face"
              fallback={
                <span aria-hidden="true">
                  {photo.by.replace(/^@/, '').slice(0, 1).toUpperCase()}
                </span>
              }
            />
            <span className="photo-by-text">
              <span className="photo-by-who">
                <strong>{photo.by}</strong> added this
              </span>
              <span className="photo-by-when">
                {photo.when} · {photo.whenAgo}
              </span>
            </span>

            <a className="photo-get" href={photo.full} download>
              Download
            </a>

            <PhotoActions
              photoId={photo.id}
              mine={photo.mine}
              full={photo.full}
              onGone={() => location.assign(next ? href(next.id) : previous ? href(previous.id) : album)}
            />
          </div>

          <Filmstrip strip={strip} current={photo.id} href={href} />
        </div>

        <aside className="photo-aside">
          {/*
            Named, and the name is a link.

            It says what the column is — the album's conversation rather than
            this photograph's comments — and going to it opens the same thread
            with the room a long one needs.
          */}
          <a className="photo-chat-label" href={`${album}?tab=conversation`}>
            Album thread
          </a>
          <div className="photo-chat">
            <Thread
              eventId={event.id}
              messages={thread}
              canPost={canPost}
              people={people}
              members={members}
              onChanged={refresh}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * One step through the album, or the end of it.
 *
 * A `<span>` at either end rather than a disabled link, because a link with no
 * destination is not a thing HTML has: an `<a>` without `href` is not
 * focusable and not announced, which is exactly right for a control that
 * cannot do anything, and `aria-disabled` says why for anybody who lands on it
 * anyway.
 */
function Step({
  href,
  glyph,
  label,
}: {
  href: string | null;
  glyph: string;
  label: string;
}) {
  if (!href) {
    return (
      <span className="photo-step photo-step-end" aria-disabled="true" aria-label={label}>
        {glyph}
      </span>
    );
  }
  return (
    <a className="photo-step" href={href} aria-label={label}>
      {glyph}
    </a>
  );
}

/**
 * The photograph, or an honest statement that it would not load.
 *
 * Said in words rather than left blank. This is the page where somebody
 * reports a photograph or asks for it to be taken down, and every one of those
 * actions still works — you do not need to see a picture to know it is of you,
 * which is the whole reason the tile leading here stays clickable when its own
 * thumbnail has failed.
 */
function Subject({ photo }: { photo: PhotoSubject }) {
  const { ref, failed, onError } = useImageFailure(photo.full);

  if (failed) {
    return (
      <p className="photo-dead">
        This photo could not be loaded. The actions below still work.
      </p>
    );
  }

  return (
    <picture>
      {photo.sources
        .filter((source) => source.type !== 'image/jpeg')
        .map((source) => (
          <source key={source.type} srcSet={source.src} type={source.type} />
        ))}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={photo.full} alt="" onError={onError} />
    </picture>
  );
}

/**
 * Where you are in the album, and one press either side of it.
 *
 * Centred by arithmetic rather than by `scrollIntoView`, which scrolls every
 * scrollable ancestor to suit itself — on this page that means the window
 * jumping down to the strip on arrival, past the photograph somebody opened.
 */
function Filmstrip({
  strip,
  current,
  href,
}: {
  strip: { id: string; src: string }[];
  current: string;
  href: (id: string) => string;
}) {
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = rail.current;
    const here = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box || !here) return;
    box.scrollLeft = here.offsetLeft - box.clientWidth / 2 + here.clientWidth / 2;
  }, [current]);

  if (strip.length < 2) return null;

  return (
    <div className="photo-strip" ref={rail}>
      {strip.map((one) => (
        <a
          key={one.id}
          href={href(one.id)}
          data-current={one.id === current}
          className={`photo-strip-one${one.id === current ? ' photo-strip-on' : ''}`}
          aria-current={one.id === current ? 'true' : undefined}
          aria-label={one.id === current ? 'This photo' : 'Another photo in this album'}
        >
          {/* Decorative: the strip is a position, and eight alt texts reading
              "another photo" is eight things read out before the one that
              matters. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={one.src} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

type Action = 'removal-request' | 'report' | 'block';

/**
 * The completion messages, verbatim from the dialog this replaces.
 *
 * They are the only account somebody gets of what just happened to a report
 * they made, and the 48 hours in the first one is a commitment the takedown
 * job actually keeps. Rewording them is changing what the product promised.
 */
const DONE: Record<Action, string> = {
  'removal-request':
    'Asked the host to take it down. If they have not answered in 48 hours it is hidden automatically.',
  report: 'Reported. Someone will look at it.',
  block:
    'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.',
};

/**
 * Everything you can do about this one photograph.
 *
 * Behind a `···`, and that is the change from the dialog: there, `Report` and
 * `Block this person` were three buttons in the open under every photograph
 * anybody opened, at the same weight as a comment. Guideline 1.2 asks that
 * reporting be *reachable*, which one press of a visible control next to the
 * picture is. It does not ask for it to be the loudest thing on the page.
 *
 * The ownership split is unchanged. Your own upload gets an unceremonious
 * removal — no confirmation, no reason asked, because taking your own
 * photograph back is not a moderation event. Somebody else's gets the three
 * things you might legitimately want, and the block still asks twice.
 */
function PhotoActions({
  photoId,
  mine,
  full,
  onGone,
}: {
  photoId: string;
  mine: boolean;
  full: string;
  onGone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  async function act(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const url = action === 'block' ? '/api/blocks' : `/api/photos/${photoId}/${action}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'block' ? { photoId } : {}),
      });
      if (!res.ok) throw new Error('That did not work. Try again.');
      // The message stays and the page stays, including after a block — where
      // what is on screen is now one of the photographs you will not be shown
      // again. Leaving immediately would take away the only account somebody
      // gets of what just happened; the album drops their photographs the next
      // time it renders, which is when Back gets there.
      setDone(DONE[action]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove it. Try again.');
      // The photograph this page is about is gone, so the page has to go too —
      // staying would leave somebody looking at a picture that no longer
      // exists, with a `Remove` button under it.
      onGone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Menu label="More about this photo" glyph="···" tone="quiet" align="right">
        {(close) => (
          <>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(window.location.href).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
                close();
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {/* The header button's keyboard-reachable twin. Two controls for
                one action, which is worth it: the one above is where a hand
                goes and this one is where a keyboard already is. */}
            <a href={full} download onClick={close}>
              Download
            </a>

            {mine ? (
              <>
                <button className="menu-danger" onClick={remove} disabled={busy}>
                  {busy ? 'Removing…' : 'Remove my photo'}
                </button>
                <p className="muted">Yours. Nobody has to approve this.</p>
              </>
            ) : (
              <>
                <button onClick={() => { close(); void act('removal-request'); }} disabled={busy}>
                  That&rsquo;s me — take it down
                </button>
                <button onClick={() => { close(); void act('report'); }} disabled={busy}>
                  Report
                </button>
                {/* Still two presses, and the second one says what it does
                    rather than asking "are you sure" about a word. */}
                {confirming ? (
                  <button
                    className="menu-danger"
                    onClick={() => { close(); setConfirming(false); void act('block'); }}
                    disabled={busy}
                  >
                    Block — hide all their photos
                  </button>
                ) : (
                  <button onClick={() => setConfirming(true)} disabled={busy}>
                    Block this person
                  </button>
                )}
              </>
            )}
          </>
        )}
      </Menu>

      {/*
        On the page where the menu was, not a toast.

        A message that fades is one somebody can miss, and what it says here is
        the only account they get of what happened to a report they made.
      */}
      {(done || error) && <p className="photo-said">{done ?? error}</p>}
    </>
  );
}
