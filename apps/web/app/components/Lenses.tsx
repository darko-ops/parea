/**
 * The mark, taken apart — one circle per person who put something here.
 *
 * The Parea mark is three overlapping lenses, and what it means is three
 * people's photographs of one evening landing in the same place. Drawing one
 * lens per contributor is that idea used as information rather than as
 * decoration: the card gets more colourful as more people add to it, which is
 * the thing the product is trying to make happen.
 *
 * Not avatars. Avatars would be better if everybody had one, but most people
 * here are somebody a host sent a link to, and a row of grey letter-circles is
 * a worse picture of "six people were at this" than six coloured lenses. It
 * also means the card says nothing about *who* — which is a card on a home
 * screen someone else might be looking over your shoulder at.
 *
 * Decorative, and marked so: the count it stands for is already in the card's
 * `aria-label`, and a screen reader announcing four unlabelled images between
 * the name and the place is noise in the middle of a sentence.
 */

/** Mark order, from `Mark.tsx`. The fourth is one of the overlap colours. */
const LENSES = ['#ffb3b8', '#9db2f0', '#a5dcc6', '#f3b584'];

/**
 * The create affordance's pair, which is deliberately not the first two.
 *
 * An empty event and "make a new one" are different things sitting in the same
 * grid, and drawing both with the mark's opening colours makes them rhyme when
 * they should not. These are two of the overlap colours — the same family,
 * recognisably not the same object.
 */
export const CREATE_LENSES = ['#a5dcc6', '#c79ad9'];

/**
 * Four is the cap, and it is the palette's cap rather than an arbitrary one:
 * a fifth circle would have to invent a colour the mark does not contain.
 * Nothing is appended to say there are more — the number of lenses is a sense
 * of scale, not a count, and "+3" beside it would turn it into one badly.
 */
export function Lenses({
  count,
  size = 14,
  palette = LENSES,
}: {
  count: number;
  size?: number;
  palette?: string[];
}) {
  const shown = Math.min(Math.max(count, 0), palette.length);
  if (shown === 0) return null;

  return (
    <span className="lenses" aria-hidden="true">
      {palette.slice(0, shown).map((colour) => (
        <span
          key={colour}
          style={{ width: size, height: size, background: colour }}
        />
      ))}
    </span>
  );
}
