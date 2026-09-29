'use client';

/**
 * Dark or light, for this browser. Dark unless somebody picks light — the
 * app's default too.
 *
 * Kept in a cookie rather than on the account, for the reason the app keeps
 * it on the phone: it is a fact about a screen, and somebody reading on a
 * laptop at night and a phone in the sun may want both. The cookie is what
 * the line of script in `layout.tsx` reads before the page paints, so the
 * choice holds from the first frame of every page after this one; this one
 * changes at once.
 */

import { useEffect, useState } from 'react';

import { THEME_COOKIE, type Look } from '@/theme';

export function Appearance() {
  // What the page is showing, read once it is in the browser — the server
  // cannot know which the head script chose.
  const [look, setLook] = useState<Look>('dark');
  useEffect(() => {
    setLook(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  function choose(next: Look) {
    setLook(next);
    document.documentElement.dataset.theme = next;
    // A year, site-wide, and readable by the script that applies it.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <section className="panel">
      <h2>Appearance</h2>
      <div className="appearance" role="radiogroup" aria-label="Appearance">
        {(['dark', 'light'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={look === option}
            onClick={() => choose(option)}
          >
            {option === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>
    </section>
  );
}
