'use client';

/**
 * The one reaction there is: a heart, outlined until you like the thing and
 * filled once you have, with how many people have beside it.
 *
 * It replaced a row of emoji pills and a picker on every surface that had one
 * — a photograph, a moment, a line in a roll's comments or a group's chat.
 * One control in one shape, so liking something is the same act everywhere,
 * and the button itself says whether you already have.
 *
 * State is the caller's. This only draws it and says when it was pressed.
 */

export function LikeButton({
  liked,
  count,
  onToggle,
  disabled = false,
  what = 'this',
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  disabled?: boolean;
  /** What is being liked, for the accessible name: "this photo", "this message". */
  what?: string;
}) {
  const people = count === 1 ? '1 like' : `${count} likes`;
  return (
    <button
      type="button"
      className={`like${liked ? ' like-on' : ''}`}
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'} ${what}${count > 0 ? `, ${people}` : ''}`}
      title={liked ? 'Unlike' : 'Like'}
      disabled={disabled}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M12 20.5s-7.2-4.3-9.4-8.6C.9 8.5 3 4.5 6.8 4.5c2.2 0 3.8 1.2 5.2 3.1 1.4-1.9 3-3.1 5.2-3.1 3.8 0 5.9 4 4.2 7.4-2.2 4.3-9.4 8.6-9.4 8.6z"
          fill={liked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      {count > 0 && <span className="like-count">{count}</span>}
    </button>
  );
}
