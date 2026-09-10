/**
 * You, as a profile rather than as a settings screen.
 *
 * The You tab was a form: a name field in a card, a paragraph explaining what
 * the field was for, then two lists of events under headings. Everything the
 * product knows about a person was there and none of it looked like a person —
 * the picture, the handle and the line they wrote about themselves were on the
 * web's profile and simply absent here, though `/api/account/session` has been
 * answering with all four for as long as that page has existed.
 *
 * So it is laid out the way a profile is laid out anywhere: the picture and
 * the numbers on one line, the name and the handle and the bio under them, one
 * button that opens the whole thing for editing, and then a grid.
 *
 * ## The grid is albums, not photographs
 *
 * Which is the one place this departs from the shape it borrows. A square of
 * somebody's photographs would be a wall of images with no way to tell one
 * evening from another, and the product's unit is the evening — so each tile
 * is an album, leading with its cover, with its name across the bottom. Tap
 * one and it opens, which is what the two lists under headings were for.
 *
 * ## What the numbers may say
 *
 * Albums, photographs, friends. All three are facts about this person's own
 * shelf: the albums are the ones they can reach, the count is how many
 * photographs are in those, and the friends are already a number the web's own
 * profile prints for you. Nothing here counts anything about anybody else, and
 * the photograph number is deliberately not a claim about authorship — it is
 * the size of the shelf, not a score.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import type { Account, Api, EventListing } from './api';
import { ApiError } from './api';
import { AccountCard } from './Events';
import type { GroupTheme } from './Groups';
import { uploadCover } from './platform';

/** Three across, like every grid this borrows from. */
const COLUMNS = 3;
/** Hairlines between tiles rather than gutters: the grid is one object. */
const GAP = 2;

type ButtonEl = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

