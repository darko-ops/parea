'use client';

/**
 * Signing in, as a page rather than a panel.
 *
 * Everywhere else the sign-in appears it is an interruption — you were adding
 * photos, or making an event, and it stands in front of that. Here it is the
 * whole errand, so there is no rail, no navigation and nothing else to do.
 * What is on screen is the mark, the name, and the one field.
 *
 * The card is the only shape on the page. It carries a border rather than a
 * shadow: the page is white and the card is white, and a shadow to separate
 * them would be inventing depth the rest of the product does not have.
 */

import type { ReactNode } from 'react';

import { Mark } from './Mark';

export function LoginScreen({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      {/*
        The one way out of this page that is not signing in. Groups are the
        only thing this product makes findable — see FindView, and §3 — so
        this is a door to that and not a search of anything else.
      */}
      <a className="auth-search" href="/find" aria-label="Find a group">
        <SearchIcon />
      </a>

      <div className="auth-card">
        <div className="auth-brand">
          <Mark size={72} />
          <span className="wordmark auth-wordmark">Parea</span>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Drawn rather than imported. It is nine lines of SVG against a dependency,
 * an icon set and a build step, and this is the only icon in the web client.
 */
function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
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
