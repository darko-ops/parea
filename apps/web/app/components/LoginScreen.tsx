'use client';

/**
 * Signing in, as a page rather than a panel.
 *
 * Everywhere else the sign-in appears it is an interruption — you were adding
 * photos, or making an event, and it stands in front of that. Here it is the
 * whole errand, so there is no rail, no navigation and nothing else to do.
 * What is on screen is the mark, the name, and the one field.
 *
 * The card is the only shape on the page, and it is lifted off it — a white
 * card on a white page with a hairline border alone reads as a drawn
 * rectangle rather than as an object. The shadow is what makes it one.
 */

import type { ReactNode } from 'react';

import { Mark } from './Mark';
import { SearchIcon } from './SearchIcon';
import { SiteFooter } from './SiteFooter';

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

      <SiteFooter />
    </main>
  );
}
