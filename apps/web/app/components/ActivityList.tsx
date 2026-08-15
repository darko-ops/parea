'use client';

/**
 * The feed, with a way to be finished with a line.
 *
 * A client component only because of the menu. The list itself is rendered on
 * the server and handed down whole — what is here is the `···` on each row and
 * the optimism when one is pressed.
 *
 * Optimistic in one direction, the same rule as everywhere else in this
 * product: the row goes the moment the request is sent, because hiding is not
 * a thing that can half-happen. If the request fails the row comes back and
 * says so, rather than leaving somebody looking at a list that did not change.
 *
 * The whole row is a link and the menu is a button inside it, which is a
 * nesting a browser will not accept — so the link and the menu are siblings,
 * and the link is what stretches. Hence `.activity-row`.
 */

import { useCallback, useState } from 'react';

import { Face } from './Faces';
import { Menu } from './Menu';

export type ActivityRow = {
  id: string;
  who: string;
  what: string;
  when: string;
  href: string | null;
  /** A person's picture, or the album's newest photograph. Null draws a letter. */
  image: string | null;
};

export function ActivityList({ items }: { items: ActivityRow[] }) {
  const [rows, setRows] = useState(items);
  const [error, setError] = useState<string | null>(null);

  const hide = useCallback(
    async (row: ActivityRow) => {
      const before = rows;
      setRows((list) => list.filter((r) => r.id !== row.id));
      setError(null);
      try {
        const res = await fetch('/api/activity/hidden', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: row.id }),
        });
        if (!res.ok) throw new Error('Could not hide that.');
      } catch (err) {
        setRows(before);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [rows],
  );

  if (rows.length === 0) {
    return (
      <p className="panel-note">
        Nothing here. Reactions to what you write, people mentioning you in an
        album, and albums you are let into all turn up here.
      </p>
    );
  }

  return (
    <>
      {error && <p className="panel-note">{error}</p>}
      <ul className="activity">
        {rows.map((row) => {
          const line = (
            <>
              {/*
                The square, and what stands in when there is nothing to put in
                it: the first letter of whatever the row is about. Never a
                silhouette or a placeholder glyph — a letter at least belongs
                to the thing the sentence names.

                `Face` rather than a bare `<img>` because these expire: an
                avatar URL is presigned for an hour and a photograph is signed
                against its album's epoch, so a tab left open long enough holds
                a row whose picture is gone. The letter is what that becomes,
                rather than the broken-image glyph.
              */}
              <Face
                src={row.image}
                size={34}
                className="activity-thumb"
                fallback={<span aria-hidden="true">{row.who.slice(0, 1).toUpperCase()}</span>}
              />
              <span className="activity-said">
                <span className="activity-who">{row.who}</span> {row.what}
              </span>
              <span className="activity-when">{row.when}</span>
            </>
          );
          return (
            <li key={row.id} className="activity-row">
              {row.href ? <a href={row.href}>{line}</a> : <span>{line}</span>}
              {/*
                Hanging leftwards from its button, which is the default: the
                control sits at the right-hand end of a full-width row, and a
                panel anchored to its left edge opens past the page.
              */}
              <Menu label={`Options for: ${row.who} ${row.what}`}>
                {(close) => (
                  <button
                    onClick={() => {
                      close();
                      void hide(row);
                    }}
                  >
                    Hide this
                  </button>
                )}
              </Menu>
            </li>
          );
        })}
      </ul>
    </>
  );
}
