/**
 * One event, led by its photos.
 *
 * A name is a poor way to recognise a night out and the photos are a good one,
 * so the card is mostly mosaic. Underneath, the detail strip has no dividing
 * line above it — instead the event's own colours bleed upward under the text:
 * the same images again, mirrored, blurred and scrimmed. That is what joins
 * the two halves into one object rather than a picture with a caption.
 *
 * Cheap, too. The mirrored copies are the same URLs the mosaic already
 * fetched, so the browser serves them from cache and the effect costs one
 * blur filter rather than a second round of image loads.
 *
 * An event with no photos gets neither mosaic nor bleed. Blurring nothing
 * produces a grey smear that reads as a loading state which never finishes.
 */

import type { CardEvent } from '@/cards';

/**
 * Tile arrangement, by how many photos there are.
 *
 * One hero plus supporting tiles, which is the pattern the design specifies.
 * Chosen by count rather than by position, so a card with two photos is a
 * deliberate two-tile layout and not a four-tile layout with two holes in it —
 * the design is explicit that missing tiles fall back rather than stretch.
 *
 * Returns the columns already grouped, so the caller renders what it is given
 * instead of re-deriving which column holds two.
 */
function layout(photos: string[]): { columns: string; groups: string[][] } {
  const [a, b, c, d] = photos;
  switch (photos.length) {
    case 1:
      return { columns: '1fr', groups: [[a!]] };
    case 2:
      return { columns: '1fr 1fr', groups: [[a!], [b!]] };
    case 3:
      return { columns: '1fr 1fr 2fr', groups: [[a!], [b!], [c!]] };
    default:
      // Hero left, a stacked pair centre, one tall tile right. Four photos in
      // the shape the design draws with five, rather than fetching a fifth
      // for every card of every home screen to fill one corner.
      return { columns: '2fr 1fr 1fr', groups: [[a!], [b!, d!], [c!]] };
  }
}

export function EventCard({ event }: { event: CardEvent }) {
  const photos = event.mosaic;
  const { columns, groups } = layout(photos);

  return (
    <a
      href={`/event/${event.id}`}
      className={`card${photos.length === 0 ? ' card-bare' : ''}`}
      aria-label={`${event.name}, ${event.photoCount} ${
        event.photoCount === 1 ? 'photo' : 'photos'
      }`}
    >
      {photos.length > 0 && (
        <div className="mosaic" style={{ gridTemplateColumns: columns }}>
          {groups.map((column, i) =>
            column.length > 1 ? (
              <div className="mosaic-split" key={i}>
                {column.map((src) => (
                  <div key={src}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" loading="lazy" />
                  </div>
                ))}
              </div>
            ) : (
              <div key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={column[0]!} alt="" loading="lazy" />
              </div>
            ),
          )}
        </div>
      )}

      <div className="card-body">
        {photos.length > 0 && (
          <>
            {/*
              Decorative, and hidden from assistive tech: it is the same
              images again, and announcing them twice is noise. `-24px` inset
              so the blur has bleed and no soft edge shows at the corners.
            */}
            <div className="card-bleed" aria-hidden="true">
              {photos.map((src) => (
                <div key={src}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" />
                </div>
              ))}
            </div>
            <div className="card-scrim" aria-hidden="true" />
          </>
        )}

        <div className="card-text">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-name">{event.name}</div>
            <div className="card-meta">{event.meta}</div>
          </div>
          {/*
            A bare number. "88 photos" in a pill with an icon is three pieces
            of furniture around one fact, and the column of numbers down the
            right of the grid is easier to read than any of them.
          */}
          <div className="card-count">{event.photoCount}</div>
        </div>
      </div>
    </a>
  );
}
