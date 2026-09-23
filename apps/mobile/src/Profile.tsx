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
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
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
import { PageHead } from './PageHead';
import { More, RoundButton } from './RoundButton';
import { StartSomething } from './StartSomething';
import { BELOW_TABS } from './chrome';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { uploadCover } from './platform';
import { Waiting } from './Waiting';

/**
 * The tab, in two parts, and the split is the point.
 *
 * `CAP_H` is the strip at the top that holds no picture. The Dynamic Island
 * and the camera sit in it, and a photograph drawn under them is a photograph
 * with a hole punched through the face — which on a profile is the one place
 * it cannot be allowed to happen. So the container still hangs from the
 * physical top edge, and the picture starts below this.
 *
 * It has been 54 and then 72, and both were the no-go zone and nothing more:
 * 54 is the island, 72 is the allowance every scroll in this project starts
 * at. Both left a picture whose top edge is exactly where the obstruction
 * ends, which reads as having only just got out of the way.
 *
 * 100 is not about the camera. It is how much photograph there is behind the
 * ribbon — the picture starts at the top of the tab, so the ribbon's height
 * *is* the overlap, and a hundred points of it is what makes the image look
 * like it continues up into the ribbon rather than beginning under it. Past
 * about 120 the ribbon stops being a ribbon and becomes a header.
 */
const TAB_W = 172;
const CAP_H = 100;
/**
 * How much of the picture is in front of the ribbon.
 *
 * The picture is not this tall — it is the whole tab, `CAP_H` included, and
 * the ribbon is drawn over the top of it. This is only the part anybody sees.
 *
 * Taller than it is wide, because the thing in a profile picture is a person
 * standing up. The panel was 172 × 140 and a portrait crop into a landscape
 * box loses the sides of somebody — their arms, the edges of a coat, the
 * shape that makes them recognisable at this size.
 */
