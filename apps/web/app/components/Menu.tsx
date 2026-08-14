'use client';

/**
 * A `···` and the small panel it opens.
 *
 * Two of these now — the options on your own message, and the event's settings
 * in the head — which is one more than is worth having two copies of. The
 * panel is the popover the download menu already uses, so all three share a
 * shadow, a radius and an edge; a second popover with its own look is how an
 * interface starts to feel assembled rather than designed.
 *
 * Dismissal is the part that is easy to get wrong, so it is here rather than
 * at each call site. Both of the obvious shortcuts fail: a `<details>` gets the
 * toggle for free but ignores clicks elsewhere on the page, and closing on blur
 * fires when focus moves *inside* the panel — which shuts the menu on the way
 * to the button somebody was reaching for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function Menu({
  label,
  align = 'right',
  children,
}: {
  /** What a screen reader announces. The glyph itself says nothing. */
  label: string;
  /** Which edge the panel hangs from. `left` for a control near the page edge. */
  align?: 'left' | 'right';
  /** Rendered inside the panel, and given `close` so an item can dismiss it. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    /*
     * `mousedown`, not `click`. A press that starts inside the panel and ends
     * outside it is not a click away — and listening for the later event
     * closes the panel between a button being pressed and its handler running,
     * so the item never fires.
     */
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);

  return (
    <div className="dots" ref={ref}>
      <button
        className="dots-go"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {'···'}
      </button>
      {open && (
        <div className={`menu-body dots-body${align === 'left' ? ' dots-left' : ''}`} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}
