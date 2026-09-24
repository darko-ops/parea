/**
 * A group's own conversation.
 *
 * The room that outlives an evening, and the first place in this product where
 * people talk about something other than one set of photographs. It is the
 * same `Thread` the album draws — same composer, same tombstones, same mention
 * rules — given a different set of verbs and a different header.
 *
 * ## Who can see it
 *
 * Members, and that is the whole rule. There is no link that opens a group and
 * no capability to weigh: somebody who can see the photographs in an event
 * that belongs to this group still cannot read this unless they are in the
 * group itself. The server enforces it and answers 404 rather than 403, so the
 * failure here is "this is gone", which is also what it should look like to
 * somebody who has just been removed.
 *
 * ## Why the thread is fetched here rather than folded into a feed
 *
 * The album gets its messages inside `/api/events/[id]/photos`, because that
 * screen is already polling one endpoint for photographs and folding the
 * thread in costs nothing. A group has no feed of its own — the Groups tab
 * reads a summary, not a conversation — so this asks for the thread directly,
 * and asking is what marks it read.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Api, Message } from './api';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Thread } from './Thread';

/** Where the page begins, under the header. See `PAGE_TOP` in `App.tsx`. */
const HEAD = 112;

/**
 * The conversation itself, without a screen around it.
 *
 * Lifted out of `GroupThread` when the group's own page grew a Chat tab: the
 * room is read in two places now — its own screen, reached from the list of
 * conversations, and a pane on the group page — and the fetching, the polling
 * and the four verbs must not exist twice. What is *not* in here is the
 * header, which is the only thing the two places disagree about.
 */
export function GroupChat({
  api,
  group,
  t,
  keyboardOffset,
}: {
  api: Api;
  /** Its id to fetch by. The name belongs to whatever draws the header. */
  group: { id: string };
  t: GroupTheme;
  /** How far down the screen this pane starts. See `Thread`'s own note. */
  keyboardOffset: number;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which request is the newest, and what the thread last looked like.
   *
   * Both exist because this is polled now. `asked` makes a slow answer unable
   * to overwrite a fast one that came after it — otherwise a message could
   * appear and then vanish for four seconds, which is the sort of thing people
   * report as "it deleted my message". `shape` is what stops a tick that found
   * nothing new from replacing the array anyway: every row of an inverted list
   * re-renders when it does, four times a minute, for no change.
   */
  const asked = useRef(0);
  const shape = useRef<string | null>(null);
  /** What `load` reads to decide whether a failure has anything to lose. */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const load = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const { messages: list } = await api.groupMessages(group.id);
      if (mine !== asked.current) return;
      /*
       * Ids, bodies and tombstones — everything a row draws that can change.
       * An edit and a delete both move this, which a length comparison would
       * miss.
       */
      const next = list.map((m) => `${m.id}:${m.deleted ? 1 : 0}:${m.body}`).join('\n');
      if (next !== shape.current) {
        shape.current = next;
        setMessages(list);
      }
      setError(null);
    } catch {
      if (mine !== asked.current) return;
      /*
       * Only where there was nothing to lose.
       *
       * A failed poll used to be the same as a failed first load, which on a
       * schedule means one unreachable moment replaces a conversation somebody
       * is reading with "this is not available". A 404 here is most often "you
       * are no longer in this group" — true and worth saying, but not worth
       * saying on the strength of one dropped request when the thread is
       * already on screen. The next tick will say it again if it is true.
       */
      if (messagesRef.current === null) {
        setError('This conversation is not available.');
        setMessages([]);
      }
    }
  }, [api, group.id]);


  useEffect(() => {
    void load();
  }, [load]);

  /*
   * And again, while somebody is looking at it.
   *
   * This screen asked once, on mount, and then only when the thread was
   * scrolled to the bottom or something was posted — so a message from anybody
   * else arrived whenever the reader happened to move, which from the other
   * side looks like the conversation being minutes behind. The album's thread
   * gets its refreshes from the feed the photographs are already polling; a
   * group has no feed, which is why nothing was doing this.
   *
   * Four seconds, and only while the app is in front. A poll that keeps
   * running in somebody's pocket is a request every four seconds for a screen
   * nobody is reading, and the answer would be stale by the time they looked
   * anyway — the mount above re-reads on the way back.
   *
   * `load` swallows its own failures and replaces rather than clears, so a
   * tick that cannot reach the server leaves what is on screen alone.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const actions = useMemo(
    () => ({
      post: (body: string) => api.postGroupMessage(group.id, body),
      edit: (id: string, body: string) => api.editGroupMessage(id, body),
      remove: (id: string) => api.deleteGroupMessage(id),
      /*
       * And reactions, which a group message now has.
       *
       * They were missing and the schema called it a scope line rather than a
       * decision: `message_reaction` hangs off `event_message`, so a group
       * message meant a second table. There is one — `group_message_reaction`
       * — and this is the tap that writes to it. `Thread` reads the presence
       * of this function as "the room has reactions", which is why holding a
       * message here offered Edit and Delete and no emoji until now.
       *
       * No `unreact`: that is for the reaction *lines* an album's board
       * carries, which are reactions on photographs. A group has none.
       */
      react: (id: string, emoji: string) => api.reactToGroupMessage(id, emoji),
    }),
    [api, group.id],
  );

  return error ? (
    <View style={styles.centre}>
      <Text style={[styles.error, { color: t.dim }]}>{error}</Text>
    </View>
  ) : (
    <Thread
      /*
        Null while the first request is out, which `Thread` draws as a wait
        rather than as an empty room. It used to be handled a level up — the
        whole body replaced by a spinner — and moving it down is what makes
        the album's board behave the same way, since that one had no
        equivalent and showed the invitation instead.
      */
      actions={actions}
      messages={messages}
      /*
       * Everybody who can read a group's thread may post in it: there is no
       * link-holder here, so the split the album makes between `view` and
       * `contribute` has nothing to separate. Reaching this room at all means
       * the server said you are a member.
       */
      canPost
      /*
       * No mention list yet.
       *
       * The album offers its own contributors, which is safe because that
       * list is already on its People tab. A group's membership is the same
       * kind of fact and the page beside this one now has it — but this
       * component is also the whole of the standalone screen, which is handed
       * an id and nothing else. Passing it down from one caller and not the
       * other would make `@` complete in one room and not in the other room
       * that is the same room. `@name` still renders as written.
       */
      people={[]}
      t={t}
      keyboardOffset={keyboardOffset}
      onChanged={load}
      // Fetching the thread is what marks it read, and `load` is the fetch —
      // so reaching the bottom re-reads and re-marks in one act.
      onSeen={() => void load()}
    />
  );
}

