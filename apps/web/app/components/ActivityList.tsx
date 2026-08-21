'use client';

/**
 * The feed, grouped by day, with a way to be finished with a line.
 *
 * A client component only because of the menu and the grouping. The rows are
 * rendered on the server and handed down whole, already worded, already dated
 * and already bucketed — what is here is the `···` on each row, the optimism
 * when one is pressed, and the arithmetic that turns a flat list into days.
 *
 * ## Why days
 *
 * It was one flat column of grey one-liners, so today and three weeks ago
 * looked identical and the only way to tell was to read the times down the
 * right. A feed nobody can date at a glance is one people stop scanning,
 * because "is any of this new?" cannot be answered without reading it.
 *
 * ## Why the grouping is done here rather than on the server
 *
 * The *labels* are the server's — they are a fact about a clock and belong on
 * the same side as the relative times, for the reason those are worded there.
 * But the *runs* have to be recomputed as the list changes: hiding the only
 * line of a day has to take that day's heading with it, and a heading handed
 * down as a row would sit there over nothing.
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
  /** A person's picture, or the event's newest photograph. Null draws a letter. */
  image: string | null;
  /**
   * The photographs the line is about. Only `photos_added` has any.
   *
   * Decorative, and marked so: the row is one link to the event, not four, and
   * three thumbnails announcing themselves before the sentence is three things
   * read out before the thing that says what happened.
   */
  images: string[];
  /** "Today", "Earlier this week", "March" — worded by the server. */
  bucket: string;
  /** Arrived since the last look. The only mark; there is no per-item state. */
  unread: boolean;
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
      <p className="activity-empty">
        Nothing yet. When somebody adds photos to an event you are in, says
        something about yours, or opens one to you, it turns up here.
      </p>
    );
  }

  return (
    <>
      {error && <p className="activity-error">{error}</p>}

      {groupByDay(rows).map((group) => (
        // Keyed on the first row rather than on the label: two runs can carry
        // the same word if the server ever hands rows over out of order, and
        // duplicate keys are a rendering bug on top of a sorting one.
        <section className="activity-day" key={group.rows[0]!.id}>
          <div className="day-head">
            <h2>{group.bucket}</h2>
            <span className="day-rule" aria-hidden="true" />
          </div>

          <ul className="activity">
            {group.rows.map((row) => {
              const line = (
                <>
                  {/*
                    The square, and what stands in when there is nothing to put
                    in it: the first letter of whatever the row is about. Never
                    a silhouette or a placeholder glyph — a letter at least
                    belongs to the thing the sentence names.

                    `Face` rather than a bare `<img>` because these expire: an
                    avatar URL is presigned for an hour and a photograph is
                    signed against its event's epoch, so a tab left open long
                    enough holds a row whose picture is gone. The letter is what
                    that becomes, rather than the broken-image glyph.
                  */}
                  <Face
                    src={row.image}
                    size={34}
                    className="activity-thumb"
                    fallback={
                      <span aria-hidden="true">{row.who.slice(0, 1).toUpperCase()}</span>
                    }
                  />
                  <span className="activity-said">
                    <span className="activity-who">{row.who}</span> {row.what}
                  </span>

                  {/*
                    What the sentence is counting, on the one kind that counts
                    photographs. Before the time rather than after it, so the
                    times still form a column down the right.
                  */}
                  {row.images.length > 0 && (
                    <span className="activity-strip" aria-hidden="true">
                      {row.images.map((src) => (
                        <Strip key={src} src={src} />
                      ))}
                    </span>
                  )}

                  <span className="activity-when">{row.when}</span>
                </>
              );
              return (
                <li
                  key={row.id}
                  className={`activity-row${row.unread ? ' activity-new' : ''}`}
                >
                  {row.href ? (
                    <a href={row.href} aria-label={`${row.who} ${row.what}`}>
                      {line}
                    </a>
                  ) : (
                    <span>{line}</span>
                  )}
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
        </section>
      ))}
    </>
  );
}

/**
 * One of the three thumbnails on a `photos_added` row.
 *
 * Its own component for the `Face` reason: these are signed against the
 * event's epoch and a tab left open outlives the signature, so a failure has
 * to be a flat square rather than the browser's broken-image glyph. Nothing
 * stands in for it — unlike the row's own picture there is no letter that
 * would mean anything, and two of three photographs is still a strip.
 */
function Strip({ src }: { src: string }) {
  return (
    <Face src={src} size={38} className="activity-strip-one" fallback={<span />} />
  );
}

/**
 * Contiguous runs of one bucket, in the order the rows already have.
 *
 * Contiguous rather than collected: the list is sorted newest-first by the
 * server, so a bucket's rows are already together, and grouping by key into a
 * map would quietly reorder them if that ever stopped being true. This way a
 * mis-sorted list draws two headings with the same word — visibly wrong, which
 * is the failure worth having.
 */
function groupByDay(rows: ActivityRow[]): { bucket: string; rows: ActivityRow[] }[] {
  const out: { bucket: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.bucket === row.bucket) last.rows.push(row);
    else out.push({ bucket: row.bucket, rows: [row] });
  }
  return out;
}
