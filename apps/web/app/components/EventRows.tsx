/**
 * Everything that is not happening right now, at four to a screenful.
 *
 * The card grid gave every event 290px of width and a 150px mosaic, which is
 * the right treatment for an event and the wrong one for a list of eleven.
 * Four fitted above the fold; the twelfth existed only in theory. A row keeps
 * the photographs — they are still how you recognise which night this was —
 * but at 112×58, which is enough to tell a beach from a pub and small enough
 * that nine of them fit where four cards did.
 *
 * One bordered container with interior hairlines rather than eleven bordered
 * rows: a stack of separate boxes reads as eleven objects, and this is one
 * list. The rule between them is lighter than the container's own edge for
 * the same reason — it divides, it does not enclose.
 *
 * The create affordance is the last row rather than a cell in a grid, so the
 * list never reads as finished, and it is the entire empty state.
 */

import { mosaicLayout } from '@parea/cards';

import type { CardEvent } from '@/cards';

import { MosaicTile } from './MosaicTile';

export function EventRows({ events }: { events: CardEvent[] }) {
  return (
    <div className="rows">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}

      <a href="/" className="row-new">
        <span className="row-thumb-slot" aria-hidden="true">
          ＋
        </span>
        Create Event — name it, say when it was, send the link.
      </a>
    </div>
  );
}

function EventRow({ event }: { event: CardEvent }) {
  const photos = event.mosaic;
  const columns = mosaicLayout(photos.length);
  const empty = photos.length === 0;

  return (
    <a
      href={event.href ?? `/event/${event.id}`}
      className="row"
      aria-label={`${event.name}, ${event.photoCount} ${
        event.photoCount === 1 ? 'photo' : 'photos'
      }`}
    >
      {empty ? (
        // Not a grey box: a solid rectangle where a photograph goes reads as a
        // very dark photograph. Dashed and page-coloured says the slot is
        // waiting for something, which is exactly what this row is about.
        <span className="row-thumb-empty" aria-hidden="true">
          no photos
        </span>
      ) : (
        <span className="row-thumb" aria-hidden="true">
          {/*
            The same weights the mosaic would use, flattened to one strip: the
            hero stays the hero at this size, which is what makes a row and its
            card recognisable as the same event.
          */}
          {columns.map((column, i) => (
            <span key={i} style={{ flex: column.weight }}>
              <MosaicTile src={photos[column.photos[0]!]!} />
            </span>
          ))}
        </span>
      )}

      <span className="row-text">
        <span className="row-name">{event.name}</span>
        <span className="row-meta">
          {empty
            ? `${event.memberCount} ${
                event.memberCount === 1 ? 'person' : 'people'
              } · nobody has added anything yet`
            : event.meta}
        </span>
      </span>

      {/*
        A prompt, not a control — the row already goes to the event, and a real
        picker here would be a file input inside an anchor. It is styled as a
        button because that is what it is asking for.
      */}
      {empty ? (
        <span className="row-go">Add yours</span>
      ) : (
        <span className="row-count">{event.photoCount}</span>
      )}
    </a>
  );
}
