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
 * The scrim is lighter than it was — `.34` at the top where it used to be
 * `.62` — because the point of the bleed is the album's own colour and the old
 * wash was most of the way to white before the text even arrived. The name is
 * `#14171c` on at least a `.34` white wash over a blurred photograph; if a
 * genuinely dark album ever fails contrast here the fix is to raise that stop,
 * not to darken the text, which would make every other card worse.
 *
 * An event with no photos gets neither mosaic nor bleed. Blurring nothing
 * produces a grey smear that reads as a loading state which never finishes, so
 * it becomes a different card entirely — see `card-empty` below.
 */

import { mosaicLayout } from '@parea/cards';

import type { CardEvent } from '@/cards';

import { Lenses } from './Lenses';
import { MosaicTile } from './MosaicTile';

export function EventCard({ event }: { event: CardEvent }) {
  const photos = event.mosaic;
  const columns = mosaicLayout(photos.length);
  const tracks = columns.map((column) => `${column.weight}fr`).join(' ');

  const label = `${event.name}, ${event.photoCount} ${
    event.photoCount === 1 ? 'photo' : 'photos'
  }`;

  /*
   * No photographs is a different card, not this card with the pictures
   * missing. What it has to do is get somebody to add the first one, so it is
   * mostly a button — and the lens cluster in the middle is the argument for
   * pressing it: two people's circles filled in and the third one dashed and
   * empty, the empty one being you.
   */
  if (photos.length === 0) {
    return (
      <a
        href={event.href ?? `/event/${event.id}`}
        className="card card-empty"
        aria-label={label}
      >
        <div>
          <div className="card-name">{event.name}</div>
          {event.caption && <div className="card-caption">{event.caption}</div>}
          <div className="card-meta">{emptyLine(event.memberCount)}</div>
        </div>

        <div className="card-empty-lenses" aria-hidden="true">
          <span />
          <span />
          <span className="card-empty-slot">＋</span>
        </div>

        <span className="card-empty-go">Add yours first</span>
      </a>
    );
  }

  return (
    <a
      href={event.href ?? `/event/${event.id}`}
      className="card"
      aria-label={label}
    >
      <div className="mosaic" style={{ gridTemplateColumns: tracks }}>
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

      <div className="card-body">
        {/*
          Decorative, and hidden from assistive tech: it is the same images
          again, and announcing them twice is noise. `-26px` inset so the blur
          has bleed and no soft edge shows at the corners.

          One band per *column*, at the column's own width — not one per photo
          at equal widths. The point of the effect is that the colour under a
          piece of text is the colour of the photo directly above it, and equal
          bands slide the hero's colour off to the left of where it belongs.
        */}
        <div className="card-bleed" aria-hidden="true">
          {columns.map((column, i) => (
            <div key={i} style={{ flex: column.weight }}>
              <MosaicTile src={photos[column.photos[0]!]!} hidden />
            </div>
          ))}
        </div>
        <div className="card-scrim" aria-hidden="true" />

        <div className="card-text">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-name">{event.name}</div>
            {/*
              The host's own line, under the title and above the facts the
              page derived. One line, ellipsised: a card is a thing you scan,
              and a caption that wraps to three lines is a paragraph on a
              photograph.
            */}
            {event.caption && <div className="card-caption">{event.caption}</div>}
            {/*
              Lenses and place, where a sentence used to be. `event.meta` is
              still the fallback: an event with no place has nothing to put
              beside the circles, and "6 people ·" with nothing after it is
              worse than the sentence it replaced.
            */}
            <div className="card-who">
              <Lenses count={event.contributorCount} size={12} />
              <span className="card-where">{event.place ?? event.meta}</span>
            </div>
          </div>
          {/*
            No count. It is still in the card's `aria-label`, because "how many
            photographs" is a fact somebody navigating by screen reader has no
            other way to get — but on screen it was a number competing with the
            photographs it was counting, and the answer is one tap away.
          */}
        </div>
      </div>
    </a>
  );
}

/**
 * Who is in an event nobody has added to.
 *
 * Counted from the other side — "you and one other" rather than "2 people" —
 * because this card is asking the person reading it to do something, and the
 * sentence that asks is the one they are in.
 */
function emptyLine(memberCount: number): string {
  const others = Math.max(0, memberCount - 1);
  if (others === 0) return 'Just you so far. Nothing in it yet.';
  if (others === 1) return 'You and one other. Nothing in it yet.';
  return `You and ${others} others. Nothing in it yet.`;
}
