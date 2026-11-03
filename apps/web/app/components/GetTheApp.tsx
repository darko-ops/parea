'use client';

/**
 * "Get the app", for somebody who opens the site on an iPhone.
 *
 * Safari has its own: the Smart App Banner the layout's `itunes` metadata asks
 * for, which knows whether the app is installed and says Open instead of Get
 * when it is. Nothing here can know that, so in Safari this stays out of the
 * way. Every other browser on iOS — Chrome, Firefox, and the in-app browsers a
 * shared link usually opens in — ignores that tag, and gets this instead.
 *
 * Nothing on Android, where there is no app to send anybody to yet.
 *
 * Dismissed for a month, per browser. Not a thing worth remembering on an
 * account: it is about this phone, and a private window that forgets it shows
 * it once more, which is all.
 */

import { useEffect, useState } from 'react';

import { useImageFailure } from './useImageFailure';

export const APP_STORE_URL = 'https://apps.apple.com/us/app/parea-photos-with-friends/id6819904142';

const ICON = '/apple-icon.png';
const DISMISSED = 'parea.getTheApp.dismissedAt';
const QUIET_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** An iPhone or iPad, including an iPad that says it is a Mac. */
export function isIos(ua: string, platform: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

/**
 * Safari itself, which draws the Smart App Banner. Other iOS browsers carry a
 * `Safari/` token too and name themselves beside it; in-app browsers mostly
 * carry none.
 */
export function isSafari(ua: string): boolean {
  return /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|YaBrowser/.test(ua);
}

export function GetTheApp() {
  const [shown, setShown] = useState(false);
  const icon = useImageFailure(ICON);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (!isIos(ua, navigator.platform, navigator.maxTouchPoints) || isSafari(ua)) return;
    try {
      const at = Number(localStorage.getItem(DISMISSED));
      if (at && Date.now() - at < QUIET_FOR_MS) return;
    } catch {
      // Storage refused: show it, and it will simply come back next time.
    }
    setShown(true);
  }, []);

  if (!shown) return null;

  const dismiss = () => {
    setShown(false);
    try {
      localStorage.setItem(DISMISSED, String(Date.now()));
    } catch {}
  };

  return (
    <div className="get-app" role="dialog" aria-label="Get the Parea app">
      {/* The card reads without the icon, so one that fails is simply left out. */}
      {!icon.failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={icon.ref}
          onError={icon.onError}
          className="get-app-icon"
          src={ICON}
          alt=""
          width={48}
          height={48}
        />
      )}
      <div className="get-app-text">
        <strong>Parea is better in the app</strong>
        <span>Add photos, see everyone’s, and get told when they land.</span>
      </div>
      <a className="get-app-get" href={APP_STORE_URL} onClick={dismiss}>
        Get
      </a>
      <button type="button" className="get-app-close" aria-label="Not now" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
