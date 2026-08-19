/**
 * One album, led by its photograph.
 *
 * The photograph *is* the card: a tall cover, the faces of the people in it
 * overlapping its bottom edge, and two lines underneath. No border, no panel,
 * no strip of chrome — the previous card had a metadata strip over a blurred
 * bleed of its own images, and the effect was handsome and made a wall of
 * evenings look like a wall of listings.
 *
 * What came off it is as much the design as what is on it. The mosaic of three
 * or four tiles is gone, and with it the argument that a card should show a
 * sample of what is inside: one picture chosen as the cover says more, and the
 * sample was four thumbnails too small to recognise anybody in. The caption is
 * gone from this screen — it is on the album itself, and on a card a second
 * sentence under the name is the listing impression.
 *
 * What replaced them is people. Three faces and "8 people · Fri 14 Mar", which
 * is how somebody actually recognises an evening: who was there and when it
 * was. The count in the aria-label is unchanged, because "how many
 * photographs" is a fact somebody navigating by screen reader has no other way
 * to get.
 *
 * An album with no photographs gets none of this. Blurring or cropping nothing
 * produces a grey rectangle that reads as a loading state which never
 * finishes, so it stays the separate card below whose job is to get the first
 * photograph out of somebody.
 */

import type { CardEvent } from '@/cards';

import { Face } from './Faces';
import { CoverImage } from './CoverImage';

/**
 * The letter in somebody's circle when they have no picture.
 *
 * Never a silhouette, which is a photograph of nobody — the same rule
 * `Faces.tsx` states and the design spells out again for the people row.
 */
function initial(name: string): string {
  return (name.trim() || '?').slice(0, 1).toUpperCase();
}

export function EventCard({ event }: { event: CardEvent }) {
  const cover = event.cover;

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
  /*
   * On the photograph count, not on the mosaic.
   *
   * They were the same number until albums could have a cover. A cover is
   * prepended to the mosaic, so an album with a cover and nothing in it yet
   * has one tile to draw — and drawing it would replace the only card in the
   * product whose job is to get the first photograph out of somebody with a
   * card that says nothing. The cover waits until there is something to lead.
   */
  if (event.photoCount === 0) {
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
      {/*
        The photograph is the card. No border, no panel, no strip of chrome
        under it — a tall cover with the name beneath, which is what a shelf of
        albums looks like when it is not trying to look like a listing.
      */}
      <div className="card-cover">
        {cover && <CoverImage src={cover.src} sources={cover.sources} />}
        {/*
          Only while it is true, which is an hour. A badge that stays up all
          day is a badge nobody reads, and "being added to now" is the one
          claim on this page worth interrupting a photograph for.
        */}
        {event.live && (
          <span className="card-live">
            <span className="card-live-dot" aria-hidden="true" />
            Being added to now
          </span>
        )}
      </div>

      {/*
        Overlapping the photograph's bottom edge rather than sitting under it.
        These are the people, and the point of the design is that they are the
        first thing you recognise an evening by — a row of circles floating
        below a picture reads as metadata, the same row half over it reads as
        who was there.
      */}
      {event.faces.length > 0 && (
        <div className="card-faces">
          {event.faces.map((face, i) => (
            <Face
              key={`${face.name}-${i}`}
              src={face.avatar}
              size={32}
              className="card-facel"
              fallback={
                <span aria-hidden="true">{initial(face.name)}</span>
              }
            />
          ))}
          {event.moreFaces > 0 && (
            <span className="card-facel card-more" aria-hidden="true">
              +{event.moreFaces}
            </span>
          )}
        </div>
      )}

      <div className="card-under">
        <div className="card-name">{event.name}</div>
        {/*
          Whose album it is, in their own two names.

          Both, always. The name is what somebody recognises — it is how they
          are spoken about — and the handle is what is unique, so printing one
          of them makes the reader guess which they are looking at. On your own
          albums the name is "You": your own name read back at you on a wall of
          your own evenings is the page describing you to yourself.

          Either can be missing on its own — an account is optional here, and
          so is a display name — and what is left stands alone rather than
          leaving a gap where the other was.
        */}
        {(event.mine || event.creatorName || event.creatorHandle) && (
          <div className="card-host">
            {(event.mine || event.creatorName) && (
              <span className="card-host-name">
                {event.mine ? 'You' : event.creatorName}
              </span>
            )}
            {event.creatorHandle && (
              <span className="card-host-handle">@{event.creatorHandle}</span>
            )}
          </div>
        )}
        {/*
          Who and when, in that order, and the when is the evening rather than
          the upload — except on an album being added to now, where the recent
          thing *is* the news. No caption on this line and none above it: a
          second sentence under the name is what made a photograph look like a
          listing. The album with no photographs still has one, because that
          card is text and the sentence is most of what it has.
        */}
        <div className="card-meta">
          {event.memberCount} {event.memberCount === 1 ? 'person' : 'people'}
          {(event.live || event.date) && ' · '}
          {event.live ? `added to ${event.added}` : event.date}
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
