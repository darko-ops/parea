'use client';

/**
 * What people have left on one photograph, and the way to leave one.
 *
 * The site had neither. `photo_reaction`, its route and the app's control have
 * existed for a while and this page never grew one — so a reaction left on a
 * phone was invisible in a browser, which is worse than not having the feature
 * at all: it makes the two clients disagree about what happened in an album.
 *
 * ## A row of people, not a score
 *
 * Each row the server sends is one person and one emoji, so a pill can say who
 * as well as how many — `title` and the accessible name both carry the names.
 * That is the whole of what separates a reaction from a like, and the reason
 * the tally is built here rather than counted in SQL.
 *
 * ## The picker is the thread's
 *
 * `.reaction`, `.reaction-add` and `useDismiss` are the message thread's, down
 * to the six it opens with. A second treatment for "add an emoji to this" is
 * how a product comes to have two — and the app's answer here, one face and
 * the phone's own keyboard behind it, has no equivalent in a browser: there is
 * no system picker to ask for.
 */

import { useCallback, useMemo, useState } from 'react';

import type { PhotoReaction } from '@/photoReactions';
import { REACTIONS } from '@/reactions';

import { useDismiss } from './Thread';

export function PhotoReactions({
  photoId,
  reactions,
  canReact,
}: {
  photoId: string;
  reactions: PhotoReaction[];
  /** `contribute` and an account, which is the rule the route enforces. */
  canReact: boolean;
}) {
  /*
   * Drawn from state rather than from the prop, because a tap has to land
   * before the server answers.
   *
   * The page is server-rendered and this list arrives with it; a reaction that
   * only appeared after a round trip would feel like a tap that missed, and
   * the app has been optimistic here since it shipped. A failure puts the
   * list back — silently, because an alert over somebody's photograph for a
   * tap that did not land is worse than the tap not landing.
   */
  const [list, setList] = useState(reactions);
  const [picking, setPicking] = useState(false);
  const picker = useDismiss(picking, useCallback(() => setPicking(false), []));

  /** emoji → how many, whether one is yours, and who. In first-seen order. */
  const tally = useMemo(() => {
    const by = new Map<string, { count: number; mine: boolean; names: string[] }>();
    for (const one of list) {
      const row = by.get(one.emoji) ?? { count: 0, mine: false, names: [] };
      row.count += 1;
      row.mine = row.mine || one.mine;
      row.names.push(one.mine ? 'you' : one.name);
      by.set(one.emoji, row);
    }
    return [...by.entries()];
  }, [list]);

  const toggle = useCallback(
    async (emoji: string) => {
      if (!canReact) return;
      const was = list;
      const mine = list.some((one) => one.emoji === emoji && one.mine);
      setList(
        mine
          ? list.filter((one) => !(one.emoji === emoji && one.mine))
          : [{ emoji, name: 'you', mine: true }, ...list],
      );
      setPicking(false);
      const res = await fetch(`/api/photos/${photoId}/reactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emoji }),
      }).catch(() => null);
      // Includes `too_many`, which is the ceiling on how many one person may
      // leave — the row going back is the whole of what it is told.
      if (!res?.ok) setList(was);
    },
    [canReact, list, photoId],
  );

  // Nothing at all rather than an empty affordance: a signed-out reader is
  // being shown somebody's photograph, not a control that will refuse them.
  if (!canReact && tally.length === 0) return null;

  return (
    <div className="reactions photo-reactions" ref={picker}>
      {tally.map(([emoji, row]) => (
        <button
          key={emoji}
          type="button"
          className={`reaction${row.mine ? ' reaction-on' : ''}`}
          disabled={!canReact}
          aria-pressed={row.mine}
          /* Who, which is what a count cannot say. Both the tooltip and the
             accessible name, because a name only a mouse can read is a name
             half the people here cannot. */
          title={row.names.join(', ')}
          aria-label={`${emoji} from ${row.names.join(', ')}`}
          onClick={() => void toggle(emoji)}
        >
          {emoji} {row.count}
        </button>
      ))}

      {canReact &&
        (picking ? (
          REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reaction"
              aria-label={`React ${emoji}`}
              onClick={() => void toggle(emoji)}
            >
              {emoji}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="reaction-add"
            aria-expanded={false}
            aria-label="React to this photo"
            onClick={() => setPicking(true)}
          >
            {'＋'}
          </button>
        ))}
    </div>
  );
}
