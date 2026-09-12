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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import type { Api, Message, MyGroupDetail } from './api';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Thread } from './Thread';
import { Waiting } from './Waiting';

/** Where the page begins, under the header. See `PAGE_TOP` in `App.tsx`. */
const HEAD = 112;

export function GroupThread({
  api,
  group,
  t,
  dark,
  onBack,
  onOpenGroup,
}: {
  api: Api;
  group: MyGroupDetail;
  t: GroupTheme;
  dark: boolean;
  onBack: () => void;
  /** The room itself — its people and its evenings — which is not this screen. */
  onOpenGroup: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { messages: list } = await api.groupMessages(group.id);
      setMessages(list);
      setError(null);
    } catch {
      // A 404 here is most often "you are no longer in this group", which is
      // the same sentence as "there is nothing to show".
      setError('This conversation is not available.');
      setMessages([]);
    }
  }, [api, group.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo(
    () => ({
      post: (body: string) => api.postGroupMessage(group.id, body),
      edit: (id: string, body: string) => api.editGroupMessage(id, body),
      remove: (id: string) => api.deleteGroupMessage(id),
      // No `react`: a group message has none yet, and the picker is not drawn
      // where there is nothing behind it. See `groupMessages` in the schema.
    }),
    [api, group.id],
  );

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

      {messages === null ? (
        <View style={styles.centre}>
          <Waiting size={40} />
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <Text style={[styles.error, { color: t.dim }]}>{error}</Text>
        </View>
      ) : (
        <Thread
          actions={actions}
          messages={messages}
          /*
           * Everybody who can read a group's thread may post in it: there is
           * no link-holder here, so the split the album makes between `view`
           * and `contribute` has nothing to separate. Reaching this screen at
           * all means the server said you are a member.
           */
          canPost
          /*
           * No mention list yet.
           *
           * The album offers its own contributors, which is safe because that
           * list is already on the People tab. A group's membership is the
           * same kind of fact, but the summary this screen is handed carries
           * three faces and a count rather than names — so offering a picker
           * here would mean a second request to build a list nobody has asked
           * for. `@name` still renders as written; it simply does not complete.
           */
          people={[]}
          t={t}
          keyboardOffset={HEAD}
          onChanged={load}
          // Fetching the thread is what marks it read, and `load` is the
          // fetch — so reaching the bottom re-reads and re-marks in one act.
          onSeen={() => void load()}
        />
      )}
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
