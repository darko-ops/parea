/**
 * The last cell in a grid of events, which is not an event.
 *
 * It is the affordance and the entire empty state at once: with nothing in the
 * grid this is the only cell, and it says what the product does rather than
 * apologising for having nothing to show. With eleven events beside it the
 * grid never reads as finished.
 *
 * A component rather than eight lines of JSX, because it is on two screens and
 * was already on two screens as two copies — which is how the You page's copy
 * missed the lens pair when the cards grew one. Everything that is drawn in
 * more than one place in this product has eventually drifted; this is cheaper
 * than another guard test.
 */

import { CREATE_LENSES, Lenses } from './Lenses';

export function CreateCard() {
  return (
    <a href="/" className="card-new">
      {/* Two lenses, not the whole mark: an empty slot in a grid of events is
          not a place to sign the product's name. Deliberately not the mark's
          opening two, so this does not rhyme with the empty-event card. */}
      <Lenses count={2} size={18} palette={CREATE_LENSES} />
      <strong>Create Album</strong>
      <span>
        Name it, say when it was, send the link. Nothing to sign up for at the
        other end to look.
      </span>
    </a>
  );
}
