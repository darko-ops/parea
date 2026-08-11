'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Whether an `<img>` failed to load — including before React was listening.
 *
 * Image URLs are signed against the event's `cap_epoch`, so they stop
 * resolving for ordinary reasons rather than only for bugs: someone rotates a
 * link, a page comes back out of the back-forward cache, a signature ages out.
 * Because every URL on a screen shares the epoch, they tend to fail all at
 * once, and the browser's answer — a grey glyph in every slot — is a much
 * worse description of what happened than what the callers here draw instead.
 *
 * ## Why `onError` is only half of it
 *
 * These images are server-rendered. The browser starts fetching them while the
 * HTML is still streaming and can finish failing them before React hydrates,
 * and hydration does not replay events that already fired — so the handler
 * never runs and the glyph stays. Confirmed the hard way, with a production
 * build and a real browser: with the mount check below, every failing image
 * disappeared; without it, every one stayed broken.
 *
 * The mount check asks the element what happened rather than waiting to be
 * told. An image that has finished loading but has no intrinsic width did not
 * decode.
 *
 * ## Why the failure is remembered against a URL
 *
 * The feed re-polls while an upload runs, and each poll signs fresh URLs. If
 * failure were a plain boolean it would latch: the one screen most likely to
 * recover — the one being actively added to — would stay blank after the URLs
 * it is given start working again. Keyed on the source instead, a new URL is
 * simply a URL that has not failed yet.
 */
export function useImageFailure(src: string): {
  ref: React.RefObject<HTMLImageElement | null>;
  failed: boolean;
  onError: () => void;
} {
  const ref = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  return { ref, failed: failedSrc === src, onError: () => setFailedSrc(src) };
}
