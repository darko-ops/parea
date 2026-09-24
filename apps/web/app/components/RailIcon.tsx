/**
 * One glyph per rail row.
 *
 * The web client had exactly one icon — the magnifier on the sign-in screen —
 * and a comment beside it saying so, on the grounds that nine lines of SVG
 * beats a dependency and an icon set for a single glyph. Five is still nine
 * lines each, and still not a dependency; what has changed is that the rail is
 * now five rows of similar-length words, and a shape beside each one is what
 * makes it findable without reading.
 *
 * Every one of them is now the app's. The rail had drawn its own house for
 * Home and its own envelope for Activity while the app's bar showed a photo
 * stack and a tray for the same two places — two clients with two pictures of
 * one product, which is the thing having a shared set was supposed to prevent.
 * The house and the envelope are gone rather than kept beside their
 * replacements: an unused glyph is one somebody reaches for later, and then
 * the two clients disagree again.
 *
 * All drawn on the same 24-unit grid with the same 2-unit stroke and round
 * caps as `SearchIcon`, because the alternative — an icon set — arrives with
 * its own weight, its own corner radius and its own idea of optical size, and
 * then the one hand-drawn glyph in the product looks like the mistake.
 *
 * Deliberately plain outlines. A filled icon reads as a selected state, and
 * the rail already says which row you are on twice over — a grey wash behind
 * it, and the same drawing at half a stroke more. A filled variant would be a
 * second set of paths to keep in step for a state that is already said.
 */

export type RailGlyph =
  /*
   * The app's tab bar, in the same order: Albums, Chats, Find, You. Ported
   * from its `Glyph.tsx` — which took the rail's own drawings in the first
   * place, so this is the set coming back rather than a second set arriving.
   *
   * `bubble` against `bubbles` is the distinction that makes them worth
   * having: one is a remark about a thing, which is an album's comments, and
   * two is people going back and forth, which is a group's chat. The app
   * checked that it survives at 22 points, which is the size both clients
   * draw them at.
   */
  | 'photos'
  | 'bubble'
  | 'bubbles'
  | 'search'
  | 'profile'
  /* Notifications, and the one the web has that the app's bar does not. */
  | 'tray'
  | 'groups'
  | 'settings'
  /* Create. The app's own `+`, in the app's own round chrome. */
  | 'plus';

export function RailIcon({
  glyph,
  /**
   * A heavier stroke for the row you are on.
   *
   * The app's bar does the same and its note is the argument: the selected
   * glyph steps up in value *and* in weight, because one without the other is
   * half a state — and on a bar floating over a bright photograph a two-step
   * change in value alone is easy to miss. 2 is the family's own.
   */
  weight = 2,
}: {
  glyph: RailGlyph;
  weight?: number;
}) {
  return (
    <svg
      className="rail-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph === 'photos' && (
        /* A photograph behind a photograph, which is what an album is — the
           frame is the stack and the picture inside it is the one on top. The
           horizon and the sun are drawn lighter than the frame so the tile
           still reads as a stack rather than as a box full of lines. */
        <>
          <rect x="8" y="4" width="12.5" height="12.5" rx="2" />
          <path d="M16 20H5.5a2 2 0 0 1-2-2V8" />
          <circle cx="12" cy="8" r="1.05" strokeWidth={weight * 0.8} />
          <path d="M8.2 15.1l3.4-3.2 2.3 2.1 1.9-1.6 4.7 4.1" strokeWidth={weight * 0.8} />
        </>
      )}
      {glyph === 'bubble' && (
        /* One rounded box with a tail off the bottom-left. The tail is what
           makes it a bubble rather than a rounded rectangle, so it is
           generous — a fifth of the height — because anything smaller closes
           up into the box's own stroke. */
        <path d="M6 4h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6l-5 4.5 2-4.5H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" />
      )}
      {glyph === 'bubbles' && (
        /* Two of them, overlapping: a conversation. Only the two sides of the
           one behind that clear the front one — a whole second outline
           crossing the first reads as one lumpy shape rather than as two
           bubbles. */
        <>
          <path d="M9 2.5h10A2.5 2.5 0 0 1 21.5 5v5A2.5 2.5 0 0 1 19 12.5" />
          <path d="M4 8h10a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 18H8l-4 3.5 1-3.5H4a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 4 8z" />
        </>
      )}
      {glyph === 'tray' && (
        /*
         * An in-tray: a box with a lip, and a notch in the lip where
         * something drops through. The app's own drawing — and the reason it
         * beats the envelope that was here is that the row stopped being
         * about invitations. What lands on it now is a friend request, a
         * reply, a photograph somebody added to your album; an envelope says
         * one of those and a tray says "things arrived", which is what the
         * row is.
         */
        <>
          <path d="M3 13h5l1.5 2.5h5L16 13h5" />
          <path d="M3 13 6 5h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
      )}
      {glyph === 'groups' && (
        /*
         * Two people, drawn as the profile glyph with a second one behind it.
         * Deliberately built from that shape rather than invented: a group is
         * more of the same thing a profile is one of, and two unrelated
         * drawings of a person in one rail is what makes an icon set look
         * assembled.
         *
         * Not three overlapping circles. That is the logo, and a nav row
         * wearing the mark reads as "go to Parea" rather than as a section.
         *
         * The one behind is clipped by the front figure's own outline rather
         * than being a whole second head — at 18px two complete heads side by
         * side are two grey blobs, and the overlap is what says "together".
         */
        <>
          <circle cx="9.5" cy="8.5" r="3.5" />
          <path d="M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5" />
          <path d="M16 5.4a3.5 3.5 0 0 1 0 6.2" />
          <path d="M17.5 14.9c2.2.5 3.5 1.9 3.5 4.6" />
        </>
      )}
      {glyph === 'search' && (
        <>
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </>
      )}
      {glyph === 'plus' && (
        // Two lines. It was a `+` typed as a character, whose weight and
        // width came from whichever font answered for it — next to five
        // drawn glyphs at stroke 2 that is the one shape in the rail with
        // somebody else's hand in it.
        <>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </>
      )}
      {glyph === 'profile' && (
        // A head and shoulders, which is what the avatar beside it will be.
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
        </>
      )}
      {glyph === 'settings' && (
        // Sliders rather than a cog. A cog at 18px in a 2px stroke is a
        // circle with a texture; three rows with a handle on each reads at
        // any size, and says "things you can set" more literally anyway.
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
          <circle cx="9" cy="7" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="8" cy="17" r="2" />
        </>
      )}
    </svg>
  );
}
