/**
 * A list of friends, on its own page — yours, or somebody else's.
 *
 * It was a sheet over the profile, on the reasoning that a list reached from
 * a number is left again at once. It is not: it is somewhere people browse,
 * opening one friend and coming back for the next, and a sheet that closed on
 * every tap sent them back to the profile to open it all over again. A page
 * with a back arrow is somewhere to come back to — Back from a friend's
 * profile lands here, and Back from here lands on the profile it was reached
 * from.
 *
 * It fetches its own list rather than being handed one: it is a route, and a
 * route outlives the screen that pushed it.
 */

import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Api, InvitablePerson } from './api';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Back, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

export function FriendsScreen({
  api,
  handle,
  title,
  t,
  onBack,
  onOpenPerson,
}: {
  api: Api;
  /** Whose friends: a handle, or null for the person holding the phone. */
  handle: string | null;
  title: string;
  t: GroupTheme;
  onBack: () => void;
  onOpenPerson: (handle: string) => void;
}) {
  /** `null` while loading; `false` when it could not be had. */
  const [friends, setFriends] = useState<InvitablePerson[] | null | false>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setFriends(await (handle ? api.friendsOf(handle) : api.friends()));
    } catch {
      setFriends((was) => (was ? was : false));
    }
  }, [api, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* The same disc, in the same corner, as every other way back. */}
      <RoundButton t={t} onPress={onBack} accessibilityLabel="Back" style={styles.back}>
        <Back color={t.fg} />
      </RoundButton>

      <ScrollView
        contentContainerStyle={[styles.scroll, friends === null && styles.filling]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.dim}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={[styles.h1, { color: t.fg }]} numberOfLines={2}>
          {title}
        </Text>

        {friends === null && <Waiting fill />}
        {friends === false && (
          <Text style={[styles.note, { color: t.dim }]}>
            Could not load this list. Pull down to try again.
          </Text>
        )}
        {friends && friends.length === 0 && (
          <Text style={[styles.note, { color: t.dim }]}>No friends yet.</Text>
        )}

        {friends && friends.length > 0 && (
          <View>
            {friends.map((friend, i) => {
              const lens = lensFor(friend.handle ?? friend.actorId);
              /*
               * Somebody with no handle cannot be opened.
               *
               * A profile is reached by handle — it is the half of a person
               * that is an address — and not everybody has chosen one. The
               * row still lists them, because they are a friend either way;
               * it simply does not pretend to be a way through.
               */
              const reachable = friend.handle != null;
              return (
                <Pressable
                  key={friend.actorId}
                  disabled={!reachable}
                  onPress={() => {
                    if (friend.handle) onOpenPerson(friend.handle);
                  }}
                  accessibilityRole={reachable ? 'button' : undefined}
                  accessibilityLabel={
                    reachable
                      ? `${friend.displayName ?? friend.handle}, open their profile`
                      : undefined
                  }
                  style={({ pressed }) => [
                    styles.row,
                    // No rule under the last one.
                    i < friends.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  {friend.avatar ? (
                    <Image
                      source={{ uri: friend.avatar }}
                      style={[styles.face, { backgroundColor: t.line }]}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View style={[styles.face, styles.blank, { backgroundColor: lens.fill }]}>
                      <Text style={[styles.letter, { color: lens.ink }]}>
                        {initialOf(friend.displayName ?? friend.handle)}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
                      {friend.displayName?.trim() || friend.handle || 'Someone'}
                    </Text>
                    {friend.displayName && friend.handle && (
                      <Text style={[styles.handle, { color: t.dim }]} numberOfLines={1}>
                        {friend.handle}
                      </Text>
                    )}
                  </View>
                  {reachable && <Text style={[styles.go, { color: t.dim }]}>›</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* Find Friends' corner and inset, so Back is where it always is. */
  back: { position: 'absolute', top: 52, left: 16, zIndex: 3 },
  scroll: { paddingTop: 100, paddingHorizontal: 20, paddingBottom: 48, gap: 16 },
  filling: { flexGrow: 1 },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  note: { fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  // A rounded square, like every other face in this product (`Groups.tsx`).
  face: { width: 38, height: 38, borderRadius: 10, overflow: 'hidden' },
  blank: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 15, fontWeight: '700' },
  name: { fontSize: 15.5, fontWeight: '600' },
  handle: { fontSize: 13 },
  go: { fontSize: 20 },
});
