'use client';

/**
 * A profile picture, or the letter that stands in for one.
 *
 * The letter is not a placeholder for a failure — it is what someone with no
 * picture sees anyway, which makes it the right thing to fall back *to*. A
 * picture that will not load and a picture that was never set look the same
 * from here, and there is no version of "your photograph is missing" worth
 * putting on someone's own profile.
 *
 * Failing is ordinary rather than exceptional. The URL is presigned and
 * expires, so a page left open long enough will always get there in the end.
 */

import { useImageFailure } from './useImageFailure';

export function Avatar({
  url,
  initial,
  className = 'you-face',
}: {
  url: string | null;
  /** One character, already upper-cased by the caller. */
  initial: string;
  className?: string;
}) {
  // Called before the branch: hooks cannot be conditional, and an empty string
  // is a src that has simply not failed yet.
  const { ref, failed, onError } = useImageFailure(url ?? '');

  if (!url || failed) {
    return (
      <div className={className} aria-hidden="true">
        {initial}
      </div>
    );
  }

  return (
    // Not next/image: the URL is presigned and expires, and the optimiser
    // would cache a copy under a key that outlives the signature.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} onError={onError} className={className} src={url} alt="" />
  );
}
