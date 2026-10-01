/**
 * Two chain links, beside the address on a profile.
 *
 * Grey rather than the link's blue: it labels the line as an address, and the
 * address itself is the thing to press. The app draws the same icon in
 * `LinkIcon.tsx` there.
 */
export function LinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="link-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
