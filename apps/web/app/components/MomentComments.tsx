'use client';

/**
 * What has been said under a moment, and a box to add to it.
 *
 * A moment's own conversation — it has no roll, so there is no roll thread
 * to put it in. Oldest first, as a conversation reads. Your own lines can be
 * taken back; anybody else's can be reported, in the same slot and as quietly,
 * and the person who wrote it blocked — which asks first, in a line under the
 * comment, because it reaches far past this one moment.
 *
 * The box marks itself `data-holding` while it is in use, so the moment's
 * clock waits for somebody writing rather than moving the picture on under
 * their sentence.
 */

import { Fragment, useState } from 'react';

import type { MomentComment } from '@/moments';

import { Face } from './Faces';
import { blockAsk, blockName, blockPerson, blockSaid, reportContent, reportSaid } from './report';

export function MomentComments({
  momentId,
  comments,
}: {
  momentId: string;
  comments: MomentComment[];
}) {
  const [list, setList] = useState(comments);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  /** The comment whose author is being asked about blocking, if any. */
  const [asking, setAsking] = useState<string | null>(null);

  async function post() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/moments/${momentId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      // The draft stays, which is the whole recovery.
      setError('Could not post that. Try again.');
      return;
    }
    const { id } = (await res.json()) as { id: string };
    setList((was) => [
      ...was,
      {
        id,
        body,
        createdAt: new Date().toISOString(),
        edited: false,
        deleted: false,
        author: { key: 'you', name: 'You', mine: true, avatarUrl: null },
        photoId: null,
        reactions: [],
      },
    ]);
    setDraft('');
  }

  async function remove(id: string) {
    const was = list;
    setList(list.filter((c) => c.id !== id));
    const res = await fetch(`/api/moments/${momentId}/comments/${id}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!res?.ok) setList(was);
  }

  /*
   * Blocking whoever wrote a comment. The list here is this component's own
   * copy, so once the server has the block, everything that person said
   * under this moment leaves it by their key — which is what a fresh load
   * would draw, and what every other page will from now on.
   */
  async function block(comment: MomentComment) {
    setBusy(true);
    setSaid(null);
    const result = await blockPerson({ momentCommentId: comment.id });
    setBusy(false);
    setAsking(null);
    setSaid(blockSaid(result));
    if (result.ok) setList((was) => was.filter((c) => c.author.key !== comment.author.key));
  }

  return (
    <section className="moment-comments" aria-label="Comments">
      {list.length > 0 && (
        <ul className="moment-comment-list">
          {list.map((c) => (
            <Fragment key={c.id}>
              <li className="moment-comment">
                <Face
                  src={c.author.avatarUrl}
                  size={28}
                  className="moment-comment-face"
                  fallback={
                    <span aria-hidden="true">{c.author.name.slice(0, 1).toUpperCase()}</span>
                  }
                />
                <span className="moment-comment-text">
                  <b>{c.author.mine ? 'You' : c.author.name}</b> {c.body}
                </span>
                {c.author.mine && (
                  <button
                    type="button"
                    className="link-button moment-comment-remove"
                    onClick={() => void remove(c.id)}
                    aria-label="Delete your comment"
                  >
                    Delete
                  </button>
                )}
                {!c.author.mine && (
                  <button
                    type="button"
                    className="link-button moment-comment-remove"
                    onClick={async () =>
                      setSaid(reportSaid(await reportContent('moment_comment', c.id)))
                    }
                    aria-label={`Report ${c.author.name}'s comment`}
                  >
                    Report
                  </button>
                )}
                {!c.author.mine && (
                  <button
                    type="button"
                    className="link-button moment-comment-remove"
                    onClick={() => setAsking(asking === c.id ? null : c.id)}
                    aria-expanded={asking === c.id}
                    aria-label={`Block ${c.author.name}`}
                  >
                    Block
                  </button>
                )}
              </li>
              {asking === c.id && (
                <li className="moment-comment-ask">
                  <p>{blockAsk(blockName(c.author.name))}</p>
                  <button
                    type="button"
                    className="link-button moment-comment-block"
                    disabled={busy}
                    onClick={() => void block(c)}
                  >
                    Block {blockName(c.author.name)}
                  </button>
                  <button
                    type="button"
                    className="link-button moment-comment-remove"
                    onClick={() => setAsking(null)}
                  >
                    Cancel
                  </button>
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}

      <form
        className="moment-composer"
        data-holding={focused || draft.trim() !== '' || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <input
          className="moment-composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={list.length > 0 ? 'Add a comment…' : 'Say something about this one…'}
          aria-label="Add a comment"
          maxLength={1000}
        />
        <button type="submit" className="moment-composer-post" disabled={!draft.trim() || busy}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </form>
      {(error ?? said) && <p className="photo-said">{error ?? said}</p>}
    </section>
  );
}