const VISIBLE_H = 168;
const TAB_H = CAP_H + VISIBLE_H;
/** What is left of the picture once the page has been scrolled. */
const PHOTO_MIN = 26;

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
  /**
   * How far the page has been scrolled, and the tab's arrival.
   *
   * Two values because they cannot share a driver. The retract is width and
   * height, which are layout and therefore JS-driven; the drop is a
   * transform, which is not. Put on one view they would fight — React Native
   * refuses a JS animation on a node it has moved to the native side — so
   * they sit on two, one nested in the other.
   */
  const scrollY = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(0)).current;

  /*
   * Once, when the account first arrives.
   *
   * Not on every return to the tab: `active` flips whenever somebody comes
   * back, and a screen that replays its entrance every time is one that never
   * settles. `dropped` is the latch.
   */
  const dropped = useRef(false);
  useEffect(() => {
    if (account === undefined || dropped.current) return;
    dropped.current = true;
    Animated.spring(drop, {
      toValue: 1,
      damping: 14,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
  }, [account, drop]);

  /*
   * The tab retracts as the page moves under it.
   *
   * 170 points of scroll takes it from 172 × 200 to 116 × 76 and then stops.
   * It keeps the top edge and the bottom corners; what changes is how much of
   * it there is, which is what makes it read as being pulled back up rather
   * than scrolling away.
   */
  const k = scrollY.interpolate({
    inputRange: [0, 170],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  /**
   * What the tab is made of, behind the picture.
   *
   * One value used twice, which is the point: the cap and the panel are two
   * views, and a tab that is two colours is two objects. Whatever sits behind
   * the photograph is what the strip above it is — the lens for somebody with
   * no picture, and the line colour for somebody whose picture has not
   * decoded yet.
   */
  const tabBack = account?.avatarUrl ? t.line : lens.fill;

  const tabWidth = k.interpolate({ inputRange: [0, 1], outputRange: [TAB_W, TAB_W - 56] });
  /*
   * The cap does not retract; only the picture under it does.
   *
   * It is the unsafe zone, and the unsafe zone is the same height however far
   * the page has been scrolled. Shrinking the whole tab would walk the
   * photograph back up under the camera on the way past.
   */
  const tabHeight = k.interpolate({
    inputRange: [0, 1],
    outputRange: [TAB_H, CAP_H + PHOTO_MIN],
  });

  const shareProfile = useCallback(() => {
    if (!account?.handle) return;
    void Share.share({ message: `${webBase}/u/${account.handle}` });
  }, [account?.handle, webBase]);

  return (
    /*
      `keyboardShouldPersistTaps`, because signed out this scroller *is* the
      sign-in form.

      The default is `never`: while a field is focused the first tap anywhere
      else is spent dismissing the keyboard and the child never sees it. The
      code step opens the number pad, which has no return key to put the
      keyboard away with, so "Sign in" was the only thing to press and the
      press went nowhere. See the same note in `App.tsx` and on the panel
      below — all three hold the same card.
    */
    <View style={styles.screen}>
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      // Drives the retract above. 16ms is one frame; less is work nobody sees.
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        // Layout, not transform — see the note on `scrollY`.
        useNativeDriver: false,
      })}
    >
      {/*
        The two things that are not about looking at this profile, in the two
        corners, with the product's name between them.

        The name is what the other three tabs open with, and this one used to
        open with two discs and a gap. Same row, same height, same place — see
        `PageHead`.

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
      <View style={[styles.head, styles.gutter]}>
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
                friends?.length
                  ? `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}, see them`
                  : undefined
              }
              style={friends?.length ? styles.countsLink : undefined}
            >
              {/*
                Singular, like the two counts beside it.
                *
                * This one said "1 friends" while the albums and the photographs
                * either side of it got their ternary — the third fact in a line
                * of three, written last and written differently. The em dash
                * stands in while the list is still arriving, and takes the
                * plural because it is not a number.
                */}
              {friends === null ? '—' : friends.length}{' '}
              {friends !== null && friends.length === 1 ? 'friend' : 'friends'}
            </Text>
          </Text>

          {/*
            The one link, under the counts and above the bio.

            Here rather than under the bio because it belongs with the facts:
            the line above it is what this person has, and an address is the
            same kind of thing. Under the bio it would read as a footnote to
            the sentence rather than as part of the header.

            Shown without its scheme. `https://` in front of a domain is four
            characters of protocol on a screen about a person, and the stored
            value keeps it so that opening needs no guessing — the server
            refuses anything that is not http or https, which is what makes
            this safe to hand straight to the browser.
          */}
          {account?.link && (
            <Text
              onPress={() => void Linking.openURL(account.link!)}
              suppressHighlighting
              accessibilityRole="link"
              accessibilityLabel={`${account.link.replace(/^https?:\/\//, '')}, opens in your browser`}
              numberOfLines={1}
              style={[styles.link, { color: t.accent }]}
            >
              {account.link.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </Text>
          )}
        </View>

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
                /*
                 * The same ink border as `Edit profile`, and no fill.
                 *
                 * It was a hairline over `card`, which at a glance is not a
                 * button at all — a filled rectangle beside an outlined one
                 * reads as the row's disabled half rather than as its second
                 * control. They are two halves of one row and neither is the
                 * screen's primary action, so they take the same outline.
                 */
                borderColor: t.fg,
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
      {/*
        The shelf before there is anything on it.

        The space under the buttons was simply blank, which on the one tab that
        is *yours* reads as a page that failed to load rather than as a shelf
        waiting to be filled. A sentence and the one control that answers it.

        The `+` is the same glyph and the same round button as the one in the
        corner, because it does the same thing — this is the corner's action
        brought down to where somebody is looking when they find out there is
        nothing here. Both go once there is a first album: a prompt to make
        your first one, standing over a shelf that already has one, is a
        prompt nobody needs twice.
      */}
      {account && events.length === 0 && (
        <View style={[styles.noAlbums, styles.gutter]}>
          <Text style={[styles.noAlbumsText, { color: t.dim }]}>
            No Albums Yet. Create One Now.
          </Text>
          <RoundButton t={t} onPress={onCreateEvent} accessibilityLabel="Create an album">
            <Glyph name="plus" size={20} color={t.fg} />
          </RoundButton>
        </View>
      )}

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
              <ScrollView contentContainerStyle={styles.panelScroll} keyboardShouldPersistTaps="handled">
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

      {/*
        The tab, hanging from the top edge.

        Outside the scroll view and above it, because it does not scroll — it
        retracts. The page passes underneath, which is what makes it read as
        fixed to the screen rather than as the first row of the content.

        Two views, one inside the other, and the nesting is not arrangement.
        The outer one is width and height, which are layout and therefore
        JS-driven by the scroll; the inner one is the entrance, which is a
        transform and runs natively. On one view React Native refuses the pair
        outright.

        Only once the account is there: an empty tab dropping in before there
        is anything to put in it is the page arriving twice.
      */}
      {account !== undefined && (
        <Animated.View
          style={[styles.tab, { width: tabWidth, height: tabHeight, shadowColor: t.fg }]}
        >
          <Animated.View
            style={[
              styles.tabFill,
              {
                transform: [
                  {
                    translateY: drop.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-TAB_H * 1.05, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/*
              The picture fills the whole tab, the cap included.

              It was a panel *under* a strip, and that is what you could see:
              ribbon, seam, photograph. Three things stacked rather than one.
              Now the picture runs the full height and the ribbon is painted
              over the top of it, so the image has no visible top edge at all
              — it carries on upward behind the ribbon and is hidden there.
              Masking rather than framing, which is the difference between a
              picture tucked into the bookmark and a tile pasted under a bar.

              No top corners on the image for the same reason: a rounded
              corner is a frame announcing itself, and the only shape anybody
              should be able to see is the bottom of the bookmark.
            */}
            <Pressable
              onPress={() => setEditing(true)}
              accessibilityRole="button"
              accessibilityLabel="Change your profile picture"
              style={[styles.tabFill, { backgroundColor: tabBack }]}
            >
              {account?.avatarUrl ? (
                <Image
                  source={{ uri: account.avatarUrl }}
                  style={styles.tabFill}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={[styles.tabFill, styles.tabBlank]}>
                  <Text style={[styles.avatarLetter, { color: lens.ink }]}>{initial}</Text>
                </View>
              )}
            </Pressable>

            {/*
              The ribbon, over the picture rather than above it.

              Opaque, and the height of the no-go zone: the camera sits in it
              and the top of the photograph is behind it.
            */}
            <View style={[styles.cap, { backgroundColor: tabBack }]} pointerEvents="none" />

            {/*
              And a short fade under it, so the join is not a line.

              Twenty-four points from the ribbon's own colour to nothing. Not
              a gradient anybody should notice — just enough that the picture
              seems to come out from under the ribbon rather than to begin
              immediately below it.
            */}
            <LinearGradient
              colors={[tabBack, 'transparent']}
              style={styles.capFade}
              pointerEvents="none"
            />
          </Animated.View>
        </Animated.View>
      )}

      {/*
        The two corners, fixed above everything.

        They were the ends of a `PageHead` row, which this screen no longer
        draws — the tab is what the top of the profile is now, and a wordmark
        over it would be a second thing claiming the same space. The discs
        stay, because what they open has not changed.
      */}
      <View style={styles.corner}>
        <RoundButton t={t} onPress={() => setSettings(true)} accessibilityLabel="Settings">
          <More color={t.fg} />
        </RoundButton>
      </View>
      <View style={[styles.corner, styles.cornerRight]}>
        <RoundButton t={t} onPress={() => setCreating(true)} accessibilityLabel="New album or group">
          <Glyph name="plus" size={20} color={t.fg} />
        </RoundButton>
      </View>
    </View>
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
      {/*
        A sheet sits on the bottom edge, and on iOS a transparent modal does
        not move for the keyboard — so the sign-in card's button was under it,
        on a panel whose whole reason for being here is that button. iOS is
        told to pad; Android resizes the window itself and padding on top of
        that lifts the sheet into the middle of the screen.
      */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
            <ScrollView contentContainerStyle={styles.panelScroll} keyboardShouldPersistTaps="handled">
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
      </KeyboardAvoidingView>
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
  /*
   * Shown without its scheme, and sent back as typed.
   *
   * The stored value carries `https://` so that opening it needs no guessing.
   * Putting that in the field would mean somebody editing around it, and the
   * server adds it again anyway — so the field holds what a person would say
   * out loud, and `account/route.ts` is the only thing that decides what a
   * link is.
   */
  const [link, setLink] = useState((account.link ?? '').replace(/^https?:\/\//, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    const patch: {
      displayName?: string;
      handle?: string;
      bio?: string;
      link?: string;
    } = {};
    if (name.trim() !== (account.displayName ?? '')) patch.displayName = name.trim();
    if (handle.trim() !== (account.handle ?? '')) patch.handle = handle.trim();
    if (bio.trim() !== (account.bio ?? '')) patch.bio = bio.trim();
    // Compared scheme-stripped on both sides, so that opening the sheet and
    // saving without touching this field is not an edit.
    if (link.trim() !== (account.link ?? '').replace(/^https?:\/\//, '')) {
      patch.link = link.trim();
    }
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
  }, [account, api, bio, handle, link, name, onDone]);

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
      /*
       * Taller than the frame it lands in, on purpose.
       *
       * The tab is 172 by 268, which is about 9:15. Asking for 9:16 hands
       * `cover` a source with height to spare — so it fits the width and
       * trims a little off the top and bottom instead, and every pixel of the
       * left and right survives. A crop that matched the frame exactly was
       * still tight at the sides; a landscape one before it was eating arms
       * and the edges of a coat, which is most of what makes somebody
       * recognisable at this size.
       *
       * The top of what somebody frames goes behind the ribbon — a hundred
       * points of it — which in almost every portrait anybody takes is the
       * space above their head.
       */
      aspect: [9, 16],
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

      <Text style={[styles.fieldLabel, { color: t.dim }]}>LINK</Text>
      <TextInput
        value={link}
        onChangeText={setLink}
        placeholder="yoursite.com (optional)"
        placeholderTextColor={t.dim}
        maxLength={200}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: t.fg, borderColor: t.line }]}
        accessibilityLabel="A link shown on your profile"
      />
      <Text style={[styles.hint, { color: t.dim }]}>
        One address, shown under your name. Leave off the https — it is added
        for you.
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
  /* `BELOW_TABS`, not a number chosen by eye. This screen ends in a wall of
     album covers with nothing after it, so whatever it reserves is the only
     thing standing between the last row and the floating bar. */
  /* The screen, so the tab and the corners have something to be absolute
     inside. */
  screen: { flex: 1 },
  /*
   * 222 rather than 72: the tab's 200 and 22 of clearance under it.
   *
   * The content starts below the tab rather than behind it, because the tab
   * is opaque and the first thing under it is somebody's name.
   */
  scroll: { paddingTop: TAB_H + 22, paddingBottom: BELOW_TABS, gap: 16, flexGrow: 1 },
  /*
   * The tab: flush to the physical top, centred, square above and round below.
   *
   * `left: '50%'` with a negative margin of half its width rather than
   * `alignSelf`, because the width is animated and a centring that depends on
   * it would re-measure on every frame of the retract. The margin is half the
   * resting width, and the tab narrows symmetrically about it.
   */
  tab: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -TAB_W / 2,
    zIndex: 2,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  tabFill: { width: '100%', height: '100%' },
  /*
   * The ribbon, laid over the top of the picture.
   *
   * Absolute rather than a first child, because the picture is the full
   * height of the tab and this covers part of it. Fixed height, because the
   * camera does not move.
   */
  cap: { position: 'absolute', top: 0, left: 0, right: 0, height: CAP_H, zIndex: 1 },
  /* The join, softened. Sits directly under the ribbon. */
  capFade: { position: 'absolute', top: CAP_H, left: 0, right: 0, height: 24, zIndex: 1 },
  /*
   * The picture, under the cap and rounded away from it.
   *
   * `flex: 1` so the retract takes it out of the picture rather than out of
   * the cap — the tab shrinks by shrinking this. The top corners are what
   * make the cap read as a ribbon behind a panel rather than as dead space
   * above a photograph.
   */

  tabBlank: { alignItems: 'center', justifyContent: 'center' },
  /* Above the tab, and fixed: these do not scroll and are not part of it. */
  corner: { position: 'absolute', top: 62, left: 20, zIndex: 3 },
  cornerRight: { left: undefined, right: 20 },
  /* What every row keeps, and the header's picture is the only thing exempt
     from. Named rather than repeated, so "the gutter" stays one number. */
  gutter: { paddingHorizontal: 20 },
  /* Settings and `+`, in the two corners, above everything else. */
  /*
   * The words and the picture on one line, the words first.
   *
   * `paddingLeft` only, and no `justifyContent`: the picture is pushed right by
   * `who` taking the space rather than by the row spreading its children, which
   * is what lets it end flush against the screen's edge instead of 20 points
   * short of it.
   */
  /*
   * A centred column, not a row with a picture on the end.
   *
   * The picture hangs above it now, so everything under the tab reads down
   * the middle of the screen — and the text is centred with it rather than
   * ranged left against nothing.
   */
  head: { alignItems: 'center' },
  who: { alignSelf: 'stretch', alignItems: 'center' },
  name: { textAlign: 'center', fontSize: 28, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  handle: { textAlign: 'center', fontSize: 14.5, marginTop: 3 },
  /* One line at the handle's size and in the handle's colour: three figures
     set larger than the name they belong to is a dashboard. */
  counts: { textAlign: 'center', fontSize: 14.5, marginTop: 8 },
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
    /*
     * A rounded corner, not a semicircle.
     *
     * It was 52 — half the height — which makes the left edge a perfect arc and
     * the whole thing a capsule cut in half. That reads as a badge or a pill,
     * which is a shape for a label rather than for a photograph; at this size
     * it also eats a visible bite out of whatever is on the left of the
     * picture, which on a portrait is usually a shoulder.
     *
     * 26 is half of that: enough to be obviously rounded and to agree with the
     * other soft corners on this screen, and not so much that the frame becomes
     * the subject.
     */
    borderTopLeftRadius: 26,
    borderBottomLeftRadius: 26,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  /*
   * The letter takes the photograph's shape, bleed and all.
   *
   * It kept a 64pt circle in the gutter, on the argument that a flat colour
   * has nothing to continue past the cut and so reads as a field of colour
   * rather than a face. That is true of the colour and false of the frame:
   * what the bleed is actually doing here is telling you what kind of thing
   * sits in this corner, and a disc in a margin beside a picture that runs off
   * the edge reads as a different screen rather than as the same one waiting
   * for a photograph. Somebody with no picture yet should see the shape their
   * picture will take.
   *
   * Same 124 × 104 and the same two radii as `avatar`, so the two are one
   * outline with different contents — and no `marginRight`, which is what lets
   * it reach the edge.
   */
  avatarBlank: {
    width: 124,
    height: 104,
    borderTopLeftRadius: 26,
    borderBottomLeftRadius: 26,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Up from 25 with the box it sits in: a letter sized for a 64pt disc is
     lost in a frame twice the area. */
  avatarLetter: { fontSize: 38, fontWeight: '700' },
  /*
   * Pulled up against the header above it.
   *
   * The scroll lays its children out with `gap: 16`, and the header row's
   * height is set by the 104pt picture rather than by the text beside it — so
   * the measured space between the last line of text and the bio is the gap
   * *plus* whatever the text column falls short by, which looked like the bio
   * had been left behind by the name it belongs to.
   *
   * Half the gap back, rather than all of it: the bio is still a separate
   * thought from the line of counts above it, and the link now usually sits
   * between them.
   */
  /*
   * Centred, inset, and no negative margin.
   *
   * The -8 pulled it against a header whose height was set by a 104pt picture
   * beside the text. There is no picture beside the text any more, so the
   * pull is against nothing. The inset keeps a long bio to a readable measure
   * once it is centred — full width and centred is a paragraph with ragged
   * edges on both sides.
   */
  bio: { fontSize: 15, lineHeight: 21, textAlign: 'center', paddingHorizontal: 36 },
  /* The same size and rhythm as the counts line it follows, in the accent —
     this is the one thing in the header that goes somewhere. */
  link: { textAlign: 'center', fontSize: 14.5, marginTop: 6 },
  /* Centred, and given room: this is the only thing on the lower half of the
     page, so it is placed rather than left at the top of an empty run. */
  noAlbums: { alignItems: 'center', gap: 14, paddingTop: 24 },
  noAlbumsText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
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
  /* The keyboard avoider around a sheet: full height, no colour of its own. */
  fill: { flex: 1 },
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
