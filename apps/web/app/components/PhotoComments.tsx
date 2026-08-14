'use client';

/**
 * What people said about this one photograph.
 *
 * The same records as the event thread. A photo comment is a message with a
 * `photoId` on it, so what is drawn here is the thread filtered to this photo,
 * and anything posted here appears in the thread as well. Two tables would
 * have meant two access rules, two moderation paths and two places to look
 * when somebody reports something — and the question "why is my comment not in
 * the thread?" would have had a real answer, which is worse.
 *
 * Deliberately smaller than the column. This sits inside a 720px dialog whose
 * subject is a photograph and whose bottom half is the reporting actions; a
 * full thread in the middle of that pushes "Report" off the screen. So it is a
 * short list and one line to type in, and the thread is where a conversation
 * goes.
 */

import { ago } from '@parea/cards';
import { useCallback, useState } from 'react';

import type { Message } from '@/messages';

export function PhotoComments({
  eventId,
  photoId,
  messages,
  canPost,
  onChanged,
}: {
  eventId: string;
  photoId: string;
  messages: Message[];
  canPost: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const here = messages.filter((m) => m.photoId === photoId && !m.deleted);

  const post = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, photoId }),
      });
      // The draft stays put on failure. Losing what somebody typed because a
      // request failed is the failure mode worth engineering against.
      if (res.ok) {
        setDraft('');
        onChanged();
      }
    } finally {
      setPosting(false);
    }
  }, [draft, posting, eventId, photoId, onChanged]);

  // Nothing to show and nothing to say with: an empty bordered block between a
  // photograph and its actions is furniture.
  if (here.length === 0 && !canPost) return null;

  return (
    <div className="photo-thread">
      {here.map((message) => (
        <div className="message" key={message.id}>
          <span className="message-face" aria-hidden="true">
            {message.author.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
          </span>
          <div className="message-body">
            <div className="message-meta">
              <strong>{message.author.mine ? 'You' : message.author.name}</strong>{' '}
              <span>
                {ago(new Date(message.createdAt), new Date())}
                {message.edited && ' · edited'}
              </span>
            </div>
            <p className="message-text">{message.body}</p>
          </div>
        </div>
      ))}

      {canPost && (
        <div className="thread-actions">
          <input
            type="text"
            value={draft}
            placeholder="Comment on this photo…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void post();
              }
            }}
          />
          <button onClick={post} disabled={posting || draft.trim() === ''}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}

      {canPost && (
        <p className="photo-thread-note">
          Photo comments also appear in the event thread.
        </p>
      )}
    </div>
  );
}
