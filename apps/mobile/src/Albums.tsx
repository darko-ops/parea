/**
 * The three tabs' contents: home, search, profile.
 *
 * "Album" is the word the product says out loud for what the schema calls an
 * event. Same thing — the schema keeps `event` because that is what every
 * access rule in §3 is written against, and renaming a table to match a label
 * buys nothing.
 *
 * All three read from `GET /api/albums`, which lists what this actor can
 * actually reach: events they have presented a credential to, plus every event
 * in a group they belong to. Not "everything a link would still open" — a link
 * is something you were sent, not somewhere you live, and an album opened once
 * a year ago does not belong on a home screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Album, Api } from './api';
import type { GroupTheme } from './Groups';

export type TabTheme = GroupTheme;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One album, as a rounded card.
 *
 * The counts are the point of the card rather than decoration: "6 people, 88
 * photos" is the recruiting device the concept names (§2), and it is the same
 * sentence whether you are deciding to open an album or deciding to add to it.
 */
function AlbumCard({
  album,
  t,
  onPress,
}: {
  album: Album;
  t: TabTheme;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${plural(album.memberCount, 'member')}, ${plural(album.photoCount, 'photo')}`}
      style={[styles.album, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Text style={[styles.albumName, { color: t.fg }]} numberOfLines={2}>
        {album.name}
      </Text>
      <Text style={[styles.body, { color: t.dim }]}>
        {plural(album.memberCount, 'member')} · {plural(album.photoCount, 'photo')}
      </Text>
      {(album.place || album.groupName) && (
        <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
          {[album.place, album.groupName].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}

/** Page 1 — what is happening, most recently active first. */
export function HomeTab({
  albums,
  loading,
  t,
  onOpen,
  onRefresh,
  onCreate,
  Button,
}: {
  albums: Album[];
  loading: boolean;
  t: TabTheme;
  onOpen: (album: Album) => void;
  onRefresh: () => Promise<void>;
  onCreate: () => void;
  Button: ButtonComponent;
}) {
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.dim}
          onRefresh={async () => {
            setRefreshing(true);
            await onRefresh();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={[styles.h1, { color: t.fg }]}>Albums</Text>

      {loading && albums.length === 0 && <ActivityIndicator color={t.accent} />}

      {!loading && albums.length === 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.body, { color: t.fg }]}>
            Nothing here yet. Albums you are sent, or make, show up here.
          </Text>
          <Button label="Start an album" onPress={onCreate} t={t} primary />
        </View>
      )}

      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} t={t} onPress={() => onOpen(album)} />
      ))}

      {albums.length > 0 && <Button label="Start an album" onPress={onCreate} t={t} />}
    </ScrollView>
  );
}

/**
 * Page 2 — finding things.
 *
 * Two halves, and they are different in kind. Group search reaches groups this
 * person is *not* in, and is the only discovery surface in the product: it
 * returns findable groups by name, never events and never photos. §3's rule
 * holds — groups can be findable, photos never are — so there is deliberately
 * no album search here, and adding one would make people's photos
 * discoverable by strangers.
 *
 * The map half is the opposite: it reaches only albums this person is already
 * in, arranged by where they were. Nothing is discovered, and nothing is
 * exposed that they could not already see.
 */
export function SearchTab({
  api,
  albums,
  t,
  onOpen,
  onOpenGroup,
}: {
  api: Api;
  albums: Album[];
  t: TabTheme;
  onOpen: (album: Album) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    { id: string; name: string; memberCount: number }[]
  >([]);

  const search = useCallback(
    async (next: string) => {
      setQuery(next);
      // Two characters is the server's floor. Below it there is nothing to
      // ask for, and asking per keystroke is a request per keystroke.
      if (next.trim().length < 2) return setResults([]);
      setResults(await api.searchGroups(next).catch(() => []));
    },
    [api],
  );

  /** Albums that know where they were, newest place first. */
  const places = useMemo(() => {
    const byPlace = new Map<string, Album[]>();
    for (const album of albums) {
      if (!album.place) continue;
      byPlace.set(album.place, [...(byPlace.get(album.place) ?? []), album]);
    }
    return [...byPlace.entries()];
  }, [albums]);

  const unplaced = albums.filter((a) => !a.place).length;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={[styles.h1, { color: t.fg }]}>Find</Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>A group, by name</Text>
        <TextInput
          value={query}
          onChangeText={search}
          placeholder="Sunday roast"
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search for a group by name"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Text style={[styles.small, { color: t.dim }]}>
          Groups can be findable. Albums and photos never are — the only way
          into one is being sent it.
        </Text>
        {results.map((group) => (
          <Pressable
            key={group.id}
            style={styles.row}
            onPress={() => onOpenGroup(group.id)}
          >
            <Text style={[styles.body, { color: t.accent }]}>{group.name}</Text>
            <Text style={[styles.small, { color: t.dim }]}>
              {plural(group.memberCount, 'member')}
            </Text>
          </Pressable>
        ))}
        {query.trim().length >= 2 && results.length === 0 && (
          <Text style={[styles.body, { color: t.dim }]}>Nothing by that name.</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Your albums, by place</Text>
        {places.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>
            None of your albums say where they were yet. Whoever starts one can
            add a place, and it shows up here.
          </Text>
        ) : (
          places.map(([place, inPlace]) => (
            <View key={place} style={styles.placeBlock}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: t.fg, flex: 1 }]}>{place}</Text>
                <Pressable
                  hitSlop={8}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${place} in Maps`}
                  // The system map rather than an embedded one. A map view is a
                  // native module this codebase cannot test, and handing the
                  // place to the maps app someone already uses gets them
                  // directions as well as a pin.
                  onPress={() =>
                    void Linking.openURL(
                      `https://maps.apple.com/?q=${encodeURIComponent(place)}`,
                    )
                  }
                >
                  <Text style={[styles.small, { color: t.accent }]}>Map ›</Text>
                </Pressable>
              </View>
              {inPlace.map((album) => (
                <Pressable
                  key={album.id}
                  style={styles.row}
                  onPress={() => onOpen(album)}
                >
                  <Text style={[styles.body, { color: t.accent }]}>{album.name}</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
        {unplaced > 0 && places.length > 0 && (
          <Text style={[styles.small, { color: t.dim }]}>
            {plural(unplaced, 'album')} without a place.
          </Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>People</Text>
        {/*
          Honest rather than absent. Finding someone means there is someone to
          find, and this product has no accounts on purpose (§3): identity is a
          credential on a device, and there is nobody to look up. Building it
          is a decision about what the product is, not a screen.
        */}
        <Text style={[styles.body, { color: t.dim }]}>
          There is nobody to find yet. Nothing here uses accounts — you are
          whoever holds this phone — so there are no profiles to search.
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * Signing in — design §3, and the only reason accounts exist here.
 *
 * "Optional, asked for only after value has been delivered." An account holds
 * an email address and grants nothing an actor does not already have: its one
 * job is that a new phone is still you, which a credential in a keychain
 * cannot manage on its own. So it lives at the bottom of the profile tab and
 * nothing anywhere prompts for it.
 *
 * A code rather than a link, because mail often opens on a different device
 * from the one signing in — and setting up a new phone is exactly when that
 * happens.
 */
function AccountCard({
  api,
  t,
  Button,
  onSignedIn,
}: {
  api: Api;
  t: TabTheme;
  Button: ButtonComponent;
  onSignedIn: () => void;
}) {
  const [account, setAccount] = useState<{ email: string } | null | undefined>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .account()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [api]);

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestSignIn(email.trim());
      setSent(true);
    } catch {
      // The server answers the same however it went, so the only thing that
      // can be reported here is that the request itself did not land.
      setError('Could not ask for a code. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, email]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.completeSignIn(email.trim(), code);
      setAccount({ email: result.email });
      setSent(false);
      setCode('');
      if (result.merged) {
        // Said out loud rather than swapped silently: everything they added
        // on this phone has just become part of another identity, and that is
        // the point of signing in but it should not be a surprise.
        Alert.alert(
          'Signed in',
          'This phone has joined your account. Everything you added here is now part of it.',
        );
      }
      onSignedIn();
    } catch {
      setError('That code did not work. Codes expire after ten minutes.');
    } finally {
      setBusy(false);
    }
  }, [api, code, email, onSignedIn]);

  const remove = useCallback(() => {
    // Two separate things, and conflating them would take other people's
    // copies of an evening they were also at. Guideline 5.1.1(v) requires the
    // first; the second is offered beside it rather than folded into it.
    Alert.alert(
      'Delete your account?',
      'Your email address and this account are removed. The photos you added stay in their albums and stay yours to remove.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            await api.deleteAccount(false).catch(() => {});
            setAccount(null);
          },
        },
        {
          text: 'Delete account and my photos',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteAccount(true).catch(() => null);
            setAccount(null);
            if (result) {
              Alert.alert('Deleted', `${result.photos} photos removed.`);
            }
          },
        },
      ],
    );
  }, [api]);

  if (account === undefined) return null;

  if (account) {
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Signed in</Text>
        <Text style={[styles.body, { color: t.dim }]}>{account.email}</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          Your albums and groups follow you to a new phone. That is all an
          account does here.
        </Text>
        <Button label="Delete account" onPress={remove} t={t} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>Keep these on a new phone</Text>
      <Text style={[styles.small, { color: t.dim }]}>
        Optional. Add an email and your albums and groups follow you to another
        device. No password — a code goes to your inbox.
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Your email address"
        style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
      />

      {sent && (
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-digit code"
          placeholderTextColor={t.dim}
          keyboardType="number-pad"
          // Lets iOS offer the code straight from the notification.
          textContentType="oneTimeCode"
          autoFocus
          accessibilityLabel="The code from your email"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
      )}

      {error && <Text style={[styles.small, { color: t.dim }]}>{error}</Text>}

      <Button
        label={busy ? 'Working…' : sent ? 'Sign in' : 'Send me a code'}
        onPress={sent ? verify : request}
        disabled={busy || (sent ? code.length < 6 : !email.includes('@'))}
        t={t}
        primary
      />
      {sent && (
        <Text style={[styles.small, { color: t.dim }]}>
          Sent, if that address is one we can reach. It works once and expires
          in ten minutes.
        </Text>
      )}
    </View>
  );
}

