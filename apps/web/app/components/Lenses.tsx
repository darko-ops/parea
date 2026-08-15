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
 * How many circles, and what stands in for the rest.
 *
 * The palette caps it at four — a fifth would have to invent a colour the mark
 * does not contain — and a caller can cap it lower. The card caps at three and
 * writes "+2 more" beside them, which is a change of mind worth recording: the
 * circles were a sense of scale rather than a count, and the argument against
 * appending a number was that it turns a texture into arithmetic. It does. It
 * also answers the question people actually have about an album they are
 * scanning, which is how many of them are in it.
 *
 * The overflow text is the caller's, not this component's, because it belongs
 * to the sentence it sits in.
 */
export function Lenses({
  count,
  size = 14,
  max,
  palette = LENSES,
}: {
  count: number;
  size?: number;
  /** Fewer circles than the palette allows. Defaults to all of them. */
  max?: number;
  palette?: string[];
}) {
  const cap = Math.min(max ?? palette.length, palette.length);
  const shown = Math.min(Math.max(count, 0), cap);
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
