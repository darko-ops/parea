'use client';

/**
 * One moment, in the roll photograph's own page.
 *
 * Deliberately the same view: the same header with its way back and its two
 * steps, the same frame, the same byline and the same strip under it — built
 * from `PhotoView`'s pieces and its classes rather than a second design of
 * "looking at one photograph". What is missing is what a moment does not
 * have: there is no roll, so no roll thread beside it, and nobody reacts to or
 * stars one.
 *
 * The strip and the steps run through everybody's moments in the row's order,
 * so stepping past the last of one person's carries on into the next person's
 * — the row on Home, walked one picture at a time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Face } from './Faces';
import { Filmstrip, Step } from './PhotoView';
import { Menu } from './Menu';
import { useImageFailure } from './useImageFailure';

export type MomentSubject = {
  id: string;
  src: string;
  mine: boolean;
  by: string;
  byAvatar: string | null;
  byHandle: string | null;
  when: string;
  whenAgo: string;
};

const HOME = '/events';

export function MomentView({
  moment,
  query,
  back,
  position,
  previous,
  next,
  strip,
}: {
  moment: MomentSubject;
  /** Carried from step to step: whose moments, and the order held still. */
  query: string;
  /** Somebody's page, when that is where this was opened from. Else Home. */
  back: { href: string; name: string } | null;
  position: { index: number; total: number };
  previous: { id: string; src: string } | null;
  next: { id: string; src: string } | null;
  strip: { id: string; src: string }[];
}) {
  const href = useCallback((id: string) => `/moments/${id}?${query}`, [query]);
  const home = back?.href ?? HOME;
  const homeName = back?.name ?? 'Home';
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    frame.current?.focus({ preventScroll: true });
  }, [moment.id]);

  // The neighbours, warmed into the cache. See `PhotoView`.
  useEffect(() => {
    for (const neighbour of [previous, next]) {
      if (!neighbour) continue;
      const image = new Image();
      image.src = neighbour.src;
    }
  }, [previous, next]);

  // Arrows page, Escape goes home — the same keys as a roll's photograph.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && previous) location.assign(href(previous.id));
      else if (e.key === 'ArrowRight' && next) location.assign(href(next.id));
      else if (e.key === 'Escape') {
        if (document.querySelector('[role="menu"]')) return;
        location.assign(home);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previous, next, href, home]);

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

  const { ref, failed, onError } = useImageFailure(moment.src);

  return (
    <main className="photo-page moment-page">
      <header className="photo-head">
        <a href={home} className="photo-back" aria-label={`Back to ${homeName}`}>
          {'‹'}
        </a>
        <span className="photo-back-text">
          Back to{' '}
          <a href={home} className="photo-back-name">
            {homeName}
          </a>
        </span>

        <span className="photo-where">
          {position.index + 1} of {position.total}
        </span>
        <Step href={previous ? href(previous.id) : null} glyph={'←'} label="Previous moment" />
        <Step href={next ? href(next.id) : null} glyph={'→'} label="Next moment" />
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
            {failed ? (
              <p className="photo-dead">This moment could not be loaded.</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={ref} src={moment.src} alt="" onError={onError} />
            )}
          </div>

          <div className="photo-verbs">
            <span />
            <span className="photo-verbs-do">
              <a
                className="photo-icon"
                href={moment.src}
                download
                aria-label="Download this photo"
                title="Download"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3.5v11" />
                  <path d="M8.5 11 12 14.5 15.5 11" />
                  <path d="M4 15.5v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
                </svg>
              </a>

              <MomentActions
                momentId={moment.id}
                mine={moment.mine}
                onGone={() =>
                  location.assign(next ? href(next.id) : previous ? href(previous.id) : home)
                }
              />
            </span>
          </div>

          <div className="photo-by">
            <Face
              src={moment.byAvatar}
              size={36}
              className="photo-by-face"
              fallback={
                <span aria-hidden="true">
                  {moment.by.replace(/^@/, '').slice(0, 1).toUpperCase()}
                </span>
              }
            />
            <span className="photo-by-text">
              <span className="photo-by-who">
                {moment.byHandle ? (
                  <a href={`/u/${moment.byHandle}`}>
                    <strong>{moment.by}</strong>
                  </a>
                ) : (
                  <strong>{moment.by}</strong>
                )}{' '}
                shared this
              </span>
              <span className="photo-by-when">
                {moment.when} · {moment.whenAgo}
              </span>
            </span>
          </div>

          <Filmstrip strip={strip} current={moment.id} href={href} other="Another moment" />
        </div>
      </div>
    </main>
  );
}

/**
 * What you can do about one moment: take your own back, or stop seeing
 * somebody's. Two presses for the block, as on a roll's photograph.
 */
function MomentActions({
  momentId,
  mine,
  onGone,
}: {
  momentId: string;
  mine: boolean;
  onGone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    setSaid(null);
    const res = await fetch(`/api/moments/${momentId}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) return onGone();
    setSaid('Could not remove it. Try again.');
    setBusy(false);
  }

  async function block() {
    setBusy(true);
    setSaid(null);
    const res = await fetch('/api/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ momentId }),
    }).catch(() => null);
    setBusy(false);
    setSaid(
      res?.ok
        ? 'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.'
        : 'That did not work. Try again.',
    );
  }

  return (
    <>
      <Menu label="More about this moment" glyph="···" tone="quiet" align="right">
        {(close) =>
          mine ? (
            <>
              <button className="menu-danger" onClick={remove} disabled={busy}>
                {busy ? 'Removing…' : 'Remove my moment'}
              </button>
              <p className="muted">Yours. Nobody has to approve this.</p>
            </>
          ) : confirming ? (
            <button
              className="menu-danger"
              onClick={() => { close(); setConfirming(false); void block(); }}
              disabled={busy}
            >
              Block — hide all their photos
            </button>
          ) : (
            <button onClick={() => setConfirming(true)} disabled={busy}>
              Block this person
            </button>
          )
        }
      </Menu>
      {said && <p className="photo-said">{said}</p>}
    </>
  );
}
