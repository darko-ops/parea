'use client';

/**
 * A room's icon: a letter on its own colour, or the people in it.
 *
 * The app's `RoomMark` on the site — same rule, same shape, same reasoning,
 * because a group that is three overlapping faces on a phone and a grey `J`
 * in a browser is two different rooms to the person who uses both.
 *
 * ## Which rooms get which
 *
 * A group somebody has *named* wears a letter, always: the name is the thing
 * they chose and the letter is the shortest way to draw it. A room nobody has
 * named has no letter to wear — its title is already made out of the people in
 * it ("Ana, Jack + 1 more"), so the icon is made out of them too.
 *
 * It does not break the rule that a group tile is never a photograph. That
 * rule is about the pictures *inside* the room: borrowing a cover out of an
 * album would put something from a room onto the way in to it, where somebody
 * who has not been let in can see it. A member's own portrait is theirs, it is
 * already on their profile, and this is only ever drawn for a room the viewer
 * is in — see `deckFor`, which builds the list, and the door on Find, which
 * still carries a name and a count and nothing about who is behind it.
 *
 * ## Squares, and overlapping
 *
 * Squares because the thing it stands in for is a square: it sits where the
 * lettered tile sits, in a column of them, and a circle there would make the
 * unnamed rooms read as a different kind of row rather than as the same row
 * drawn from what it has. The faces over an album's cover stay circles — that
 * is a crowd read as a row, and this is one object.
 *
 * Overlapping rather than tiled, and leading-edge first, so the deck occupies
 * the tile's own square whatever it holds: one picture fills it, three sit
 * across it, and the row's text starts at the same x either way.
 */

import { useImageFailure } from './useImageFailure';

export type Deck = { name: string; avatarUrl: string | null }[];

/** The first letter, for a tile. Trimmed, because " dinner" has one. */
const initialOf = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

/**
 * One card of the deck.
 *
 * Its own component because of the hook: an avatar URL is presigned and lasts
 * an hour, so a tab left open outlives it and the browser's answer is a broken
 * glyph in the middle of somebody's chat list. `useImageFailure` turns that
 * into the letter — which is what a member with no picture has anyway, so the
 * two failures land in the same place and neither needs explaining.
 *
 * Hooks cannot be called in a loop body, which is the whole reason this is not
 * inlined into the `map` below.
 */
function Card({
  person,
  size,
  offset,
  z,
}: {
  person: { name: string; avatarUrl: string | null };
  size: number;
  offset: number;
  z: number;
}) {
  const { ref, failed, onError } = useImageFailure(person.avatarUrl ?? '');
  const show = person.avatarUrl && !failed;

  return (
    <span
      className="room-card"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        left: offset,
        top: offset,
        zIndex: z,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {show ? (
        // Not next/image: the URL is presigned and expires, and the optimiser
        // would cache a copy under a key that outlives the signature.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={person.avatarUrl!} alt="" onError={onError} />
      ) : (
        initialOf(person.name)
      )}
    </span>
  );
}

export function RoomMark({
  title,
  kind,
  deck,
  lens,
  size,
  className = '',
}: {
  title: string;
  kind: 'named' | 'direct' | 'unnamed';
  /**
   * Optional only so the render cannot die of an older payload.
   *
   * Not a second policy — it is the same empty list the server defaults to —
   * but this is a render, and a render that reaches into a field the server
   * might not have sent takes the whole page down rather than drawing one row
   * badly. The app's copy of this carries the same guard after it happened
   * there: "Cannot read property 'length' of undefined" on every chat, from a
   * client newer than the deploy it was talking to.
   */
  deck?: Deck;
  lens: { fill: string; ink: string };
  size: number;
  className?: string;
}) {
  const cards = (deck ?? []).slice(0, 3);

  if (kind === 'named' || cards.length === 0) {
    return (
      <span
        className={`group-tile ${className}`.trim()}
        style={{ background: lens.fill, color: lens.ink }}
        aria-hidden="true"
      >
        {initialOf(title)}
      </span>
    );
  }

  /*
   * One person fills the square; more than one is a deck across it.
   *
   * Three and not the whole membership — `deckFor` already caps it, and this
   * caps it again because the cap is a drawing decision: a fourth card at this
   * size is four points of somebody's face, which is a texture rather than a
   * person. The title beside it already says how many there are.
   */
  const card = cards.length === 1 ? size : Math.round(size * 0.72);
  const step = cards.length === 1 ? 0 : Math.round((size - card) / (cards.length - 1));

  return (
    <span
      className={`room-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {cards.map((person, i) => (
        // Later cards sit over earlier ones, and each wears a ring of the
        // page's own colour so the stack reads as three things rather than as
        // one shape with bites out of it.
        <Card key={`${person.name}-${i}`} person={person} size={card} offset={i * step} z={i} />
      ))}
    </span>
  );
}
