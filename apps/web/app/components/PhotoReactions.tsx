'use client';

/**
 * The like on a photograph or a moment: one heart, and how many.
 *
 * This was a row of emoji pills and a picker. Reactions became likes, so the
 * row became one `LikeButton` — outlined until you like it, filled once you
 * have. The server stores a like whatever is posted, and every older reaction
 * was folded into one, so the list it hands over is a row per person who
 * likes this. Counted defensively all the same: any row of yours is your like.
 *
 * ## Optimistic, and quietly put back
 *
 * The page is server-rendered and this list arrives with it; a heart that only
 * filled after a round trip would feel like a tap that missed. A failure puts
 * the list back — silently, because an alert over somebody's photograph for a
 * tap that did not land is worse than the tap not landing.
 */

import { useCallback, useState } from 'react';

import type { PhotoReaction } from '@/photoReactions';

import { LikeButton } from './LikeButton';

export function PhotoReactions({
  photoId,
  reactions,
  canReact,
  endpoint = `/api/photos/${photoId}/reactions`,
  what = 'this photo',
}: {
  photoId: string;
  reactions: PhotoReaction[];
  /** `contribute` and an account, which is the rule the route enforces. */
  canReact: boolean;
  /** Where a tap goes. A moment's like is the same control, elsewhere. */
  endpoint?: string;
  /** What is being liked, for the button's accessible name. */
  what?: string;
}) {
  const [list, setList] = useState(reactions);
  const liked = list.some((one) => one.mine);
  // One per person: yours counts once however many rows an old reaction left.
  const count = list.filter((one) => !one.mine).length + (liked ? 1 : 0);

  const toggle = useCallback(async () => {
    if (!canReact) return;
    const was = list;
    setList(
      liked
        ? list.filter((one) => !one.mine)
        : [{ emoji: '❤️', name: 'you', mine: true }, ...list],
    );
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '❤️' }),
    }).catch(() => null);
    if (!res?.ok) setList(was);
  }, [canReact, endpoint, liked, list]);

  // Nothing at all rather than an empty affordance: a signed-out reader is
  // being shown somebody's photograph, not a control that will refuse them.
  if (!canReact && count === 0) return null;

  return (
    <div className="photo-like">
      <LikeButton
        liked={liked}
        count={count}
        disabled={!canReact}
        what={what}
        onToggle={() => void toggle()}
      />
    </div>
  );
}
