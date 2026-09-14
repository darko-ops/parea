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

import type { Account, Api, EventListing, InvitablePerson } from './api';
import { ApiError } from './api';
import { AccountCard } from './Events';
import { Glyph } from './Glyph';
import { More, RoundButton } from './RoundButton';
import { StartSomething } from './StartSomething';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { uploadCover } from './platform';
import { Waiting } from './Waiting';

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
  active,
  onOpen,
  onOpenPerson,
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
  /**
   * Whether this tab is the one in front.
   *
   * The tabs are kept alive now rather than unmounted, so without this the
   * screen would fetch once and then show that answer for as long as the app
   * stayed open. Coming back to it re-reads quietly: `load` never clears what
   * it has first, so the old profile stays on screen until the new one arrives
   * and there is no spinner on a revisit.
   */
  active: boolean;
  onOpen: (event: EventListing) => void;
  /** A friend's own profile, reached by handle — the same route Find uses. */
  onOpenPerson: (handle: string) => void;
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
  /*
   * The friends themselves, not only how many.
   *
   * `/api/friends` has always answered with the people — the screen was
   * throwing all but the length away. Keeping them is what lets the count be
   * something to press rather than a statistic, and costs no extra request.
   *
   * Null while the answer has not come back, which is the difference between
   * "none" and "not yet": "0 friends" is a claim, and the wrong one to make
   * about somebody whose request is still in flight.
   */
  const [friends, setFriends] = useState<InvitablePerson[] | null>(null);
  /** The list, as a sheet over the profile. */
  const [showFriends, setShowFriends] = useState(false);
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
      api.friends().catch(() => null),
    ]);
    setAccount(account);
    setFriends(friends);
  }, [api]);

  // On arrival, and on every return to the tab. Not on the switches away.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

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
      <View style={[styles.bar, styles.gutter]}>
        <RoundButton t={t} onPress={() => setSettings(true)} accessibilityLabel="Settings">
          <More color={t.fg} />
        </RoundButton>

        <RoundButton
          t={t}
          onPress={() => setCreating(true)}
          accessibilityLabel="New album or group"
        >
          <Glyph name="plus" size={20} color={t.fg} />
        </RoundButton>
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
        <Waiting fill />
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
          {/*
            The friends half is a button; the other two are not.

            Albums and photographs are already reachable — the shelf below is
            the albums, and a photograph lives in one of them. A friend was the
            one thing this line counted that the app could not then show you, so
            that is the half that became a control. Underlined rather than
            coloured: an accent word in the middle of a grey line reads as a
            link in prose, and this is a line of facts.
          */}
          <Text style={[styles.counts, { color: t.dim }]}>
            {events.length} {events.length === 1 ? 'album' : 'albums'} · {photos}{' '}
            {photos === 1 ? 'photo' : 'photos'} ·{' '}
            <Text
              onPress={friends?.length ? () => setShowFriends(true) : undefined}
              suppressHighlighting
              accessibilityRole={friends?.length ? 'button' : undefined}
              accessibilityLabel={
                friends?.length ? `${friends.length} friends, see them` : undefined
              }
              style={friends?.length ? styles.countsLink : undefined}
            >
              {friends === null ? '—' : friends.length} friends
            </Text>
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
            <View style={[styles.avatarBlank, { backgroundColor: lens.fill }]}>
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
      {account?.bio && (
        <Text style={[styles.bio, styles.gutter, { color: t.fg }]}>{account.bio}</Text>
      )}
      {account === null && (
        <Text style={[styles.bio, styles.gutter, { color: t.dim }]}>
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
        <View style={[styles.actions, styles.gutter]}>
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
        <View style={styles.gutter}>
          <AccountCard api={api} t={t} Button={Button} onSignedIn={() => { void load(); onSignedIn(); }} />
        </View>
      )}

      {/*
        The shelf. Albums rather than photographs — see the note at the top —
        each leading with the cover its card leads with, named and dated under
        the picture rather than over it: a scrim block across the bottom of
        every tile is a grid that reads as captioned stock photography.
      */}
      {events.length > 0 && (
        <View style={[styles.grid, styles.gutter]}>
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
        Your friends, as a sheet over your own profile.

        A sheet rather than a route, because it is a list you came to from a
        number and will leave again immediately — pushing a screen for it would
        put a back arrow between somebody and the profile they were reading.
        Tapping one *is* a route, and closes this on the way.
      */}
      {showFriends && friends && (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={() => setShowFriends(false)}
        >
          <Pressable style={styles.backdrop} onPress={() => setShowFriends(false)}>
            <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
              <ScrollView contentContainerStyle={styles.panelScroll}>
                <Text style={[styles.panelTitle, { color: t.fg }]}>
                  {friends.length} {friends.length === 1 ? 'friend' : 'friends'}
                </Text>

                {friends.map((friend) => {
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
                        setShowFriends(false);
                        if (friend.handle) onOpenPerson(friend.handle);
                      }}
                      accessibilityRole={reachable ? 'button' : undefined}
                      accessibilityLabel={
                        reachable
                          ? `${friend.displayName ?? friend.handle}, open their profile`
                          : undefined
                      }
                      style={({ pressed }) => [
                        styles.friendRow,
                        { borderBottomColor: t.line, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      {friend.avatar ? (
                        <Image
                          source={{ uri: friend.avatar }}
                          style={[styles.friendFace, { backgroundColor: t.line }]}
                          contentFit="cover"
                          transition={120}
                        />
                      ) : (
                        <View style={[styles.friendFace, styles.friendBlank, { backgroundColor: lens.fill }]}>
                          <Text style={[styles.friendLetter, { color: lens.ink }]}>
                            {initialOf(friend.displayName ?? friend.handle)}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.friendName, { color: t.fg }]} numberOfLines={1}>
                          {friend.displayName?.trim() || friend.handle || 'Someone'}
                        </Text>
                        {friend.displayName && friend.handle && (
                          <Text style={[styles.friendHandle, { color: t.dim }]} numberOfLines={1}>
                            {friend.handle}
                          </Text>
                        )}
                      </View>
                      {reachable && <Text style={[styles.friendGo, { color: t.dim }]}>›</Text>}
                    </Pressable>
                  );
                })}

                <Button label="Close" t={t} onPress={() => setShowFriends(false)} />
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {creating && (
        <StartSomething
          t={t}
          Button={Button}
          onClose={() => setCreating(false)}
          onAlbum={onCreateEvent}
          onGroup={onCreateGroup}
        />
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
      /*
       * 6:5, because the header draws it in a 124 × 104 box.
       *
       * This was square, on the argument that the avatar is a circle
       * everywhere else in the product — the faces over a cover, the tiles in
       * Lately, the rows in a thread — so a landscape file would be cropped
       * again by every one of them. That is true and it is the smaller loss: a
       * circle takes the middle of a 6:5 frame, which for a face is the face,
       * where a square centre-cropped into a landscape box loses the top and
       * bottom of what somebody framed — usually the top of their head, at the
       * one size where it is unmistakable.
       *
       * So the crop is chosen for the largest place it is drawn, and the small
       * round ones give up a little width. The endpoint re-encodes whatever
       * arrives, so nothing downstream changes.
       */
      aspect: [6, 5],
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
  /* `flexGrow` so that a short page — which, while it is loading, is the bar
     and a spinner — still fills the screen, and the spinner has a height to
     centre itself in. Inert once there is enough content to scroll. */
  /*
   * The gutter is on the children now, not here.
   *
   * One row on this screen is allowed to reach the edge — the header, whose
   * picture runs off it — and a container that insets everything cannot make an
   * exception for one child. So `paddingHorizontal` moved down, and `gutter`
   * below is the one value they all use.
   */
  scroll: { paddingTop: 72, paddingBottom: 110, gap: 16, flexGrow: 1 },
  /* What every row keeps, and the header's picture is the only thing exempt
     from. Named rather than repeated, so "the gutter" stays one number. */
  gutter: { paddingHorizontal: 20 },
  /* Settings and `+`, in the two corners, above everything else. */
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /*
   * The words and the picture on one line, the words first.
   *
   * `paddingLeft` only, and no `justifyContent`: the picture is pushed right by
   * `who` taking the space rather than by the row spreading its children, which
   * is what lets it end flush against the screen's edge instead of 20 points
   * short of it.
   */
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, gap: 14 },
  /* Clear of the bar above it. With the scroll's own 16 that is 36 between the
     corner glyphs and the name, which is what stops a 28pt name reading as a
     title bar. */
  headLower: { marginTop: 20 },
  who: { flex: 1, minWidth: 0 },
  name: { fontSize: 28, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  handle: { fontSize: 14.5, marginTop: 3 },
  /* One line at the handle's size and in the handle's colour: three figures
     set larger than the name they belong to is a dashboard. */
  counts: { fontSize: 14.5, marginTop: 8 },
  /* Underlined rather than accented: an accent word inside a grey line reads as
     a link in prose, and this is a line of facts. */
  countsLink: { textDecorationLine: 'underline' },
  /* One friend. A rule between rows and none under the last, which is the same
     shape the event chats use. */
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  friendFace: { width: 38, height: 38, borderRadius: 19 },
  friendBlank: { alignItems: 'center', justifyContent: 'center' },
  friendLetter: { fontSize: 15, fontWeight: '700' },
  friendName: { fontSize: 15.5, fontWeight: '600' },
  friendHandle: { fontSize: 13 },
  friendGo: { fontSize: 20 },
  /*
   * A photograph, bled to the edge, at the height of the words beside it.
   *
   * 124 × 104, with the left cap rounded to half its height and the right side
   * square where the screen cuts it off. At 64 a face is a thumbnail; 104 is
   * about the smallest a photograph of a person is legible at on this screen,
   * and taking the gutter back is what buys that height without pushing the bio
   * and the grid down.
   *
   * The height is not arbitrary either — the three lines beside it come to
   * roughly 104 (a 31pt name, a handle at 17 over 3, the counts at 17 over 8),
   * so the two sides square off against each other rather than the picture
   * floating beside the first line. `alignItems: 'center'` on the row is the
   * other half of that.
   */
  avatar: {
    width: 124,
    height: 104,
    borderTopLeftRadius: 52,
    borderBottomLeftRadius: 52,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  /*
   * The letter keeps the gutter, and keeps its circle.
   *
   * A flat lens colour running off the edge is a field of colour, not a face —
   * the bleed works because a photograph continues past the cut, and a solid
   * fill has nothing to continue.
   */
  avatarBlank: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7 },
  input: { borderWidth: 1, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 15, fontSize: 16 },
  inputTall: { minHeight: 84, textAlignVertical: 'top' },
  hint: { fontSize: 12.5, lineHeight: 18 },
});
