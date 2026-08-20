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
 * All drawn on the same 24-unit grid with the same 2-unit stroke and round
 * caps as `SearchIcon`, because the alternative — an icon set — arrives with
 * its own weight, its own corner radius and its own idea of optical size, and
 * then the one hand-drawn glyph in the product looks like the mistake.
 *
 * Deliberately plain outlines. A filled icon reads as a selected state, and
 * the rail already says which row you are on with a background and a colour.
 */

export type RailGlyph = 'home' | 'invites' | 'groups' | 'search' | 'profile' | 'settings';

export function RailIcon({ glyph }: { glyph: RailGlyph }) {
  return (
    <svg
      className="rail-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph === 'home' && (
        // A roof and a wall. Not a house with a door and a chimney: at 18px
        // the door is three pixels and reads as dirt on the screen.
        <>
          <path d="M3.5 10.5 12 4l8.5 6.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </>
      )}
      {glyph === 'invites' && (
        // An envelope, because what arrives here is somebody asking you to
        // something — the same shape the world already uses for that.
        <>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.8 7 8.2 6 8.2-6" />
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
