'use client';

/**
 * Framing the cover, in a browser — the app's `CoverFramer`, for the web.
 *
 * A card is a letterbox and a photograph usually is not, so a cover is always
 * a cut, and the web used to make that cut without showing anybody which part:
 * the server centred on whatever its attention model liked. The app has asked
 * since it had covers. This asks the same way: the whole photograph on black,
 * a fixed frame the shape the card will be, everything outside the frame
 * dimmed but visible, and the picture moves under it.
 *
 * ## What it produces
 *
 * The same three numbers the app sends — `object-position` percentages and a
 * zoom — and nothing else. The original goes up untouched and the server cuts
 * it with `regionFor` in `@/cover`, which is the rule this screen draws with.
 * Percentages rather than pixels, so the preview here (a thumbnail) and the
 * file the server decodes (scaled in the browser first, see `coverBytes`)
 * agree about where the frame sits without either knowing the other's size.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { COVER_MAX_ZOOM, coverAspect, type CoverFraming } from '@/cover';

import { useImageFailure } from './useImageFailure';

export type { CoverFraming };
export const CENTRED: CoverFraming = { x: 50, y: 50, zoom: 1 };

export type CoverCandidate = { id: string; src: string };

/** Where the picture sits under a frame of `box`, given how it is framed. */
function placement(
  natural: { w: number; h: number },
  box: { w: number; h: number },
  framing: CoverFraming,
) {
  const scale = Math.max(box.w / natural.w, box.h / natural.h) * framing.zoom;
  const w = natural.w * scale;
  const h = natural.h * scale;
  const slackX = Math.max(0, w - box.w);
  const slackY = Math.max(0, h - box.h);
  return { w, h, slackX, slackY, left: -slackX * (framing.x / 100), top: -slackY * (framing.y / 100) };
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const clampZoom = (value: number) => Math.min(COVER_MAX_ZOOM, Math.max(1, value));

/** The framing as the cover route reads it — see `framingOf` in `@/cover`. */
export function framingQuery(framing: CoverFraming): string {
  return new URLSearchParams({
    cx: framing.x.toFixed(2),
    cy: framing.y.toFixed(2),
    cz: framing.zoom.toFixed(3),
  }).toString();
}

export function CoverFramer({
  photos,
  coverId,
  initial = CENTRED,
  sharpen,
  onCancel,
  onConfirm,
}: {
  photos: CoverCandidate[];
  coverId: string;
  initial?: CoverFraming;
  /**
   * A larger copy of a candidate, for the frame. The strip's pictures are
   * thumbnails, and a thumbnail is soft once somebody zooms in to decide
   * between two faces; this is asked for the one in the frame only.
   */
  sharpen?: (id: string) => Promise<string | null>;
  onCancel: () => void;
  onConfirm: (coverId: string, framing: CoverFraming) => void;
}) {
  const [chosen, setChosen] = useState(coverId);
  const [framing, setFraming] = useState<CoverFraming>(initial);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });

  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const cover = photos.find((photo) => photo.id === chosen) ?? photos[0] ?? null;

  const [sharp, setSharp] = useState<{ id: string; url: string } | null>(null);
  const coverKey = cover?.id ?? null;
  useEffect(() => {
    if (!sharpen || !coverKey) return;
    let live = true;
    void sharpen(coverKey).then((url) => {
      if (live && url) setSharp({ id: coverKey, url });
    });
    return () => {
      live = false;
    };
  }, [sharpen, coverKey]);
  const stageSrc = cover ? (sharp?.id === cover.id ? sharp.url : cover.src) : '';
  /*
   * A picture this browser cannot draw — a HEIC outside Safari, a file whose
   * loan ended. Said in words rather than left as an empty black frame, and
   * Use still works: the server can read what the browser could not, and with
   * nothing to frame by it centres the cover on its own.
   */
  const { ref: stageRef, failed: stageFailed, onError: onStageError } = useImageFailure(stageSrc);

  /*
   * The frame: as wide as the screen allows up to a laptop's comfortable width,
   * in the shape the card will be — which is this photograph's own shape held
   * between 3:2 and 4:5, exactly as the server bounds it.
   */
  const frame = useMemo(() => {
    const aspect = natural ? coverAspect(natural) : 3 / 2;
    let w = Math.min(560, viewport.w - 32);
    let h = w / aspect;
    const tallest = viewport.h * 0.5;
    if (h > tallest) {
      h = tallest;
      w = h * aspect;
    }
    return { w, h };
  }, [natural, viewport]);
  const stage = { w: Math.min(viewport.w, frame.w * 1.5), h: Math.min(viewport.h * 0.66, frame.h * 1.6) };
  const shot = natural ? placement(natural, frame, framing) : null;
  const movable = Boolean(shot && (shot.slackX > 0 || shot.slackY > 0));

  /*
   * Dragging and pinching, by pointer.
   *
   * Pointers rather than mouse and touch separately, so one path serves a
   * trackpad, a mouse and a finger. Two pointers down is a pinch: the zoom
   * follows the distance between them. The move is measured against where it
   * started rather than accumulated, so the picture stays under the finger.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ framing: CoverFraming; x: number; y: number; span: number } | null>(null);
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const framingRef = useRef(framing);
  framingRef.current = framing;

  const restart = () => {
    const points = [...pointers.current.values()];
    if (points.length === 0) {
      start.current = null;
      return;
    }
    const span =
      points.length >= 2 ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0;
    start.current = { framing: framingRef.current, x: points[0]!.x, y: points[0]!.y, span };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.current.values()];
    const from = start.current;
    if (points.length >= 2 && from.span > 0) {
      const span = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      setFraming((was) => ({ ...was, zoom: clampZoom((from.framing.zoom * span) / from.span) }));
      return;
    }
    const current = shotRef.current;
    if (!current) return;
    const dx = points[0]!.x - from.x;
    const dy = points[0]!.y - from.y;
    setFraming((was) => ({
      ...was,
      x: current.slackX > 0 ? clamp(from.framing.x - (dx / current.slackX) * 100) : 50,
      y: current.slackY > 0 ? clamp(from.framing.y - (dy / current.slackY) * 100) : 50,
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    restart();
  };
  const onWheel = (e: React.WheelEvent) => {
    setFraming((was) => ({ ...was, zoom: clampZoom(was.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)) }));
  };

  const tryPhoto = useCallback(
    (photo: CoverCandidate) => {
      if (photo.id === chosen) return;
      setChosen(photo.id);
      setFraming(photo.id === coverId ? initial : CENTRED);
      setNatural(null);
    },
    [chosen, coverId, initial],
  );

  const frameLeft = (stage.w - frame.w) / 2;
  const frameTop = (stage.h - frame.h) / 2;

  return (
    <div className="framer" role="dialog" aria-modal="true" aria-label="Frame the cover">
      <div className="framer-bar">
        <button type="button" className="framer-side" onClick={onCancel}>
          Cancel
        </button>
        <span className="framer-title">Cover</span>
        <button
          type="button"
          className="framer-do"
          disabled={!cover}
          onClick={() => cover && onConfirm(cover.id, framing)}
        >
          Use
        </button>
      </div>

      <div
        className="framer-stage"
        style={{ width: stage.w, height: stage.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {cover && stageFailed && (
          <p className="framer-hint framer-unreadable">
            This browser cannot show this picture. Use it as it is and it will be centred.
          </p>
        )}
        {cover && !stageFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={stageRef}
            onError={onStageError}
            key={cover.id}
            src={stageSrc}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            style={{
              position: 'absolute',
              left: frameLeft + (shot?.left ?? 0),
              top: frameTop + (shot?.top ?? 0),
              width: shot?.w ?? frame.w,
              height: shot?.h ?? frame.h,
              objectFit: shot ? 'fill' : 'cover',
            }}
          />
        )}
        {/* One element whose shadow is the dimming: everything outside the
            frame, and nothing inside it. */}
        <div
          className="framer-frame"
          style={{ left: frameLeft, top: frameTop, width: frame.w, height: frame.h }}
        />
      </div>

      <p className="framer-hint">
        {movable ? 'Drag to move it. Zoom to go closer.' : 'This one fits the card exactly. Zoom to go closer.'}
      </p>
      <label className="framer-zoom">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={COVER_MAX_ZOOM}
          step={0.01}
          value={framing.zoom}
          onChange={(e) => setFraming((was) => ({ ...was, zoom: clampZoom(Number(e.target.value)) }))}
        />
      </label>

      {photos.length > 1 && (
        <div className="framer-strip">
          <span className="framer-strip-label">IN THIS ROLL</span>
          <div className="framer-strip-row">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className={`framer-thumb${photo.id === chosen ? ' framer-thumb-on' : ''}`}
                aria-pressed={photo.id === chosen}
                aria-label={photo.id === chosen ? 'Cover photo' : 'Try this as the cover'}
                onClick={() => tryPhoto(photo)}
              >
                <StripShot src={photo.src} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One picture in the strip, and an empty tile when it will not draw. */
function StripShot({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);
  if (!src || failed) return <span className="framer-thumb-dead" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} onError={onError} src={src} alt="" />;
}

