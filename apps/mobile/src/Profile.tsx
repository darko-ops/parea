/**
 * You, as a profile rather than as a settings screen.
 *
 * The tab was a form before it was this: a name field in a card, a paragraph
 * explaining what the field was for, then two lists of events under headings.
 * It became a profile — picture, handle, bio, a grid — and this is the second
 * pass over that, which fixes what the first one left loose.
 *
 * ## What changed, and why
 *
 * **There was no way into settings from anywhere in the app.** The address
 * this device is signed in as, signing out, deleting the account and the
 * safety and reporting link all sat at the foot of this scroll, under a rule,
 * below the grid — so the two destructive verbs in the product were reached by
 * scrolling past somebody's photographs, and the one screen that should have
 * an obvious way in had none. They are behind `Settings` now, which is the
 * second of two buttons and the only place any of them is.
 *
 * **`Edit profile` was one anonymous full-width slab.** A button the width of
 * the screen is the screen's primary action, and editing your bio is not what
 * somebody opens their own profile to do. It is half a row now, beside
 * Settings, and both are the same size because neither is more important than
 * the other.
 *
 * **The three numbers were a dashboard.** Three stacked pairs of figure and
 * label, spread across the space beside the picture, gave a shelf of eleven
 * albums the visual weight of an analytics panel. They are one line of text at
 * the size of the handle — "12 albums · 431 photos · 18 friends" — in one
 * colour, because none of the three is a score and the product does not want
 * them read as one.
 *
 * ## The grid is albums, not photographs
 *
 * The one place this departs from the shape it borrows, and it survives the
 * redesign. A square of somebody's photographs is a wall of images with no way
 * to tell one evening from another, and the product's unit is the evening — so
 * each tile is an album, leading with its cover, named and dated underneath
 * rather than over the picture. Two across rather than three: at 166 points a
 * cover is a photograph, and at 111 it was a swatch.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { dateLabel } from '@parea/cards';

import type { Account, Api, EventListing } from './api';
import { ApiError } from './api';
import { AccountCard } from './Events';
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { uploadCover } from './platform';

/** Two across: at this width a cover is a photograph rather than a swatch. */
const COLUMNS = 2;
/** Gutters rather than hairlines — these tiles are cards, not one object. */
const GAP = 10;

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
  webBase,
  t,
  onOpen,
  onCreateEvent,
  onCreateGroup,
  onSignedIn,
  onSignedOut,
  Button,
}: {
  api: Api;
  /** Everything this person can reach, which is what the grid draws. */
  events: EventListing[];
  /** Where a profile lives on the web, for the link `Share profile` hands out. */
  webBase: string;
  t: GroupTheme;
  onOpen: (event: EventListing) => void;
  /** The `+` in the corner: the album half. Opens the full create screen. */
  onCreateEvent: () => void;
  /**
   * The `+` in the corner: the group half.
   *
   * Goes to the Groups tab with its form open rather than drawing a second
   * copy of it here — the one on that tab comes with the people this person
   * keeps ending up in events with, which is the whole argument for making a
   * group at all. A bare name-and-nobody form on this screen would be the
   * empty-group problem the Groups tab was written to avoid.
   */
  onCreateGroup: () => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
  Button: ButtonEl;
}) {
  const [account, setAccount] = useState<Account | null | undefined>();
  const [friends, setFriends] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  /** The `+`'s two-line menu. Nothing is created until one of them is chosen. */
  const [creating, setCreating] = useState(false);
  const { width } = useWindowDimensions();

  /*
   * Both halves at once, and committed together.
   *
   * These were two `await`s in a row, which made this screen arrive in three
   * stages: the album grid first, because it comes from a prop that is already
   * loaded; then the name, the picture and the buttons when the account landed;
   * then the friend count a round trip later, turning a dash into a number. A
   * page assembling itself in front of somebody reads as a page that is broken,
   * even when every stage of it is correct.
   *
   * Asked for together they cost one round trip rather than two, and both
   * `set`s land in the same tick — React batches them into a single render, so
   * there is one transition instead of two.
   *
   * Each still keeps its own failure: a profile with no friend count is a
   * profile missing a number, where one that throws is a blank screen.
   */
  const load = useCallback(async () => {
    const [account, friends] = await Promise.all([
      api.account().catch(() => null),
      api.friends().then((list) => list.length).catch(() => null),
    ]);
    setAccount(account);
    setFriends(friends);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const photos = events.reduce((sum, event) => sum + event.photoCount, 0);
  const name = account?.displayName?.trim() || null;
  /*
   * The letter, when there is no picture. Never a silhouette — the rule the
   * rest of the product follows, and it reads worse at this size than
   * anywhere: a generic avatar 64 points across is a photograph of nobody. The
   * lens is keyed on the handle, so somebody's colour is theirs and does not
   * change the day they write a name in.
   */
  const lens = lensFor(account?.handle ?? account?.email ?? 'you');
  const initial = initialOf(name ?? account?.handle ?? account?.email);

  /** The tile edge, from the window rather than a constant. */
  const tile = Math.floor((width - 40 - GAP * (COLUMNS - 1)) / COLUMNS);

  /**
   * The profile's own link, handed out by `Share profile`.
   *
   * The handle rather than an id: it is the half of a profile somebody can
   * read out loud, and `/u/<handle>` is the address the web already answers
   * on. Nothing to share before somebody has one, which is why the button is
   * drawn disabled rather than hidden — a row that changes shape depending on
   * whether you have picked a handle is a row nobody learns.
   */
  const shareProfile = useCallback(() => {
    if (!account?.handle) return;
    void Share.share({ message: `${webBase}/u/${account.handle}` });
  }, [account?.handle, webBase]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/*
        The two things that are not about looking at this profile, in the two
        corners, above everything that is.

        Settings used to be half of the row under the bio, which put the
        product's two destructive verbs beside `Edit profile` and gave the
        screen's quietest action the same weight as its loudest. It is a `⋯` in
        the top-left now — the same glyph, in the same corner, as the one an
        album's own settings live behind, so there is one shape in the product
        that means "everything else about this thing".

        The `+` opposite it is the only place on this tab anything is made. It
        is drawn as one stroke rather than a labelled button because it is the
        third `+` somebody meets in this app and the other two already taught
        it.
      */}
      <View style={styles.bar}>
        <Pressable
          onPress={() => setSettings(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={[styles.barMore, { color: t.fg }]}>⋯</Text>
        </Pressable>

        <Pressable
          onPress={() => setCreating(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="New album or group"
          style={({ pressed }) => [styles.barPlus, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Glyph name="plus" size={22} color={t.fg} />
        </Pressable>
      </View>

      {/*
        Nothing below the corners until all of it is ready.
  
        The album grid comes from a prop that is already loaded, so it used to
        be on screen before the account that the name, the picture and the
        buttons are read from — the page built itself downwards while somebody
        watched. One spinner and then the whole thing is less information for a
        moment and more of it after; a page arriving in pieces is a page that
        looks broken even when every piece is right.
  
        The corners are exempt because they are not waiting for anything: they
        are the same two glyphs before and after, so holding them back would be
        inventing a transition rather than removing one.
      */}
      {account === undefined ? (
        <ActivityIndicator color={t.accent} style={styles.waiting} />
      ) : (
        <>
      <View style={[styles.head, styles.headLower]}>
        <View style={styles.who}>
          {name ? (
            <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
              {name}
            </Text>
          ) : (
            account?.handle && (
              <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
                @{account.handle}
              </Text>
            )
          )}
          {name && account?.handle && (
            <Text style={[styles.handle, { color: t.dim }]} numberOfLines={1}>
              @{account.handle}
            </Text>
          )}
          {/*
            One line, one colour, at the size of the handle.

            None of the three is a score: the albums are the ones this person
            can reach, the photographs are how many are in those, and the
            friends are a number the web's own profile already prints. A dash
            rather than a zero while a number is unknown — "0 friends" is a
            claim, and the wrong one to make about somebody whose request has
            not come back yet.
          */}
          <Text style={[styles.counts, { color: t.dim }]}>
            {events.length} {events.length === 1 ? 'album' : 'albums'} · {photos}{' '}
            {photos === 1 ? 'photo' : 'photos'} · {friends === null ? '—' : friends} friends
          </Text>
        </View>

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
              transition={120}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarBlank, { backgroundColor: lens.fill }]}>
              <Text style={[styles.avatarLetter, { color: lens.ink }]}>{initial}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/*
        The bio wraps rather than truncating. It is two hundred characters at
        most and somebody wrote it on purpose; an ellipsis in the middle of it
        says less than the third line would have.
      */}
      {account?.bio && <Text style={[styles.bio, { color: t.fg }]}>{account.bio}</Text>}
      {account === null && (
        <Text style={[styles.bio, { color: t.dim }]}>
          This device is not signed in. The albums below are the ones its links
          reach; signing in is what makes them a new phone away.
        </Text>
      )}

      {/*
        Two halves of one row, and neither is the screen's primary action —
        which is opening an album. `Edit profile` carries the ink border
        because it is the one of the two that changes what other people see.

        The second half was `Settings`, which is in the corner now. What stands
        here instead is the thing somebody actually opens their own profile to
        do to it: hand it to somebody. Settings was a door out of this screen;
        sharing is about the screen you are on, which is what a button under
        the bio should be.
      */}
      {account && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.action,
              { borderColor: t.fg, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.actionText, { color: t.fg }]}>Edit profile</Text>
          </Pressable>
          <Pressable
            onPress={shareProfile}
            disabled={!account.handle}
            accessibilityRole="button"
            accessibilityLabel="Share your profile"
            style={({ pressed }) => [
              styles.action,
              {
                borderColor: t.line,
                backgroundColor: t.card,
                // Nothing to hand out until there is a handle to put in the
                // link. Dimmed rather than gone: see `shareProfile`.
                opacity: !account.handle ? 0.4 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.actionText, { color: t.fg }]}>Share profile</Text>
          </Pressable>
        </View>
      )}

      {/* Not signed in: the card that asks is the screen, because there is no
          profile to draw and nothing for Settings to hold. */}
      {account === null && (
        <AccountCard api={api} t={t} Button={Button} onSignedIn={() => { void load(); onSignedIn(); }} />
      )}

      {/*
        The shelf. Albums rather than photographs — see the note at the top —
        each leading with the cover its card leads with, named and dated under
        the picture rather than over it: a scrim block across the bottom of
        every tile is a grid that reads as captioned stock photography.
      */}
      {events.length > 0 && (
        <View style={styles.grid}>
          {events.map((event) => {
            const when = dateLabel(event.eventDate ?? event.firstPhotoAt);
            return (
              <Pressable
                key={event.id}
                onPress={() => onOpen(event)}
                accessibilityRole="button"
                accessibilityLabel={`${event.name}, ${event.photoCount} ${
                  event.photoCount === 1 ? 'photo' : 'photos'
                }`}
                style={{ width: tile }}
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
                    it is one of the things this person is in, and leaving it
                    out would make the grid disagree with the count above it.
                    Dashed, which reads as "nothing here" rather than as a very
                    dark photograph.
                  */
                  <View style={[styles.tile, styles.tileEmpty, { borderColor: t.line }]} />
                )}
                <Text style={[styles.tileName, { color: t.fg }]} numberOfLines={1}>
                  {event.name}
                </Text>
                <Text style={[styles.tileMeta, { color: t.dim }]} numberOfLines={1}>
                  {event.photoCount === 0
                    ? 'Nothing in it yet'
                    : when
                      ? `${when} · ${event.photoCount}`
                      : `${event.photoCount} ${event.photoCount === 1 ? 'photo' : 'photos'}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
        </>
      )}

      {account && editing && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setEditing(false)}>
          <Pressable style={styles.backdrop} onPress={() => setEditing(false)}>
            <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
              <ScrollView contentContainerStyle={styles.panelScroll}>
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
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/*
        What the `+` makes, as two lines.

        A sheet rather than a menu pinned under the corner: the two things it
        makes are not the same size — an album is an evening and a group is a
        room that outlives one — and each gets a line saying which is which.
        Neither creates anything on its own; both hand off to the screen that
        already knows how, so there is still exactly one way to make each.
      */}
      {creating && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCreating(false)}>
          <Pressable style={styles.backdrop} onPress={() => setCreating(false)}>
            <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
              <View style={styles.panelScroll}>
                <Text style={[styles.panelTitle, { color: t.fg }]}>Start something</Text>

                <Pressable
                  onPress={() => {
                    setCreating(false);
                    onCreateEvent();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.choice,
                    { borderColor: t.line, backgroundColor: t.card, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.choiceName, { color: t.fg }]}>New album</Text>
                  <Text style={[styles.choiceWhy, { color: t.dim }]}>
                    One evening, and a link for the people who were at it.
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setCreating(false);
                    onCreateGroup();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.choice,
                    { borderColor: t.line, backgroundColor: t.card, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.choiceName, { color: t.fg }]}>New group</Text>
                  <Text style={[styles.choiceWhy, { color: t.dim }]}>
                    The people you keep ending up with, so the next album has
                    somewhere to go.
                  </Text>
                </Pressable>

                <Button label="Cancel" t={t} onPress={() => setCreating(false)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {settings && (
        <Settings
          api={api}
          t={t}
          Button={Button}
          onClose={() => setSettings(false)}
          onSignedIn={() => {
            void load();
            onSignedIn();
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </ScrollView>
  );
}

/**
 * What was loose at the foot of the profile.
 *
 * The address this device is signed in as, signing out, deleting the account
 * and the safety and reporting link — all of it was under a rule below the
 * grid, which meant the two destructive verbs in the product were reached by
 * scrolling past somebody's photographs and the app had no settings entry
 * point at all.
 *
 * It is the same `AccountCard` the gated callers use rather than a second
 * copy, so signing in and out says the same thing wherever it is asked.
 */
function Settings({
  api,
  t,
  Button,
  onClose,
  onSignedIn,
  onSignedOut,
}: {
  api: Api;
  t: GroupTheme;
  Button: ButtonEl;
  onClose: () => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.panelScroll}>
            <Text style={[styles.panelTitle, { color: t.fg }]}>Settings</Text>

            <AccountCard
              api={api}
              t={t}
              Button={Button}
              onSignedIn={onSignedIn}
              onSignedOut={() => {
                onClose();
                onSignedOut();
              }}
            />

            <Button
              label="Safety, reporting and contact"
              t={t}
              onPress={() => void Linking.openURL('https://parea.photos/safety')}
            />
            <Button label="Done" t={t} onPress={onClose} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
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
  /* 72 rather than the design's 26: the mockup draws the status bar as a row
     of its own and measures from under it, and there is no safe-area library
     here — 72 is the allowance every screen in this project starts at. The
     bottom clears the floating tab bubble. */
  scroll: { paddingTop: 72, paddingHorizontal: 20, paddingBottom: 110, gap: 16 },
  /* Settings and `+`, in the two corners, above everything else. */
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /* The glyph's own box, so the two corners are the same height. */
  barMore: { fontSize: 22, fontWeight: '600', lineHeight: 24 },
  barPlus: { alignItems: 'center', justifyContent: 'center', width: 24, height: 24 },
  /* The words and the picture on one line, the words first. */
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  /* Clear of the bar above it. With the scroll's own 16 that is 36 between the
     corner glyphs and the name, which is what stops a 28pt name reading as a
     title bar. */
  headLower: { marginTop: 20 },
  /* Enough room that replacing the spinner with the profile does not yank the
     scroll position; roughly where the name and the avatar will land. */
  waiting: { paddingVertical: 64 },
  who: { flex: 1, minWidth: 0 },
  name: { fontSize: 28, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  handle: { fontSize: 14.5, marginTop: 3 },
  /* One line at the handle's size and in the handle's colour: three figures
     set larger than the name they belong to is a dashboard. */
  counts: { fontSize: 14.5, marginTop: 8 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarBlank: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 25, fontWeight: '700' },
  bio: { fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '600' },
  /* Two across with gutters: these are cards of separate evenings, not one
     object the way a wall of photographs would be. */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#8881' },
  tileEmpty: { borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  /* Under the picture rather than over it. A scrim block across the bottom of
     every tile makes a shelf read as captioned stock photography, and there is
     room here for the date as well — which is how somebody tells two dinners
     with the same six people apart. */
  tileName: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  tileMeta: { fontSize: 12.5 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: { maxHeight: '90%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  panelScroll: { padding: 16, paddingBottom: 40, gap: 12 },
  panelTitle: { fontSize: 22, fontWeight: '700' },
  /* One of the `+`'s two lines: what it is, and what it is for. */
  choice: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 4 },
  choiceName: { fontSize: 16, fontWeight: '600' },
  choiceWhy: { fontSize: 13.5, lineHeight: 19 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 15, fontSize: 16 },
  inputTall: { minHeight: 84, textAlignVertical: 'top' },
  hint: { fontSize: 12.5, lineHeight: 18 },
});
