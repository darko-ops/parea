'use client';

/**
 * A group's conversation, on the site.
 *
 * The same `Thread` an album draws, given a different room — see `ThreadRoom`.
 * What this file is, on top of that, is the fetching: an album's page is
 * already polling one endpoint for photographs and folds its messages into
 * that answer, and a group has no feed of its own, so the conversation has to
 * be asked for directly. Asking is also what marks it read, which is why there
 * is no second call for that.
 *
 * The app reached this conclusion first and `GroupChat` there is this file's
 * twin, down to the four-second tick and the reason for it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Member } from '@/members';
import type { Message } from '@/messages';

import { Thread } from './Thread';

export function GroupChat({ groupId }: { groupId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);

  /**
   * Which request is the newest, and what the thread last looked like.
   *
   * Both exist because this is polled. `asked` stops a slow answer overwriting
   * a fast one that came after it — otherwise a message can appear and then
   * vanish for four seconds, which is the sort of thing people report as "it
   * deleted my message". `shape` stops a tick that found nothing new from
   * replacing the array anyway, which would re-render every row for no change.
   */
  const asked = useRef(0);
  const shape = useRef<string | null>(null);

  const load = useCallback(async () => {
    const mine = ++asked.current;
    const res = await fetch(`/api/groups/${groupId}/messages`).catch(() => null);
    if (!res?.ok || mine !== asked.current) return;
    const { messages: list } = (await res.json()) as { messages: Message[] };
    /*
     * Ids, bodies and tombstones — everything a row draws that can change. An
     * edit and a delete both move this, which a length comparison would miss.
     */
    const next = list.map((m) => `${m.id}:${m.deleted ? 1 : 0}:${m.body}`).join('\n');
    if (next === shape.current) return;
    shape.current = next;
    setMessages(list);
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * And again, while somebody is looking at it.
   *
   * Four seconds, and only while the tab is in front: a poll that keeps
   * running behind another window is a request every four seconds for a
   * screen nobody is reading, and the answer would be stale by the time they
   * came back anyway — which is what the visibility handler is for.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(tick, 4000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  return (
    <div className="group-chat">
      <Thread
        room={{ kind: 'group', id: groupId }}
        /*
         * `Thread` takes a list rather than a null, and the empty state it
         * draws is an invitation — so the first request going out would say
         * "say something" and then be contradicted by the conversation
         * appearing under it. An empty array until the answer lands is the
         * closest this shape gets; the app's version takes the null and draws
         * a wait, which is the better of the two and a change to make there.
         */
        messages={messages ?? []}
        /*
         * Everybody who can read a group's thread may post in it: there is no
         * link-holder here, so the split an album makes between `view` and
         * `contribute` has nothing to separate. Reaching this page at all
         * means the server said you are a member.
         */
        canPost
        /*
         * No mention list. The album offers its own contributors, which is
         * safe because that list is on its People tab; a group's membership is
         * the same kind of fact and this component is not handed it. `@name`
         * still renders as written; it simply does not complete.
         */
        people={[]}
        members={[] as Member[]}
        onChanged={load}
        // Fetching the thread is what marks it read, and `load` is the fetch.
        onSeen={load}
      />
    </div>
  );
}
