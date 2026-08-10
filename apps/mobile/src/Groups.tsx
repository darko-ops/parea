/**
 * Groups — design §3, and the half of §1's native case that is not
 * auto-selection.
 *
 * A group is the answer to "the same people keep doing things together": one
 * place the events accumulate, so nobody re-solves *how do I reach everyone*
 * for the fourth dinner running. On the web it is reachable only from an event
 * you still have the link to, which makes it an attribute of a link rather
 * than of a person. Here it belongs to the actor, so a reinstall does not lose
 * it and a lost link is recoverable.
 *
 * The distinction the whole screen turns on is **door versus room**. A member
 * sees the events. Everyone else sees a name and a member count, and only if
 * the group chose to be findable — there is no state in which a stranger
 * learns what events exist, let alone what is in them. The server enforces
 * that; this file must not present anything that implies otherwise.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Api, GroupView, JoinRequest } from './api';

/** Structural rather than imported, to keep this file out of App's import cycle. */
export type GroupTheme = {
  bg: string;
  fg: string;
  dim: string;
  card: string;
  line: string;
  accent: string;
  onAccent: string;
};

export type OpenableEvent = {
  id: string;
  name: string;
  linkToken: string;
  startsAt: string | null;
  endsAt: string | null;
};

export function GroupScreen({
  api,
  groupId,
  t,
  onBack,
  onOpenEvent,
  Button,
}: {
  api: Api;
  groupId: string;
  t: GroupTheme;
  onBack: () => void;
  onOpenEvent: (event: OpenableEvent) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [group, setGroup] = useState<GroupView | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await api.group(groupId);
      setGroup(view);
      setError(null);
      // Only an admin may read these, and asking as anyone else is a 404 —
      // so it is asked for separately rather than folded into the group.
      if (view.member && view.role === 'admin') {
        setRequests(await api.joinRequests(groupId).catch(() => []));
      }
    } catch {
      // One message for "no such group", "private group" and "not for you".
      // Telling them apart would make this screen a way to confirm a private
      // group exists, which is the one thing the server refuses to do.
      setError('That group is not available.');
    }
  }, [api, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.joinGroup(groupId);
      if (result.requested) {
        Alert.alert(
          'Asked to join',
          'An admin will see your request. Nothing happens until they say yes.',
        );
      }
      await load();
    } catch {
      Alert.alert('Could not join', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, groupId, load]);

  const leave = useCallback(() => {
    Alert.alert('Leave this group?', 'You keep any event links you already have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await api.leaveGroup(groupId).catch(() => {});
          onBack();
        },
      },
    ]);
  }, [api, groupId, onBack]);

  const resolve = useCallback(
    async (requestId: string, action: 'approve' | 'decline') => {
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      await api.resolveRequest(groupId, requestId, action).catch(() => {});
      await load();
    },
    [api, groupId, load],
  );

  if (error) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={onBack}>
          <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.body, { color: t.dim }]}>{error}</Text>
      </ScrollView>
    );
  }

  if (!group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack}>
        <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
      </Pressable>

      <Text style={[styles.h1, { color: t.fg }]}>{group.name}</Text>
      <Text style={[styles.body, { color: t.dim }]}>
        {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
      </Text>

      {!group.member ? (
        // The door. Deliberately spare: a name and a count is everything a
        // non-member is told, and the button says which of the two things is
        // about to happen rather than making them find out.
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            {group.canJoinDirectly
              ? 'You were at one of this group’s events, so you can join without asking.'
              : 'Ask to join, and an admin will decide. Nothing here is visible until then.'}
          </Text>
          <Button
            label={busy ? 'Sending…' : group.canJoinDirectly ? 'Join' : 'Ask to join'}
            onPress={join}
            disabled={busy}
            t={t}
            primary
          />
        </View>
      ) : (
        <>
          {group.role === 'admin' && requests.length > 0 && (
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.label, { color: t.fg }]}>
                {requests.length} waiting to join
              </Text>
              {requests.map((request) => (
                <View key={request.id} style={styles.requestRow}>
                  {/* No profiles to link to; a name if they gave one. */}
                  <Text style={[styles.body, { color: t.fg, flex: 1 }]}>
                    {request.displayName ?? 'Someone'}
                  </Text>
                  <Pressable onPress={() => resolve(request.id, 'approve')} hitSlop={8}>
                    <Text style={[styles.body, { color: t.accent }]}>Approve</Text>
                  </Pressable>
                  <Pressable onPress={() => resolve(request.id, 'decline')} hitSlop={8}>
                    <Text style={[styles.body, { color: t.dim }]}>Decline</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={[styles.label, { color: t.fg }]}>Events</Text>
            {group.events.length === 0 ? (
              <Text style={[styles.body, { color: t.dim }]}>
                Nothing yet. The next event someone makes in this group shows up
                here, and everyone gets told.
              </Text>
            ) : (
              group.events.map((event) => (
                <Pressable
                  key={event.id}
                  style={styles.listRow}
                  onPress={() =>
                    onOpenEvent({
                      id: event.id,
                      name: event.name,
                      linkToken: event.linkToken,
                      // Carried through so an event opened from here can still
                      // auto-select. Losing them here would silently drop every
                      // grouped event to the system picker.
                      startsAt: event.startsAt,
                      endsAt: event.endsAt,
                    })
                  }
                >
                  <Text style={[styles.body, { color: t.accent }]}>{event.name}</Text>
                  <Text style={[styles.small, { color: t.dim }]}>
                    {new Date(event.eventDate ?? event.createdAt).toLocaleDateString()}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <Button label="Leave this group" onPress={leave} t={t} />
        </>
      )}
    </ScrollView>
  );
}

/**
 * Finding a group by name — the backstop for a lost link.
 *
 * The only discovery surface in the product, and it returns doors. There is
 * deliberately no equivalent for events or photos: groups can be findable,
 * photos never are.
 */
export function GroupSearch({
  api,
  t,
  onOpen,
}: {
  api: Api;
  t: GroupTheme;
  onOpen: (groupId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; memberCount: number }[]>(
    [],
  );

  useEffect(() => {
    // Two characters is the server's floor, and typing through it should not
    // fire a request per keystroke.
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const found = await api.searchGroups(query).catch(() => []);
      if (live) setResults(found);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, query]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>Find a group by name</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Sunday roast"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
      />
      {results.map((group) => (
        <Pressable key={group.id} style={styles.listRow} onPress={() => onOpen(group.id)}>
          <Text style={[styles.body, { color: t.accent }]}>{group.name}</Text>
          <Text style={[styles.small, { color: t.dim }]}>
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingTop: 72, gap: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  listRow: { paddingVertical: 10, gap: 2 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