/**
 * The room as a screen of its own, which is the list of conversations' way in.
 *
 * A header and `GroupChat` under it. The group's own page draws the same
 * conversation as a pane between its other two, and what it does not need is
 * this bar: it has a name at the top already.
 */
export function GroupThread({
  api,
  group,
  t,
  dark,
  onBack,
  onOpenGroup,
}: {
  api: Api;
  /**
   * Enough to draw the bar, and no more.
   *
   * It took a whole `MyGroupDetail` — faces, a last message, an unread count,
   * a last-active timestamp — and read four fields off it. That was fine while
   * the Groups tab was the only way in, since that screen already held one;
   * the group's own page now opens this too, and it has a `GroupRoom` rather
   * than a summary. Asking for what is used lets both hand over what they have
   * without either inventing the rest.
   */
  group: { id: string; name: string; memberCount: number; eventCount: number };
  t: GroupTheme;
  dark: boolean;
  onBack: () => void;
  /** The room itself — its people and its evenings — which is not this screen. */
  onOpenGroup: () => void;
}) {
  const lens = lensFor(group.id);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      {/*
        The album's folded-up header, in the one place it still belongs.

        An album stopped having two headers — the cover stays put across its
        three tabs — but a group has no cover to keep: it is a room, not an
        evening, and the rule that a group's tile is a letter rather than a
        borrowed photograph holds here as everywhere else.
      */}
      <View style={[styles.head, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <View style={styles.headRow}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={[styles.back, { color: t.accent }]}>‹</Text>
          </Pressable>

          <Pressable
            onPress={onOpenGroup}
            accessibilityRole="button"
            accessibilityLabel={`Open ${group.name}`}
            style={styles.headWho}
          >
            <View style={[styles.tile, { backgroundColor: lens.fill }]}>
              <Text style={[styles.tileInitial, { color: lens.ink }]}>
                {initialOf(group.name)}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
                {group.name}
              </Text>
              <Text style={[styles.meta, { color: t.dim }]} numberOfLines={1}>
                {group.memberCount} {group.memberCount === 1 ? 'person' : 'people'}
                {group.eventCount > 0 &&
                  ` · ${group.eventCount} ${group.eventCount === 1 ? 'album' : 'albums'}`}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      <GroupChat api={api} group={group} t={t} keyboardOffset={HEAD} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* The same 72pt status-bar allowance every screen in this project starts at. */
  head: { borderBottomWidth: 1, paddingTop: 72, paddingHorizontal: 16, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headWho: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 28, lineHeight: 30 },
  tile: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tileInitial: { fontSize: 16, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 12.5 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  error: { fontSize: 15, textAlign: 'center' },
});
