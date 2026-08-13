/**
 * The event still filling up, given the top of the page.
 *
 * Home was a grid of equal cards, which said that eleven events are eleven
 * equally interesting things. They are not: one of them has photographs
 * landing in it right now and the rest happened. This is that one, at a size
 * that says so, with the picker on it — the whole argument for a home screen
 * is that somebody arrives with photos on their phone and something has to be
 * within reach of them.
 *
 * Shown only when an event is genuinely live. A hero that promotes the
 * most-recently-touched event on a quiet week has to either lie about it
 * ("STILL COMING IN", about a barbecue in July) or drop its label and become a
 * large card for no reason. When nothing qualifies the page is rows, which is
 * denser and truer.
 *
 * A server component with one client leaf, matching how `EventCard` is built:
 * the upload queue is the only part that needs state, and it is `AddYours`.
 */

import { mosaicLayout } from '@parea/cards';

import type { CardEvent } from '@/cards';

import { AddYours } from './AddYours';
import { MosaicTile } from './MosaicTile';

/**
 * How recently added-to still counts as "happening".
 *
 * An hour. Long enough that putting the kettle on between two batches does not
 * demote the evening you are in the middle of, short enough that yesterday is
 * never the answer.
 */
export const LIVE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whether this event gets the top of the page.
 *
 * Two ways to be live and they are different facts. `arrivingCount` is bytes
 * mid-flight — somebody is uploading *now* — and recency covers the gap
 * between a batch finishing and the next one starting, which is most of an
 * evening.
 */
export function isLive(event: CardEvent, now: Date): boolean {
  if (event.arrivingCount > 0) return true;
  return now.getTime() - new Date(event.lastActiveAt).getTime() < LIVE_WINDOW_MS;
}

export function EventHero({ event }: { event: CardEvent }) {
  const photos = event.mosaic;
  const columns = mosaicLayout(photos.length);
  const tracks = columns.map((column) => `${column.weight}fr`).join(' ');

  return (
    <div className="hero">
      {photos.length > 0 && (
        <div className="mosaic hero-mosaic" style={{ gridTemplateColumns: tracks }}>
          {columns.map((column, i) =>
            column.photos.length > 1 ? (
              <div className="mosaic-split" key={i}>
                {column.photos.map((index) => (
                  <div key={index}>
                    <MosaicTile src={photos[index]!} />
                  </div>
                ))}
              </div>
            ) : (
              <div key={i}>
                <MosaicTile src={photos[column.photos[0]!]!} />
              </div>
            ),
          )}
        </div>
      )}

      <div className="card-body">
        {photos.length > 0 && (
          <>
            <div className="card-bleed" aria-hidden="true">
              {columns.map((column, i) => (
                <div key={i} style={{ flex: column.weight }}>
                  <MosaicTile src={photos[column.photos[0]!]!} hidden />
                </div>
              ))}
            </div>
            <div className="card-scrim hero-scrim" aria-hidden="true" />
          </>
        )}

        <div className="hero-text">
          <div style={{ flex: 1, minWidth: 0 }}>
            {/*
              The label is the reason this card is here, so it is above the
              name rather than in the meta line with everything else.
            */}
            <p className="hero-live">
              <span className="hero-dot" aria-hidden="true" />
              STILL COMING IN
            </p>
            {/*
              The link is on the name and stretched over the card by CSS, so
              the whole thing is one click target without the markup nesting a
              file input inside an anchor. `AddYours` lifts itself back above
              it — see `.hero-text .add-yours`.
            */}
            <h2 className="hero-name">
              <a href={`/event/${event.id}`}>{event.name}</a>
            </h2>
            <p className="hero-meta">
              {event.meta}
              {/*
                The tail exists only while something is mid-flight, and it is
                the one number on this page that is not about the past.
              */}
              {event.arrivingCount > 0 &&
                ` · ${event.arrivingCount} arriving`}
            </p>
          </div>

          <AddYours eventId={event.id} />

          <div className="hero-count">{event.photoCount}</div>
        </div>
      </div>
    </div>
  );
}