/** Page 3 — everything you are in, by group. */
export function ProfileTab({
  api,
  albums,
  groups,
  displayName,
  t,
  onOpen,
  onOpenGroup,
  onRename,
  onSignedIn,
  Button,
}: {
  api: Api;
  albums: Album[];
  groups: { id: string; name: string; role: 'member' | 'admin' }[];
  displayName: string | null;
  t: TabTheme;
  onOpen: (album: Album) => void;
  onOpenGroup: (groupId: string) => void;
  onRename: (name: string) => void;
  onSignedIn: () => void;
  Button: ButtonComponent;
}) {
  const [name, setName] = useState(displayName ?? '');

  const grouped = useMemo(() => albums.filter((a) => a.groupId), [albums]);
  const loose = useMemo(() => albums.filter((a) => !a.groupId), [albums]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={[styles.h1, { color: t.fg }]}>You</Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>What people see</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => onRename(name.trim())}
          placeholder="Your name (optional)"
          placeholderTextColor={t.dim}
          maxLength={60}
          accessibilityLabel="The name shown beside your uploads"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Text style={[styles.small, { color: t.dim }]}>
          Optional, and the whole of your identity here. No account, no email,
          nothing to log in to — this phone is who you are.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>
          Groups {groups.length > 0 && `(${groups.length})`}
        </Text>
        {groups.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>
            None yet. A group is what an album becomes when the same people keep
            doing things together.
          </Text>
        ) : (
          groups.map((group) => (
            <Pressable
              key={group.id}
              style={styles.row}
              onPress={() => onOpenGroup(group.id)}
            >
              <Text style={[styles.body, { color: t.accent, flex: 1 }]}>{group.name}</Text>
              {group.role === 'admin' && (
                <Text style={[styles.small, { color: t.dim }]}>admin</Text>
              )}
            </Pressable>
          ))
        )}
      </View>

      {grouped.length > 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.label, { color: t.fg }]}>In your groups</Text>
          {grouped.map((album) => (
            <Pressable key={album.id} style={styles.row} onPress={() => onOpen(album)}>
              <Text style={[styles.body, { color: t.accent, flex: 1 }]}>{album.name}</Text>
              <Text style={[styles.small, { color: t.dim }]}>{album.groupName}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>One-offs</Text>
        {loose.length === 0 ? (
          <Text style={[styles.body, { color: t.dim }]}>Nothing here.</Text>
        ) : (
          loose.map((album) => (
            <Pressable key={album.id} style={styles.row} onPress={() => onOpen(album)}>
              <Text style={[styles.body, { color: t.accent }]}>{album.name}</Text>
            </Pressable>
          ))
        )}
      </View>

      <AccountCard api={api} t={t} Button={Button} onSignedIn={onSignedIn} />

      <Button
        label="Safety, reporting and contact"
        t={t}
        onPress={() => void Linking.openURL('https://parea.photos/safety')}
      />
    </ScrollView>
  );
}

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: TabTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 40, gap: 14 },
  h1: { fontSize: 30, fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  // Rounded, tall, one per row: the shape people scroll through.
  album: { borderRadius: 18, borderWidth: 1, padding: 20, gap: 6, minHeight: 108 },
  albumName: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  placeBlock: { gap: 2, paddingTop: 4 },
});
