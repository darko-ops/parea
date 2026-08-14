/**
 * A magnifying glass.
 *
 * Drawn rather than imported. It is nine lines of SVG against a dependency, an
 * icon set and a build step, and it is still the only icon in the web client —
 * everything else that looks like one is a text character.
 *
 * Its own file because there are two search fields now. It was declared inside
 * `LoginScreen`, which made "copy the nine lines" the cheapest way to add the
 * second one, and nine lines copied is nine lines that stop matching.
 */
export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}