export function ProfileScreen({
  api,
  events,
  t,
  onOpen,
  onSignedIn,
  onSignedOut,
  Button,
}: {
  api: Api;
  /** Everything this person can reach, which is what the grid draws. */
  events: EventListing[];
  t: GroupTheme;
  onOpen: (event: EventListing) => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
  Button: ButtonEl;
}) {
  const [account, setAccount] = useState<Account | null | undefined>();
  const [friends, setFriends] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const { width } = useWindowDimensions();

  const load = useCallback(async () => {
    setAccount(await api.account().catch(() => null));
    // Its own call and its own failure: a profile with no friend count is a
    // profile missing a number, where one that throws is a blank screen.
    setFriends(await api.friends().then((list) => list.length).catch(() => null));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const photos = events.reduce((sum, event) => sum + event.photoCount, 0);
  const name = account?.displayName?.trim() || null;
  /*
   * The letter, when there is no picture. Never a silhouette — the rule the
   * rest of the product follows, and it reads worse at this size than
   * anywhere: a generic avatar 84 points across is a photograph of nobody.
   */
  const initial = (name || account?.handle || account?.email || '?')
    .replace(/^@/, '')
    .slice(0, 1)
    .toUpperCase();

  /** The tile edge, from the window rather than a constant. */
  const tile = Math.floor((width - 40 - GAP * (COLUMNS - 1)) / COLUMNS);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.head}>
        <Pressable
          onPress={() => setEditing(true)}
          accessibilityRole="button"
          accessibilityLabel="Change your profile picture"
        >
          {account?.avatarUrl ? (
            <Image
              source={{ uri: account.avatarUrl }}
              style={[styles.avatar, { backgroundColor: t.line }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatar, styles.avatarBlank, { backgroundColor: t.line }]}>
              <Text style={[styles.avatarLetter, { color: t.dim }]}>{initial}</Text>
            </View>
          )}
        </Pressable>

        {/*
          The numbers, spread across the space beside the picture. Three of
          them, because two look like a pair of buttons and four are a
          dashboard — and these are the three that are about this person's own
          shelf rather than about anybody else.
        */}
        <View style={styles.stats}>
          <Stat n={events.length} label="Albums" t={t} />
          <Stat n={photos} label="Photos" t={t} />
          <Stat n={friends} label="Friends" t={t} />
        </View>
      </View>

      <View style={styles.who}>
        {name && (
          <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
            {name}
          </Text>
        )}
        {account?.handle && (
          <Text style={[styles.handle, { color: t.dim }]} numberOfLines={1}>
            @{account.handle}
          </Text>
        )}
        {/*
          The bio wraps rather than truncating. It is two hundred characters at
          most and somebody wrote it on purpose; an ellipsis in the middle of
          it says less than the third line would have.
        */}
        {account?.bio && <Text style={[styles.bio, { color: t.fg }]}>{account.bio}</Text>}
        {account === null && (
          <Text style={[styles.bio, { color: t.dim }]}>
            This device is not signed in. The albums below are the ones its
            links reach; signing in is what makes them a new phone away.
          </Text>
        )}
      </View>

      {account && !editing && (
        <Button label="Edit profile" onPress={() => setEditing(true)} t={t} />
      )}

      {account && editing && (
        <EditProfile
          api={api}
          account={account}
          t={t}
          Button={Button}
          onDone={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      {/*
        The grid. Albums rather than photographs — see the note at the top —
        each leading with the cover the card leads with, and named across the
        bottom because an evening is not recognisable from one square inch of
        one of its photographs.
      */}
      {events.length > 0 && (
        <View style={styles.grid}>
          {events.map((event) => (
            <Pressable
              key={event.id}
              onPress={() => onOpen(event)}
              accessibilityRole="button"
              accessibilityLabel={`${event.name}, ${event.photoCount} ${
                event.photoCount === 1 ? 'photo' : 'photos'
              }`}
              style={{ width: tile, height: tile }}
            >
              {event.cover ? (
                <Image
                  source={{ uri: event.cover.src }}
                  style={styles.tile}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                /*
                  An album with nothing in it yet still belongs on the shelf —
                  it is one of the things this person is in, and leaving it out
                  would make the grid disagree with the Albums number above it.
                  Dashed, which reads as "nothing here" rather than as a very
                  dark photograph.
                */
                <View style={[styles.tile, styles.tileEmpty, { borderColor: t.line }]} />
              )}
              <View style={styles.tileName}>
                <Text style={styles.tileNameText} numberOfLines={2}>
                  {event.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[styles.rule, { borderTopColor: t.line }]} />

      {/*
        The account itself, under a rule and at the bottom: what it holds is
        the address and the two destructive verbs, which belong below the
        person rather than in front of them. It is the same card the gated
        callers use, so signing in says the same thing wherever it is asked.
      */}
      <AccountCard
        api={api}
        t={t}
        Button={Button}
        onSignedIn={() => {
          void load();
          onSignedIn();
        }}
        onSignedOut={onSignedOut}
      />

      <Button
        label="Safety, reporting and contact"
        t={t}
        onPress={() => void Linking.openURL('https://parea.photos/safety')}
      />
    </ScrollView>
  );
}

function Stat({ n, label, t }: { n: number | null; label: string; t: GroupTheme }) {
  return (
    <View style={styles.stat}>
      {/*
        A dash rather than a zero while the number is unknown: "0 friends" is a
        claim, and it is the wrong one to make about somebody whose request has
        not come back yet.
      */}
      <Text style={[styles.statN, { color: t.fg }]}>{n === null ? '—' : n}</Text>
      <Text style={[styles.statLabel, { color: t.dim }]}>{label}</Text>
    </View>
  );
}

/**
 * The whole profile, open for editing.
 *
 * One panel rather than a field per row with its own explanation, which is
 * what the tab used to be. The three text fields are sent together and only
 * the ones that changed — the route takes each optionally, so an empty bio
 * typed by accident cannot clear a handle.
 *
 * The handle is the only one that can be refused, and the message is the
 * route's rather than this screen's: it knows whether the problem is the
 * shape, a reserved word or somebody else already having it, and inventing a
 * sentence here would eventually say the wrong one.
 */
function EditProfile({
  api,
  account,
  t,
  Button,
  onDone,
}: {
  api: Api;
  account: Account;
  t: GroupTheme;
  Button: ButtonEl;
  onDone: () => void;
}) {
  const [name, setName] = useState(account.displayName ?? '');
  const [handle, setHandle] = useState(account.handle ?? '');
  const [bio, setBio] = useState(account.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    const patch: { displayName?: string; handle?: string; bio?: string } = {};
    if (name.trim() !== (account.displayName ?? '')) patch.displayName = name.trim();
    if (handle.trim() !== (account.handle ?? '')) patch.handle = handle.trim();
    if (bio.trim() !== (account.bio ?? '')) patch.bio = bio.trim();
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      onDone();
      return;
    }
    try {
      await api.updateProfile(patch);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.body.message === 'string'
          ? err.body.message
          : 'Could not save that. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }, [account, api, bio, handle, name, onDone]);

  /**
   * A new picture, straight off the camera roll.
   *
   * The system picker rather than the library reader, and for the reason the
   * cover uses it: picking one image needs no permission at all on iOS, where
   * asking for the whole library to choose one thing is the app requesting
   * everything in order to take a little.
   *
   * The bytes stream from disk through the same uploader a cover uses. The
   * endpoint re-encodes whatever arrives, so nothing that was not pixels
   * survives — a selfie taken at home carries the coordinates of the home.
   */
  const pickAvatar = useCallback(async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets[0]) return;
    setBusy(true);
    setError(null);
    try {
      const target = api.avatarTarget();
      await uploadCover(target.url, target.headers, picked.assets[0].uri);
      onDone();
    } catch {
      setError('Could not send that picture. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, onDone]);

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.accent }]}>
      <Text style={[styles.fieldLabel, { color: t.dim }]}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name (optional)"
        placeholderTextColor={t.dim}
        maxLength={80}
        style={[styles.input, { color: t.fg, borderColor: t.line }]}
        accessibilityLabel="The name shown beside your photos"
      />

      <Text style={[styles.fieldLabel, { color: t.dim }]}>HANDLE</Text>
      <TextInput
        value={handle}
        onChangeText={setHandle}
        placeholder="amber-quiet-lantern"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        style={[styles.input, { color: t.fg, borderColor: t.line }]}
        accessibilityLabel="Your handle, which is how people find you"
      />
      <Text style={[styles.hint, { color: t.dim }]}>
        How somebody finds you. Yours to change, and it is the one thing here
        that has to be unlike everybody else's.
      </Text>

      <Text style={[styles.fieldLabel, { color: t.dim }]}>ABOUT YOU</Text>
      <TextInput
        value={bio}
        onChangeText={setBio}
        placeholder="A line about you (optional)"
        placeholderTextColor={t.dim}
        maxLength={200}
        multiline
        style={[styles.input, styles.inputTall, { color: t.fg, borderColor: t.line }]}
        accessibilityLabel="A line about you, shown on your profile"
      />

      {busy && <ActivityIndicator color={t.accent} />}
      {error && <Text style={[styles.hint, { color: t.fg }]}>{error}</Text>}

      <Button label="Save" onPress={() => void save()} t={t} primary disabled={busy} />
      <Button label="Change picture" onPress={() => void pickAvatar()} t={t} disabled={busy} />
      {account.avatarUrl && (
        <Button
          label="Remove picture"
          onPress={() => {
            setBusy(true);
            void api
              .removeAvatar()
              .then(onDone)
              .catch(() => setError('Could not remove it. Try again in a moment.'))
              .finally(() => setBusy(false));
          }}
          t={t}
          disabled={busy}
        />
      )}
      <Button label="Cancel" onPress={onDone} t={t} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 72, paddingBottom: 110, gap: 14 },
  /* The picture and the numbers on one line, which is the whole of the shape
     this borrows: a profile opens by saying who and how much, not by opening a
     form. */
  head: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarBlank: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 32, fontWeight: '700' },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: 2 },
  statN: { fontSize: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12.5 },
  who: { gap: 2 },
  name: { fontSize: 17, fontWeight: '700' },
  handle: { fontSize: 14 },
  bio: { fontSize: 15, lineHeight: 21, marginTop: 6 },
  /* Edge to edge inside the page's padding, hairline gaps, square tiles: one
     object made of albums rather than a list of cards. */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: 6 },
  tile: { width: '100%', height: '100%', backgroundColor: '#8881' },
  tileEmpty: { borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  /* The name over the bottom of the tile. A scrim block rather than a
     gradient: a gradient needs a native module, and at this size the block is
     what makes two words legible over a photograph of anything. */
  tileName: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  tileNameText: { color: '#fff', fontSize: 11.5, fontWeight: '600', lineHeight: 15 },
  rule: { borderTopWidth: 1, marginTop: 20, marginBottom: 6 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 15, fontSize: 16 },
  inputTall: { minHeight: 84, textAlignVertical: 'top' },
  hint: { fontSize: 12.5, lineHeight: 18 },
});
