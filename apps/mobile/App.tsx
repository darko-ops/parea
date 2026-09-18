/**
 * Parea — the native client.
 *
 * Three screens, matching design §3's four minus auto-selection, which is
 * deliberately absent: it is the one piece whose design depends on the geotag
 * coverage measurement that has not been run. Everything here works without
 * it, and the screen it will land on is the picker.
 *
 * What native buys today, over the web client:
 *   - uploads that survive backgrounding and termination (iOS);
 *   - a queue that survives the app being killed;
 *   - "save everything to my camera roll", which is the terminal action people
 *     actually want and a browser cannot offer;
 *   - QR and spoken codes as ways in.
 */

import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  InputAccessoryView,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';

import { resolveWindow, type Window } from '@parea/autoselect';
import { CARD_FACES, dateLabel, shortDate } from '@parea/cards';

import {
  Api,
  ApiError,
  tokenFromInput,
  type ClusterPerson,
  type ContributePolicy,
  type EventListing,
  type Feed,
  type FeedPhoto,
  type Member,
  type MyGroupDetail,
} from './src/api';
import { Glyph, type GlyphName } from './src/Glyph';
import { initialOf, lensFor } from './src/lens';
import { People, Thread } from './src/Thread';
import { AccountCard, ChatsTab, HomeTab, SearchTab } from './src/Events';
import { ContributeChoice } from './src/ContributeChoice';
import { CoverFramer, type CoverFraming } from './src/CoverFramer';
import { CreateEvent } from './src/CreateEvent';
import { DoorScreen } from './src/Door';
import { GroupScreen, GroupSearch } from './src/Groups';
import { GroupThread } from './src/GroupThread';
import { InviteCard } from './src/InvitePeople';
import { PersonScreen } from './src/Person';
import { CoverGlass } from './src/CoverGlass';
import { Lately } from './src/Lately';
import { NewGroup } from './src/NewGroup';
import { PickPhotos } from './src/PickPhotos';
import { Back, More, RoundButton } from './src/RoundButton';
import { PhotoViewer } from './src/PhotoViewer';
import { SwipeBack } from './src/SwipeBack';
import { ProfileScreen } from './src/Profile';
import { arrivalFromUrl } from './src/links';
import { notificationTarget } from './src/notifications';
import { AutoSelect } from './src/AutoSelect';
import { Waiting } from './src/Waiting';
import {
  libraryAccess,
  requestLibraryAccess,
  resolveForUpload,
  type LibraryAccess,
  type LibraryPhoto,
} from './src/library';
import { Platform as RNPlatform } from 'react-native';

import {
  BACKGROUND_UPLOAD_SUPPORTED,
  loadActorToken,
  pushAlreadyAsked,
  fetchForCover,
  registerForPush,
  launchNotification,
  loadEvents,
  loadQueue,
  onNotificationTapped,
  rememberEvent,
  saveActorToken,
  saveQueue,
  saveToCameraRoll,
  uploadCover,
  uploadItem,
  type SavedEvent,
} from './src/platform';
import { Offline, UploadQueue } from '@parea/upload';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type MyGroup = { id: string; name: string; role: 'member' | 'admin' };

/**
 * Where the app is. Three destinations and no history stack — every screen
 * here is one step from home, and a navigation library would be more moving
 * parts than the product has screens.
 */
/**
 * Four tabs, and the screens that open on top of them.
 *
 * The tabs are where someone lives — events, the rooms they are in, finding
 * things, themselves — and everything else is pushed over the top and
 * dismissed back to whichever tab they came from. No history stack and no
 * navigation library: there are a handful of destinations in this product and
 * a library would be more moving parts than screens.
 *
 * Groups is between Events and Find, in the order those are true in: Events is
 * what has already happened, Groups is the rooms you are already in, and Find
 * is the only tab that goes looking for something you are not part of yet. It
 * was a card inside You, under the name field — which put the thing the
 * product treats as persistent identity in a drawer with the settings.
 */
type Tab = 'home' | 'chats' | 'search' | 'profile';

/**
 * Which pane of an event is up — its photographs, its conversation, or who is
 * in it. Three panes of one screen rather than three screens: they are all
 * about the same evening, and pushing the thread as its own route would give
 * the conversation a back button to the album it is already inside.
 */
type Pane = 'photos' | 'talk' | 'people';

/** Tiles per row in the album's grid. Three is the contact-sheet convention. */
const GRID_COLUMNS = 3;
/**
 * The hairline between photographs, in both views.
 *
 * One number because the two views are the same photographs: a gap that
 * differed between them would read as the swipe having changed the spacing
 * rather than the layout. It is also what `getItemLayout` has to add to a row's
 * height, so the two must agree by construction rather than by eye.
 */
const PHOTO_GAP = 3;

type Route =
  | { screen: 'tabs' }
  | { screen: 'join' }
  | {
      screen: 'event';
      event: SavedEvent;
      /**
       * Which pane to land on. Absent means the photographs, which is what a
       * link must always open on — only an in-app row that *is* a conversation
       * asks for anything else.
       */
      pane?: Pane;
      /**
       * Which photograph to open on top of the grid, if any.
       *
       * Set by the strip of thumbnails under a card on the home screen: a tile
       * there is a picture of one photograph, and pressing it should arrive at
       * that photograph rather than at the grid it is somewhere inside.
       *
       * Not set by a link, ever. The photograph is named by its id, and an id
       * in a URL is a thing to guess at; the album screen looks it up in the
       * feed it fetches, so a value that names nothing simply opens the grid.
       */
      photo?: string;
      /**
       * Library ids to upload on arrival.
       *
       * Set only by the create flow. The album used to be handed a *window* and
       * left to re-scan the library for it, which offered everything from those
       * hours rather than the photographs somebody actually chose — close
       * enough when the window came from a phrase, wrong now that it comes from
       * a selection.
       */
      upload?: string[];
    }
  /**
   * The door of a private album — a real link to one that has not let this
   * person in. A screen rather than an error string on the join screen,
   * because a deep link can arrive from anywhere: the app may be sitting
   * inside another event or not running at all, and there would be no join
   * screen to put the message on.
   */
  | { screen: 'door'; eventId: string; name: string }
  | { screen: 'group'; id: string }
  /**
   * A group's conversation, which is not the group.
   *
   * Carries the summary the Groups tab already holds rather than an id: the
   * header wants a name, a member count and a lens the moment it draws, and
   * re-fetching all three to render a title bar is a spinner where a name
   * should be.
   */
  | {
      screen: 'groupThread';
      /*
       * What the bar needs, which both ways in already have: the Groups tab
       * holds a `MyGroupDetail` and the group's own page holds a `GroupRoom`,
       * and each satisfies this without inventing the other's fields.
       */
      group: { id: string; name: string; memberCount: number; eventCount: number };
    }
  | { screen: 'person'; handle: string }
  /**
   * Lately, pushed over the tabs from the envelope in the Groups heading.
   *
   * A screen rather than a tab: three tabs is the whole of this app's
   * navigation and a fourth carrying a list that is usually empty would cost a
   * permanent quarter of the tab bar. See `Lately.tsx`.
   */
  | { screen: 'lately' }
  /**
   * Making a group, on its own page.
   *
   * It was a card that unfolded inside the Groups tab, pushing the rooms down
   * and leaving a form the width of a list item under a keyboard. The people it
   * may arrive holding come from a cluster — see `NewGroup.tsx`.
   */
  | { screen: 'newGroup'; people?: ClusterPerson[]; suggestedName?: string }
  /**
   * Making an album, in two steps.
   *
   * `pick` is the photographs — the screen that shows them, because choosing
   * what an album *is* should come before naming it. `create` is the form, and
   * it carries what was chosen: the window they cover, the first one as the
   * cover, and the set to upload once the album exists.
   */
  | { screen: 'pick'; groupId?: string; groupName?: string }
  | {
      screen: 'create';
      groupId?: string;
      groupName?: string;
      chosen: LibraryPhoto[];
    };

/**
 * The three screens of making an album.
 *
 * One predicate rather than the same disjunction written at each of its three
 * call sites — the account gate, the way out, and the re-check on the way in.
 * A fourth step added to the flow and missed at one of them is a screen with no
 * gate or no arrow, which is exactly how the first two steps came to disagree.
 */
function making(route: Route): route is Extract<Route, { screen: 'pick' | 'create' }> {
  return route.screen === 'pick' || route.screen === 'create';
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  const t = useMemo(() => theme(dark), [dark]);
  const api = useMemo(
    () => new Api(API_BASE, null, RNPlatform.OS === 'android' ? 'android' : 'ios'),
    [],
  );

  const [ready, setReady] = useState(false);
  const [remembered, setRemembered] = useState<SavedEvent[]>([]);
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [route, setRoute] = useState<Route>({ screen: 'tabs' });
  const [tab, setTab] = useState<Tab>('home');
  /*
   * Which tabs have been opened, and therefore still exist.
   *
   * Each tab used to be `{tab === 'profile' && <ProfileScreen …>}`, which
   * unmounts it the moment somebody looks at something else — so every switch
   * back threw away what it had fetched, asked for it again and sat on a
   * spinner while it waited. It also lost the scroll position, which is the
   * part nobody reports and everybody notices.
   *
   * Mounted on first visit and kept from then on. Lazily, rather than all four
   * at launch: a cold start would otherwise fire four tabs' worth of requests
   * to draw one of them.
   */
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set(['home']));
  /**
   * Which account the tabs belong to, as a number nobody reads.
   *
   * The tabs are kept mounted so that switching between them is instant, and
   * each one holds what it fetched: the Groups tab has its own list of groups
   * and its own clusters, You has an account and a friends list, Find has
   * whatever was last searched. Clearing the shell's copies on sign-out left
   * every one of those on screen — somebody signed out and could still read
   * their groups, which is not a stale cache, it is the wrong person's data on
   * a phone they may have just handed over.
   *
   * Bumping this is a `key` change on the tab tree, so React discards all four
   * and everything inside them. It is deliberately not a list of things to
   * clear: a fourth tab with a cache of its own would not be added to such a
   * list, and the failure would be silent and identical.
   *
   * Bumped on the way in as well as the way out. Signing in as somebody else on
   * a phone that was a guest must not inherit the guest's lists.
   */
  const [identity, setIdentity] = useState(0);
  useEffect(() => {
    setVisited((was) => (was.has(tab) ? was : new Set(was).add(tab)));
  }, [tab]);
  /*
   * Somebody pressed `+` on their profile and chose a group.
   *
   * The form that makes one lives on the Groups tab, because that is where the
   * suggestions are — the people this actor keeps ending up in events with,
   * which is the argument for making a group rather than an empty room to
   * fill. So the press goes there and opens it, rather than a second copy of
   * the form appearing on the profile. A counter rather than a flag: pressing
   * `+` twice has to open it twice.
   */
  const [makeGroup, setMakeGroup] = useState(0);
  const [events, setEvents] = useState<EventListing[]>([]);
  /**
   * How many things are waiting on an answer, for the badge on the envelope.
   *
   * Held here rather than in the Groups tab because it is a fact about the
   * account, not about that screen: the tab unmounts, Lately answers things
   * that change it, and a push arriving while the app is open should be able to
   * move it. One number, one owner.
   *
   * Its own small request rather than the length of `/api/requests` — the badge
   * is drawn on a tab somebody may never open, and fetching fifty rows to
   * render one digit is fifty rows of somebody's data allowance.
   */
  const [waiting, setWaiting] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [arriving, setArriving] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const open = useCallback(
    async (event: SavedEvent, pane?: Pane, upload?: string[], photo?: string) => {
      setRemembered(await rememberEvent(event));
      setRoute({ screen: 'event', event, pane, upload, photo });
    },
    [],
  );

  /**
   * Groups belong to the actor, not the device — so they are fetched rather
   * than remembered locally. A reinstall loses the event list and keeps the
   * groups, which is the right way round: a link is a thing you were sent, a
   * group is a thing you are in.
   */
  const refreshGroups = useCallback(async () => {
    setGroups(await api.myGroups().catch(() => []));
  }, [api]);

  /**
   * The events this actor can reach.
   *
   * Fetched rather than remembered locally, for the same reason groups are:
   * a list on the device is a list of links this phone was sent, and a
   * reinstall loses it. Membership is the durable thing.
   */
  const refreshWaiting = useCallback(async () => {
    // Silent. A badge is the least important thing on the screen and a failed
    // count must not become an error somebody has to read.
    setWaiting(await api.waiting().catch(() => 0));
  }, [api]);

  const refreshEvents = useCallback(async () => {
    const next = await api.myEvents().catch(() => null);
    if (next) setEvents(next);
    setLoadingEvents(false);
  }, [api]);

  const openListing = useCallback(
    (event: EventListing, photo?: string) =>
      open(
        {
          id: event.id,
          name: event.name,
          linkToken: event.linkToken,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        },
        undefined,
        undefined,
        photo,
      ),
    [open],
  );

  /**
   * The one path in, whether the link was pasted, scanned or tapped.
   *
   * Lifted out of the join screen because a deep link can arrive when that
   * screen is not mounted — the app may be sitting inside another event, or
   * not running at all — and two copies of "exchange this for an event and
   * remember it" would drift.
   */
  const join = useCallback(
    async (input: { linkToken?: string; code?: string }) => {
      setArriving(true);
      setJoinError(null);
      try {
        const summary = await api.join(input);
        await open({
          id: summary.id,
          name: summary.name,
          linkToken: summary.linkToken,
          startsAt: summary.startsAt,
          endsAt: summary.endsAt,
        });
        return true;
      } catch (err) {
        /*
         * A private album. The link is right, and it is not a way in.
         *
         * The refusal carries the album — `{ event: { id, name } }` — because
         * a door has to say what it is the door to, and the name is not news
         * to somebody who was sent the link. Anything malformed falls through
         * to the message below rather than opening a door with no name on it.
         */
        if (err instanceof ApiError && err.code === 'approval_required') {
          const door = err.body.event as { id?: string; name?: string } | undefined;
          if (door?.id) {
            setRoute({ screen: 'door', eventId: door.id, name: door.name ?? 'This album' });
            setJoinError(null);
            return true;
          }
        }
        // A code needs an account, and saying "couldn't find that" would send
        // someone off to check a code that was correct.
        setJoinError(
          err instanceof ApiError && err.code === 'sign_in_required'
            ? 'That worked, but you need an account first. Open You and sign in, then try again.'
            : "Couldn't find that. Check the link or the code and try again.",
        );
        return false;
      } finally {
        setArriving(false);
      }
    },
    [api, open],
  );

  /**
   * Cold start and warm start both deliver the URL, and on some platforms both
   * deliver the *same* one — `getInitialURL` returns what launched the app and
   * the listener can fire for it as well. Handling it twice means two joins and
   * two writes to the recent-events list, so each URL is answered once.
   */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const refreshAccount = useCallback(async () => {
    // `null` until the answer arrives. Gates render nothing meanwhile: a
    // sign-in prompt that flashes for someone already signed in is worse than
    // one that appears a moment late.
    setSignedIn(await api.account().then((a) => a !== null).catch(() => false));
  }, [api]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  /**
   * Asked again on the way into making an album.
   *
   * The launch answer is `false` for a request that failed as much as for a
   * device with no account — `refreshAccount` cannot tell them apart and errs
   * safe, which is right. What is not right is carrying that around all day: it
   * runs once, so one flaky moment at launch put a sign-in gate in front of
   * somebody who was signed in the whole time, for the rest of the session.
   *
   * This is the one flow the answer decides, so it is the one worth re-asking
   * at. Nothing flashes while it is in flight — `signedIn` keeps its old value
   * until the reply lands.
   */
  useEffect(() => {
    if (making(route)) void refreshAccount();
  }, [route, refreshAccount]);

  /**
   * What is left on screen after signing out.
   *
   * The keychain is cleared by the card that asked; this is the other half —
   * every list this component is holding was fetched *as* the person who has
   * just left, and React has no reason to drop any of it. Photos on the home
   * tab, their groups, the name beside their uploads: all still rendered,
   * correct for nobody. The route goes back to the tabs as well, because
   * signing out from inside an event would leave that event open.
   */
  const signOut = useCallback(() => {
    setRemembered([]);
    setGroups([]);
    setEvents([]);
    // The envelope's count is about the account that has just gone.
    setWaiting(0);
    setSignedIn(false);
    setRoute({ screen: 'tabs' });
    setTab('home');
    /*
     * And the tabs themselves, which hold their own copies of all of it.
     *
     * The four above are the shell's. Each tab fetched its own and keeps it,
     * because they are kept mounted rather than unmounted — so without this,
     * signing out cleared the lists the shell was holding and left the Groups
     * tab showing groups and You showing a profile.
     */
    setVisited(new Set(['home']));
    setIdentity((n) => n + 1);
  }, []);

  /*
   * Leaving a pushed screen, named once each.
   *
   * Every one of these is reached two ways now — the arrow in the top-left
   * corner and dragging the screen off to the right — and the two have to do
   * the same thing, refreshes included. Written inline at both call sites they
   * would be one edit away from a gesture that leaves a stale list behind and
   * an arrow that does not.
   */
  const leaveEvent = useCallback(() => {
    void refreshEvents();
    setRoute({ screen: 'tabs' });
  }, [refreshEvents]);

  const leaveGroup = useCallback(() => {
    void refreshGroups();
    void refreshEvents();
    setRoute({ screen: 'tabs' });
  }, [refreshEvents, refreshGroups]);

  /** The screens that change nothing on their way out. */
  const leaveToTabs = useCallback(() => setRoute({ screen: 'tabs' }), []);

  /**
   * Out of making an album, from either of its two steps.
   *
   * Where the photographs' own Cancel goes, and now also where the gesture and
   * the sign-in gate go — one answer, so a screen cannot grow a way out that
   * lands somewhere its arrow does not. Back to the group when the album was
   * started from inside one, because that is the room it was going to live in.
   *
   * Reads the route through the setter rather than closing over it: the gate
   * sits outside the branch that has it narrowed, and a stale `groupId` here
   * would put somebody back in the wrong room.
   */
  const leaveMaking = useCallback(() => {
    setRoute((was) =>
      making(was) && was.groupId ? { screen: 'group', id: was.groupId } : { screen: 'tabs' },
    );
  }, []);

  /**
   * Back to the photographs, not out of the flow.
   *
   * What the form's Cancel has always done, and now what its gesture does too:
   * somebody on the form who wants a different picture has not changed their
   * mind about making an album. Swiping here has to agree with the control in
   * the corner, or the two are different screens wearing one title.
   */
  const backToPhotographs = useCallback(() => {
    setRoute((was) =>
      was.screen === 'create'
        ? { screen: 'pick', groupId: was.groupId, groupName: was.groupName }
        : was,
    );
  }, []);

  /**
   * Leaving Lately, which always changes the badge.
   *
   * Reading is what clears it — `/api/activity` moves `invites_seen_at` as a
   * side effect of answering, the same way the web page does on render. So the
   * count in hand is stale by the time somebody backs out, and the envelope
   * would go on claiming there is something new until the app was relaunched.
   */
  const leaveLately = useCallback(() => {
    void refreshWaiting();
    setRoute({ screen: 'tabs' });
  }, [refreshWaiting]);

  const handled = useRef<string | null>(null);
  const arrive = useCallback(
    async (url: string | null) => {
      if (!url || handled.current === url) return;
      handled.current = url;
      const arrival = arrivalFromUrl(url);
      // A link we cannot act on is silently ignored rather than shown as an
      // error: the person tapped something and got the app, which is not a
      // failure they caused or can fix.
      if (arrival) await join(arrival);
    },
    [join],
  );

  /**
   * Where a tapped notification goes.
   *
   * §12 allows one reminder per event, ever. Until this existed all three
   * notifications arrived and did nothing but bring the app forward on
   * whatever screen it was already showing, which spends that one interruption
   * on nothing.
   */
  const follow = useCallback(
    async (data: Record<string, unknown> | null) => {
      const target = notificationTarget(data);
      if (!target) return;
      if (target.screen === 'group') {
        setRoute({ screen: 'group', id: target.groupId });
        return;
      }
      // A nudge is about an event this person already joined, so the token is
      // on the device. If it is not — a reinstall — there is nothing to open
      // with, and dropping them on the home screen beats a broken event.
      const saved = (await loadEvents()).find((e) => e.id === target.eventId);
      if (saved) void open(saved);
    },
    [open],
  );

  useEffect(() => {
    (async () => {
      const token = await loadActorToken();
      if (token) api.setToken(token);
      setRemembered(await loadEvents());
      setReady(true);
      // Both after the token: one asks who this device is, the other answers
      // as them. Groups are empty for anyone who has never contributed, which
      // is the common first launch and not an error.
      void refreshGroups();
      void refreshEvents();
      void refreshWaiting();
      await arrive(await Linking.getInitialURL());
      // The notification equivalent of `getInitialURL`: the app may have been
      // launched by a tap, and that arrives here rather than on the listener.
      await follow(await launchNotification());
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void arrive(url);
    });
    const untap = onNotificationTapped((data) => void follow(data));
    return () => {
      subscription.remove();
      untap();
    };
  }, [api, arrive, follow, refreshEvents, refreshGroups, refreshWaiting]);

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Waiting size={40} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {route.screen === 'event' && (
        <SwipeBack onBack={leaveEvent}>
          <EventScreen
            api={api}
            event={route.event}
            initialPane={route.pane}
            initialPhoto={route.photo}
            initialUpload={route.upload}
            webBase={API_BASE}
            t={t}
            dark={dark}
            signedIn={signedIn}
            onSignedIn={refreshAccount}
            Button={Button}
            onBack={leaveEvent}
            onOpenGroup={(id) => setRoute({ screen: 'group', id })}
            onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
            onGroupsChanged={refreshGroups}
          />
        </SwipeBack>
      )}

      {/*
        The sign-in gate, on both steps of making an album rather than the last.

        It used to be on `create` alone, which is a screen nobody signed out can
        reach: the flow begins at `pick`, and `pick` rendered only for
        `signedIn === true`. So pressing "Create album" without an account set
        the route to a screen with no branch to draw it — no picker, no gate,
        no tabs, nothing. A blank page with no arrow, no Cancel and, until the
        gesture below, no way off it at all. The button read as broken because
        from the outside it was.

        `null` gets the spinner rather than the gate, for the reason
        `refreshAccount` states: the answer is one request away, and a sign-in
        prompt that flashes at somebody already signed in is worse than one that
        arrives a moment late. What it must not be is the blank page again.
      */}
      {making(route) && signedIn !== true && (
        <SwipeBack onBack={leaveMaking}>
          {signedIn === null ? (
            <View style={[styles.center, { backgroundColor: t.bg }]}>
              <Waiting size={40} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll}>
              <Pressable onPress={leaveMaking} hitSlop={12} accessibilityRole="button">
                <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
              </Pressable>
              <AccountCard
                api={api}
                t={t}
                Button={Button}
                gate
                why="Making an album needs an account, so the people you invite know whose album it is."
                onSignedIn={() => {
                  void refreshAccount();
                  void refreshEvents();
                }}
              />
            </ScrollView>
          )}
        </SwipeBack>
      )}

      {/*
        Step one: the photographs.

        Gated on an account for the same reason the form is — making an album is
        the one thing here that needs one — so the card above answers for both
        steps and this never opens on somebody who would be refused at the end.
        It used to say "the card below", which was true of a card that only
        drew on the second step and therefore never drew at all.
      */}
      {route.screen === 'pick' && signedIn === true && (
        <SwipeBack onBack={leaveMaking}>
          <PickPhotos
            t={t}
            Button={Button}
            onCancel={leaveMaking}
            onNext={(chosen) =>
              setRoute({
                screen: 'create',
                groupId: route.groupId,
                groupName: route.groupName,
                chosen,
              })
            }
          />
        </SwipeBack>
      )}

      {route.screen === 'create' && signedIn === true && (
        <CreateEvent
          api={api}
          // Distinct places from this person's own events, newest first. Three
          // is enough to be a shortcut; more is a list to read, which is worse
          // than typing the word.
          recentPlaces={[
            ...new Set(events.map((e) => e.place).filter((p): p is string => Boolean(p))),
          ].slice(0, 3)}
          groupId={route.groupId}
          groupName={route.groupName}
          chosen={route.chosen}
          t={t}
          // Back to the photographs, not out of the flow: somebody on the form
          // who wants a different picture has not changed their mind about
          // making an album.
          onCancel={backToPhotographs}
          onCreated={(created, photos) => {
            void refreshGroups();
            void open(
              {
                id: created.id,
                name: created.name,
                linkToken: created.linkToken,
                startsAt: created.startsAt,
                endsAt: created.endsAt,
              },
              undefined,
              // What the form is holding, not what the picker handed it: the
              // row under the cover has a ⊗ on every tile.
              photos.map((photo) => photo.id),
            );
          }}
          Button={Button}
        />
      )}

      {route.screen === 'groupThread' && (
        <SwipeBack onBack={leaveToTabs}>
          <GroupThread
            api={api}
            group={route.group}
            t={t}
            dark={dark}
            onBack={leaveToTabs}
            onOpenGroup={() => setRoute({ screen: 'group', id: route.group.id })}
          />
        </SwipeBack>
      )}

      {route.screen === 'group' && (
        <SwipeBack onBack={leaveGroup}>
          <GroupScreen
            api={api}
            groupId={route.id}
            t={t}
            onBack={leaveGroup}
            onOpenEvent={open}
            onCreateEvent={(name) => setRoute({ screen: 'pick', groupId: route.id, groupName: name })}
            /*
              Into the room's own conversation, from the room.

              It was reachable only from the envelope on the Groups tab, so a
              group opened from a search result or from one of its albums was a
              room with the talking sealed off.
            */
            onOpenThread={(group) =>
              setRoute({
                screen: 'groupThread',
                group: {
                  id: group.id,
                  name: group.name,
                  memberCount: group.memberCount,
                  eventCount: group.events.length,
                },
              })
            }
            onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
            Button={Button}
          />
        </SwipeBack>
      )}

      {/*
        Somebody's page, pushed over whichever tab found them. The app's own
        event list goes with it: the events you are both in are all events this
        device already holds a link token for, so opening one from here is the
        same act as opening it from home.
      */}
      {route.screen === 'newGroup' && (
        <SwipeBack onBack={leaveToTabs}>
          <NewGroup
            api={api}
            t={t}
            dark={dark}
            people={route.people}
            suggestedName={route.suggestedName}
            onCancel={leaveToTabs}
            onCreated={(id) => {
              // The tab behind it is holding a list without this in it, and the
              // group is about to be on screen — so both, before the push.
              void refreshGroups();
              setRoute({ screen: 'group', id });
            }}
          />
        </SwipeBack>
      )}

      {route.screen === 'lately' && (
        <SwipeBack onBack={leaveLately}>
          <Lately
            api={api}
            t={t}
            onBack={leaveLately}
            onAnswered={() => {
              // An accepted invitation is an album on the home screen and
              // possibly a group in the tab underneath, and it is one fewer
              // thing on the badge. None of those are things Lately can see.
              void refreshEvents();
              void refreshGroups();
              void refreshWaiting();
            }}
            onOpenEvent={(id) => {
              const listing = events.find((e) => e.id === id);
              if (listing) openListing(listing);
            }}
            onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
          />
        </SwipeBack>
      )}

      {route.screen === 'person' && (
        <SwipeBack onBack={leaveToTabs}>
          <PersonScreen
            api={api}
            handle={route.handle}
            events={events}
            t={t}
            onBack={leaveToTabs}
            onOpenEvent={openListing}
            Button={Button}
          />
        </SwipeBack>
      )}

      {/*
        And the tabs over it, which is the difference between a page and a
        modal.

        Somebody arrives here from a byline, a face over a cover or a search
        result — browsing, not committing to a task — and the screen answered
        by taking the app away and leaving one `‹` in the corner. Every other
        screen reached that way is a push over the tabs; this one was the
        exception with nothing to show for it.

        A tab sets the tab *and* drops this page, so pressing Albums lands on
        albums rather than on this page with the bar lit underneath it.
      */}
      {route.screen === 'person' && (
        <TabBar
          tab={tab}
          t={t}
          dark={dark}
          onTab={(id) => {
            setTab(id);
            leaveToTabs();
          }}
        />
      )}

      {/*
        The door, pushed over whatever was on screen when the link arrived.

        Backing out goes to the tabs rather than to the join screen: somebody
        who has asked is done here, and the place to wait is the list of
        albums they are in — which is where the album appears if they are let
        in.
      */}
      {route.screen === 'door' && (
        <SwipeBack onBack={leaveToTabs}>
          <DoorScreen
            api={api}
            eventId={route.eventId}
            name={route.name}
            t={t}
            onBack={leaveToTabs}
            // Approved between the link being sent and the button being pressed.
            // Nothing to wait for, so the list is refreshed and the door closes.
            onLetIn={() => {
              void refreshEvents();
              setRoute({ screen: 'tabs' });
            }}
            Button={Button}
          />
        </SwipeBack>
      )}

      {route.screen === 'join' && (
        <JoinScreen
          api={api}
          // `remembered`, not `events`: this strip is the links this device was
          // sent, which is what someone arriving via a link wants to see. The
          // server list is a superset and is structurally assignable to
          // SavedEvent, so passing the wrong one here typechecks cleanly and
          // silently changes what the screen shows.
          events={remembered}
          groups={groups}
          t={t}
          onOpen={open}
          onOpenGroup={(id) => setRoute({ screen: 'group', id })}
          onCreateEvent={() => setRoute({ screen: 'pick' })}
          onJoin={join}
          onBack={() => setRoute({ screen: 'tabs' })}
          busy={arriving}
          error={joinError}
        />
      )}

      {route.screen === 'tabs' && (
        /*
         * Keyed by the account, so a change of identity takes every tab's state
         * with it. See `identity` above for why this is a key rather than a
         * list of things to reset.
         */
        <View key={identity} style={styles.root}>
          {visited.has('home') && (
            <Pane showing={tab === 'home'}>
              <HomeTab
                api={api}
                events={events}
                loading={loadingEvents}
                t={t}
                waiting={waiting}
                onOpenLately={() => setRoute({ screen: 'lately' })}
                onOpen={openListing}
                onRefresh={refreshEvents}
                onCreate={() => setRoute({ screen: 'pick' })}
                onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
                onCreateGroup={() => {
                  setTab('search');
                  setMakeGroup((n) => n + 1);
                }}
                // The join screen's only way in, now that the pill above the tab
                // bar is gone: a link, a QR code or a spoken phrase.
                Button={Button}
              />
            </Pane>
          )}
          {visited.has('chats') && (
            <Pane showing={tab === 'chats'}>
              <ChatsTab
                api={api}
                // The album conversations come off this list — the albums this
                // actor can already open — and never off a group.
                events={events}
                t={t}
                active={tab === 'chats'}
                waiting={waiting}
                onOpenLately={() => setRoute({ screen: 'lately' })}
                onCreateAlbum={() => setRoute({ screen: 'pick' })}
                /*
                 * Making a group happens on Find, which is where the groups
                 * are. This hands the tab over and asks it to open the page.
                 */
                onCreateGroup={() => {
                  setTab('search');
                  setMakeGroup((n) => n + 1);
                }}
                Button={Button}
                onOpenGroupThread={(group) => setRoute({ screen: 'groupThread', group })}
                onGoToEvents={() => setTab('home')}
              />
            </Pane>
          )}
          {visited.has('search') && (
            <Pane showing={tab === 'search'}>
              <SearchTab
                api={api}
                events={events}
                t={t}
                active={tab === 'search'}
                openCreate={makeGroup}
                waiting={waiting}
                onOpen={openListing}
                onOpenGroup={(id) => setRoute({ screen: 'group', id })}
                onOpenGroupThread={(group) => setRoute({ screen: 'groupThread', group })}
                onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
                onOpenLately={() => setRoute({ screen: 'lately' })}
                onCreateAlbum={() => setRoute({ screen: 'pick' })}
                onCreateGroup={() => {
                  /*
                   * Spent on the way in, and that is the whole of this fix.
                   *
                   * `makeGroup` is how a `+` on another tab asks this one to
                   * open the page — a counter, because pressing `+` twice has
                   * to open it twice. But the tabs are drawn only while the
                   * route is `tabs`, so pushing this page unmounts them, and
                   * coming back mounts them again: the effect reran on a
                   * counter still standing at one and pushed the page straight
                   * back over the tab it had just returned to.
                   *
                   * From the outside that is a Cancel that does nothing, on a
                   * page that had no gesture either — the only way out of a
                   * group you had decided not to make was to kill the app.
                   */
                  setMakeGroup(0);
                  setRoute({ screen: 'newGroup' });
                }}
                onCreateGroupFrom={(cluster) =>
                  setRoute({
                    screen: 'newGroup',
                    people: cluster.people,
                    suggestedName: cluster.suggestedName ?? '',
                  })
                }
                Button={Button}
              />
            </Pane>
          )}
          {visited.has('profile') && (
            <Pane showing={tab === 'profile'}>
              <ProfileScreen
                api={api}
                events={events}
                webBase={API_BASE}
                t={t}
                active={tab === 'profile'}
                onOpen={openListing}
                onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
                onCreateEvent={() => setRoute({ screen: 'pick' })}
                onCreateGroup={() => {
                  setTab('search');
                  setMakeGroup((n) => n + 1);
                }}
                onSignedIn={() => {
                  // The account may speak for another device's actor, so what
                  // this person can reach has just changed.
                  void refreshEvents();
                  void refreshGroups();
                  void refreshWaiting();
                  void refreshAccount();
                  /*
                   * And everything the other tabs are holding, which belonged
                   * to whoever this phone was before.
                   *
                   * Signing in is a change of identity in the same way signing
                   * out is — a phone that was a guest, or was somebody else,
                   * must not carry their lists into the account that has just
                   * arrived. The `key` is what discards them; see `identity`.
                   */
                  setVisited(new Set(['profile']));
                  setIdentity((n) => n + 1);
                }}
                onSignedOut={signOut}
                Button={Button}
              />
            </Pane>
          )}

          <TabBar tab={tab} t={t} dark={dark} onTab={setTab} />
        </View>
      )}

      {/*
        A tapped link can land while the app is already somewhere else.
        Without this the screen simply changes under someone who is watching
        an upload, with no account of why.
      */}
      {arriving && route.screen !== 'join' && (
        <View style={[styles.center, styles.overlay]}>
          <Waiting />
          <Text style={[styles.body, { color: t.fg }]}>Opening…</Text>
        </View>
      )}
    </View>
  );
}

// --- join --------------------------------------------------------------------

function JoinScreen({
  api,
  events,
  groups,
  t,
  onOpen,
  onOpenGroup,
  onCreateEvent,
  onJoin,
  onBack,
  busy,
  error,
}: {
  api: Api;
  events: SavedEvent[];
  groups: MyGroup[];
  t: Theme;
  onOpen: (event: SavedEvent) => void;
  onOpenGroup: (groupId: string) => void;
  onCreateEvent: () => void;
  onJoin: (input: { linkToken?: string; code?: string }) => Promise<boolean>;
  onBack: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [input, setInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const submit = useCallback(
    async (raw: string) => {
      const token = tokenFromInput(raw);
      // A link if it looks like one, otherwise treat it as a spoken code.
      const joined = await onJoin(token ? { linkToken: token } : { code: raw.trim() });
      setScanning(false);
      if (joined) setInput('');
    },
    [onJoin],
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={onBack}>
        <Text style={[styles.body, { color: t.accent }]}>‹ Back</Text>
      </Pressable>
      <Text style={[styles.h1, { color: t.fg }]}>
        Every photo from everyone who was there
      </Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Paste a link, or say the code</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="amber-quiet-lantern"
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => input.trim() && submit(input)}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Button
          label={busy ? 'Looking…' : 'Go'}
          onPress={() => submit(input)}
          disabled={busy || !input.trim()}
          t={t}
          primary
        />
        <Button
          label="Scan a QR code"
          t={t}
          onPress={async () => {
            if (!permission?.granted) {
              const next = await requestPermission();
              if (!next.granted) return;
            }
            setScanning(true);
          }}
        />
        {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}
      </View>

      {/*
        Below the ways in, not above them. Most people arriving here were sent
        a link; the host making one is the rarer case, and putting creation
        first would make the app look like a thing you have to set up.
      */}
      <Button label="Create album" onPress={onCreateEvent} t={t} />

      {/*
        Groups first, and above the recent events, because they are the thing
        that survives: the event list is whatever links this device has been
        sent, and the group list is where you actually belong.
      */}
      {groups.length > 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.label, { color: t.fg }]}>Your groups</Text>
          {groups.map((group) => (
            <Pressable
              key={group.id}
              onPress={() => onOpenGroup(group.id)}
              style={styles.listRow}
            >
              <Text style={[styles.body, { color: t.accent }]}>{group.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {events.length > 0 && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <Text style={[styles.label, { color: t.fg }]}>Recently</Text>
          {events.map((event) => (
            <Pressable key={event.id} onPress={() => onOpen(event)} style={styles.listRow}>
              <Text style={[styles.body, { color: t.accent }]}>{event.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/*
        Last, and never above the link box. Search is the backstop for a lost
        link, not the way in — putting discovery first would suggest browsing
        is how this product works, and it is not.
      */}
      <GroupSearch api={api} t={t} onOpen={onOpenGroup} />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (!busy) void submit(data);
            }}
          />
          <View style={{ padding: 20, paddingBottom: 40 }}>
            <Button label="Cancel" t={t} onPress={() => setScanning(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// --- event -------------------------------------------------------------------

/**
 * Where the album's page begins, under the cover.
 *
 * The same number as `styles.page.top`, and it has to stay the same number:
 * the thread's composer is lifted clear of the keyboard by it, and the two
 * drifting apart puts the text field back behind the keyboard by exactly the
 * difference. Named here rather than read off the stylesheet so that the
 * reason they match is written down next to one of them.
 */
/**
 * How tall the album's header is.
 *
 * It was 232, sized so a two-line album name could sit at `coverTitle`'s old
 * top of 140 and just reach the bottom. Shorter now, with the title moved up to
 * match: the header is a glass panel rather than a photograph to look at, and a
 * panel does not need a third of the screen.
 */
const COVER = 196;

/**
 * Where the page begins — flush with the header, not sixteen points below it.
 *
 * There was background showing between the two, which on a screen whose header
 * is a flat panel reads as a gap somebody forgot to close rather than as air.
 * The tabs keep their own twelve points of padding, which is the space that was
 * actually doing the work.
 */
const PAGE_TOP = COVER;

/**
 * The id tying a field to the bar that sits over the keyboard.
 *
 * iOS matches `inputAccessoryViewID` on the input to `nativeID` on the view, so
 * the two have to agree on a string. One constant, because two literals that
 * have to match is a pair that eventually does not.
 */
const KEYBOARD_BAR = 'parea-keyboard-bar';

function EventScreen({
  api,
  event,
  initialPane,
  initialPhoto,
  initialUpload,
  webBase,
  t,
  dark,
  signedIn,
  onSignedIn,
  Button: ButtonEl,
  onBack,
  onOpenGroup,
  onOpenPerson,
  onGroupsChanged,
}: {
  api: Api;
  event: SavedEvent;
  /** Which pane to land on. See the `useState` below for why it is optional. */
  initialPane?: Pane;
  /**
   * Which photograph to open on top of the grid, if any.
   *
   * Set by a tile in the strip under a home card, which is a picture of one
   * photograph and should arrive at it. Acted on once, when the feed that can
   * resolve an id into a photograph first lands — see the effect below.
   */
  initialPhoto?: string;
  /**
   * Library ids to send as soon as this opens.
   *
   * Set only by the create flow, which chose them two screens ago. The album
   * used to be handed the event's *window* and left to re-scan the library for
   * it — which offered everything taken in those hours rather than the
   * photographs somebody actually picked.
   */
  initialUpload?: string[];
  /** Where links live, for the one this screen hands to the share sheet. */
  webBase: string;
  t: Theme;
  /** Which way round the segmented control's well is drawn. */
  dark: boolean;
  /** null until the answer arrives; the gate renders nothing meanwhile. */
  signedIn: boolean | null;
  onSignedIn: () => void;
  Button: typeof Button;
  onBack: () => void;
  onOpenGroup: (groupId: string) => void;
  /** A byline on a photograph is a person; pressing one opens them. */
  onOpenPerson: (handle: string) => void;
  onGroupsChanged: () => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  /** Which single photograph is on its way to the camera roll, if any. */
  const [savingOne, setSavingOne] = useState<string | null>(null);
  /**
   * "Saved to your photos", for as long as it takes to read it.
   *
   * Saving one photograph said nothing at all when it worked. The glyph dimmed
   * for a second and came back, which is indistinguishable from a control that
   * did nothing — and the place the photograph lands is another app, so there
   * was no way to find out short of leaving this one.
   *
   * A note rather than an alert. An alert is a thing you have to dismiss, and
   * making somebody press OK to acknowledge that a button they pressed did
   * what it said is a second gesture charged for the first. The failure still
   * gets one, because that is a thing they have to decide about.
   */
  const [savedNote, setSavedNote] = useState(false);
  /** So that saving a second photograph restarts the note rather than
      inheriting however much was left of the first one's welcome. */
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );
  /**
   * What is stuck in *this* album, as numbers rather than as a sentence.
   *
   * The sentence is for reading; these are for deciding what to offer under it.
   * Scoped to the event because nothing but `done` is ever pruned from the
   * queue — a failure outlives every later run, and the counts on the queue
   * itself are the whole queue's, so this screen was captioning a perfectly
   * good upload into one album with failures belonging to another.
   */
  const [stuck, setStuck] = useState<{ failed: number; stale: number }>({
    failed: 0,
    stale: 0,
  });
  /*
   * How far along the uploads are, as a fraction.
   *
   * Separate from `queueStatus`, which is a sentence. A bar needs a number, and
   * deriving one by parsing "2 of 5 added" back out of its own label is the kind
   * of thing that works until somebody rewords the label.
   *
   * Null when nothing is in flight, which is what takes the bar away — rather
   * than leaving a full one sitting under the cover after the last photograph
   * has landed.
   */
  const [progress, setProgress] = useState<number | null>(null);
  /*
   * How many photographs this batch is putting into the album.
   *
   * The bar used to measure bytes leaving the phone, which is half the wait: a
   * photograph is not in the album when it has been uploaded, it is in the
   * album when the deriver has been round. So the bar finished, the screen said
   * "Nothing here yet", and the pictures then appeared one at a time to anybody
   * who kept pulling down to refresh.
   *
   * One number for the whole journey instead. Done is everything that is
   * neither still uploading nor still being processed, so the bar fills once
   * and empties when the album is actually full.
   */
  const [batch, setBatch] = useState<number | null>(null);
  const [uploading, setUploading] = useState(0);
  const [waitingForNetwork, setWaitingForNetwork] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedPhoto | null>(null);
  /**
   * Whether `initialPhoto` has been spent.
   *
   * A ref rather than state: it is read and written inside the effect below and
   * nothing renders differently for it, so putting it in state would schedule a
   * second pass for a value nobody draws.
   *
   * Spent on the first feed whether or not the photograph was in it. An id that
   * names nothing is a card drawn against a thumbnail the album no longer has —
   * somebody removed it between the home screen loading and the tap — and the
   * right answer there is the grid, not a viewer that springs open two polls
   * later when an unrelated photograph happens to match.
   */
  const landed = useRef(false);
  /** The `⋯` sheet inside the viewer: remove, ask down, report, block. */
  const [actionsFor, setActionsFor] = useState<FeedPhoto | null>(null);
  const [autoWindow, setAutoWindow] = useState<Window | null>(null);
  const [access, setAccess] = useState<LibraryAccess>('undetermined');
  const [offerUpgrade, setOfferUpgrade] = useState(false);
  /**
   * Which of the three panes is up.
   *
   * Client state and not a route, deliberately: an event's link should open on
   * its photographs, never on its roster or halfway down somebody's
   * conversation. It is the same screen either way — see the note on the
   * folded header below.
   */
  /*
   * Photographs unless something explicitly asked otherwise.
   *
   * The default is the rule: an event's *link* must open on its photographs,
   * never on its roster or halfway down somebody's conversation. `initialPane`
   * is set only by an in-app row that is itself a conversation — the Groups
   * tab's event chats — and no deep link can reach it.
   */
  const [pane, setPane] = useState<Pane>(initialPane ?? 'photos');
  /** The sheet behind `⋯`, which is where this screen's settings went. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The account, asked for only when somebody reaches for what needs one. */
  const [gateOpen, setGateOpen] = useState(false);
  /** This ask, answered locally until a feed carries the server's version. */
  const [hostAsk, setHostAsk] = useState<'open' | 'approved' | 'declined' | null>(null);
  const [askingToHost, setAskingToHost] = useState(false);
  /** How much of the thread has been read. Null until the first feed lands. */
  const [seen, setSeen] = useState<number | null>(null);
  /** Whether the unread banner has taken itself away again. */
  const [bannerGone, setBannerGone] = useState(false);
  /**
   * Who can see it, while the change is in the air.
   *
   * Held here rather than read straight off the feed so the two pills answer
   * the press immediately — one round trip is long enough for a tap to feel
   * ignored — and reconciled by the refresh below. Null means "whatever the
   * feed says", which is the state on every load.
   */
  const [policy, setPolicy] = useState<'public' | 'private' | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  /**
   * Who may add, while the change is in the air — the same trick the pills
   * above use, for the same reason: one round trip is long enough for a tap to
   * feel ignored. Null means "whatever the feed says", which is every load.
   */
  const [adding, setAdding] = useState<ContributePolicy | null>(null);
  const [savingContribute, setSavingContribute] = useState(false);
  const [contributeError, setContributeError] = useState<string | null>(null);

  useEffect(() => {
    void libraryAccess().then(setAccess);
  }, []);

  /**
   * Open the photograph somebody pointed at, once the feed can name it.
   *
   * The id arrives with the route and the photograph itself does not exist on
   * this screen until the feed lands, so this waits rather than the caller
   * doing so — the home card has a thumbnail and an id, and fetching an album's
   * whole feed to hand over one row would put the wait on the tap instead of
   * behind the screen that is already opening.
   */
  useEffect(() => {
    if (!feed || landed.current) return;
    landed.current = true;
    if (!initialPhoto) return;
    const photo = feed.photos.find((p) => p.id === initialPhoto);
    if (photo) setSelected(photo);
  }, [feed, initialPhoto]);

  const [feedError, setFeedError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFeed(await api.feed(event.id, event.linkToken));
      // The server has spoken, so the local guess is no longer needed. Left
      // standing, it would outrank a change made on another device.
      setPolicy(null);
      setAdding(null);
      setHostAsk(null);
      setFeedError(null);
    } catch (err) {
      // Stale data beats an error screen over photos you already had, so a
      // failed refresh is swallowed — but the *first* load has nothing to be
      // stale, and swallowing it left the header saying "Loading…" for as
      // long as someone was willing to look at it.
      setFeedError(
        err instanceof Offline
          ? 'No connection. This will fill in when there is one.'
          : 'Could not load the photos.',
      );
    }
  }, [api, event]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Resume what this album left over, before anything else.
   *
   * Scoped on the way in as well as on the way through: the saved queue can
   * hold another evening's work, and starting a run because *something*
   * somewhere is unfinished means a screen that reports on a batch it is not
   * sending. The other album's items are not lost — they are still in the saved
   * state, and they go up when somebody opens it.
   */
  useEffect(() => {
    (async () => {
      const state = await loadQueue();
      if (!state.items.some((i) => i.eventId === event.id)) return;
      await runQueue(state);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A queue over the saved state, wired to this album.
   *
   * One place that knows the wiring, because three things want a queue now —
   * the run, the retry and the forget — and three copies of the same four
   * callbacks is three places for the link token to go stale.
   */
  const openQueue = useCallback(
    (state: Awaited<ReturnType<typeof loadQueue>>) =>
      new UploadQueue(
        {
          presign: (eventId, files) => api.presign(eventId, event.linkToken, files),
          upload: uploadItem,
          complete: (photoId) => api.complete(photoId, event.linkToken),
          save: saveQueue,
        },
        state,
      ),
    [api, event.linkToken],
  );

  const runQueue = useCallback(
    async (state?: Awaited<ReturnType<typeof loadQueue>>) => {
      const queue = openQueue(state ?? (await loadQueue()));

      const tick = setInterval(() => {
        // This album's, all through: the queue may be holding another evening's
        // leftovers, and counting them here would put photographs in the bar
        // that this screen is not sending and will never show.
        const done = queue.doneIn(event.id);
        const pending = queue.pendingIn(event.id);
        const total = done + pending;
        setQueueStatus(pending > 0 ? `${done} of ${total} added` : null);
        // What the bar needs: how many are still on their way up. The rest of
        // the sum is `arriving`, which only the feed knows.
        setUploading(pending);
        setBatch((was) => (was === null ? total : Math.max(was, total)));
      }, 400);

      try {
        /*
         * Only this album's photographs.
         *
         * The queue holds work for every album this phone has uploaded into,
         * and it will happily work all of it — which is right for a client that
         * can act for any album at any time, and wrong for this one: it
         * presigns and completes with the link token of the album on screen, so
         * a leftover item belonging to a different evening went up with the
         * wrong credential and came back refused. A failure invented by the
         * queue being more capable than its caller.
         *
         * Nothing is lost by leaving them. Every run writes the whole saved
         * state back, so they sit there and go up when somebody opens the album
         * they belong to — which is the honest reading of an upload anyway. It
         * happens in the room you are standing in.
         */
        await queue.run(event.id);
      } finally {
        clearInterval(tick);
        // Nothing left to send. The bar may still have a way to go — the
        // deriver has the rest of it — so this only reports the upload half.
        setUploading(0);
        queue.prune();
        await saveQueue(queue.state);
        // Three outcomes, not two. "Waiting" and "failed" ask opposite things
        // of a person: one is do nothing, the other is try again.
        setWaitingForNetwork(queue.waitingFor(event.id));
        /*
         * Three outcomes and, when something is stuck, why.
         *
         * The reason is appended rather than replacing the note: "waiting for a
         * connection" is the right thing to tell somebody in a basement, and
         * useless on its own when the truth is that a file could not be read.
         * One line saying both is how a person can tell those apart — and how
         * anybody reporting it can say something more useful than "it failed".
         */
        /*
         * This album's, not the queue's.
         *
         * `failedCount` and `staleItems` are the whole queue, which is the
         * right answer for a screen about the queue and the wrong one here: a
         * failure in another album would caption this one's uploads forever,
         * and there is no state in which telling somebody about it *here*
         * helps them.
         */
        const failed = queue.failedIn(event.id).length;
        const stale = queue.staleIn(event.id).length;
        /*
         * Outstanding with the run over, and not because the signal went.
         *
         * A run spends the whole retry budget before it returns now, so this is
         * the residue: a grant the server would not replace, a presign that
         * came back short. Rare — and it still has to be counted, because
         * `pending` after a finished run is the one state no sentence below
         * covered. That is how half a batch went missing without a word: four
         * of eight photographs neither failed nor waiting for a network, so the
         * line computed "nothing to say", cleared itself, and emptied the bar.
         *
         * Folded in with the failures because it asks a person for the same
         * thing, which is to press the button under it.
         */
        const unfinished = queue.waitingFor(event.id) ? 0 : queue.pendingIn(event.id);
        const stuckNow = failed + unfinished;
        setStuck({ failed: stuckNow, stale });
        const note = queue.waitingFor(event.id)
          ? `${queue.pendingIn(event.id)} waiting for a connection`
          : stuckNow > 0
            ? `${stuckNow} didn't upload`
            : stale > 0
              ? // Their bytes are gone rather than refused, so "try again" is
                // the wrong advice: the photograph has to be picked again.
                `${stale} could not be read — add ${stale === 1 ? 'it' : 'them'} again`
              : null;
        /*
         * And why, where there is a why.
         *
         * The reason is appended rather than replacing the note: "waiting for a
         * connection" is the right thing to tell somebody in a basement, and
         * useless on its own when the truth is that a file could not be read.
         * One line saying both is how a person tells those apart — and how
         * anybody reporting it can say more than "it failed", which cost this
         * bug several rounds of guessing.
         */
        const why =
          note && (queue.cause ?? queue.staleIn(event.id)[0]?.error)
            ? (queue.cause ?? queue.staleIn(event.id)[0]?.error)
            : null;
        setQueueStatus(note && why ? `${note} — ${why}` : note);
        await refresh();
      }
    },
    [event, openQueue, refresh],
  );

  /**
   * The way out of a line that used to have none.
   *
   * "6 didn't upload" was the end of the conversation: `failed` is terminal
   * after four attempts, nothing but `done` is ever pruned, so the sentence
   * outlived every later run with nothing to press and nothing to dismiss. A
   * report of a problem with no remedy beside it is not information, it is a
   * scar — and people learn to read past the one line on the screen that might
   * one day matter.
   *
   * Four attempts were spent against a condition that may well have changed: a
   * build that has since been fixed, a network that came back, a source that
   * can be copied out of the library again. Somebody pressing this is the new
   * information, which is why the attempts go back to zero.
   */
  const retryStuck = useCallback(async () => {
    const queue = openQueue(await loadQueue());
    /*
     * `retryFailed` wakes the terminal ones. An item merely left pending has
     * attempts on the clock already and needs nothing but another run — and
     * returning early because nothing had reached `failed` was how the one case
     * with no message also ended up with no remedy.
     */
    const woken = queue.retryFailed(event.id);
    if (woken === 0 && queue.pendingIn(event.id) === 0) return;
    await saveQueue(queue.state);
    setQueueStatus('Trying again…');
    setStuck({ failed: 0, stale: 0 });
    await runQueue(queue.state);
  }, [event.id, openQueue, runQueue]);

  /**
   * And the way out of the other one, where trying again would be a lie.
   *
   * A stale item's bytes are gone — the copy in the sandbox was cleaned up, or
   * the library handed back something that no longer resolves — so another four
   * attempts would find them just as gone. The only remedy is to pick the
   * photographs again, which is what the line says. This is how somebody agrees
   * to that and gets their screen back. Nothing is lost: the photographs are in
   * the camera roll, which is where they were all along.
   */
  const forgetStuck = useCallback(async () => {
    const queue = openQueue(await loadQueue());
    queue.forget(queue.staleIn(event.id).map((i) => i.source));
    await saveQueue(queue.state);
    setStuck({ failed: 0, stale: 0 });
    setQueueStatus(null);
  }, [event.id, openQueue]);

  /**
   * Try again when there is some reason to think the answer will differ.
   *
   * The queue stops rather than spinning when the network is gone, so
   * something has to start it. Two triggers, and no new dependency for
   * either: coming back to the app, which is when someone has walked outside,
   * and a widening backoff for the person standing still in a basement with
   * the app open.
   *
   * A connectivity library would be the precise answer. It is a native module
   * this codebase cannot test and would only make the retry sooner, not more
   * correct — the retry is cheap and the queue is idempotent.
   */
  useEffect(() => {
    if (!waitingForNetwork) return;

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void runQueue();
    });

    let delay = 15_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        void runQueue();
        delay = Math.min(delay * 2, 5 * 60_000);
        tick();
      }, delay);
    };
    tick();

    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [waitingForNetwork, runQueue]);

  const windowFor = useCallback((): Window | null => {
    return resolveWindow({
      startsAt: event.startsAt ? Date.parse(event.startsAt) : null,
      endsAt: event.endsAt ? Date.parse(event.endsAt) : null,
      // Inference from what is already there helps contributor five, not
      // contributor one — which is why the host-set window comes first.
      existing: (feed?.photos ?? []).map((p) => Date.parse(p.takenAt)),
    });
  }, [event, feed]);

  const enqueue = useCallback(
    async (files: { id: string; source: string; name: string; size: number; mime: string }[]) => {
      if (files.length === 0) return;
      if (!(await loadActorToken())) {
        await saveActorToken(await api.startSession());
      }
      const state = await loadQueue();
      const queue = new UploadQueue(
        {
          presign: (eventId, batch) => api.presign(eventId, event.linkToken, batch),
          upload: uploadItem,
          complete: (photoId) => api.complete(photoId, event.linkToken),
          save: saveQueue,
        },
        state,
      );
      queue.add(event.id, files);
      await saveQueue(queue.state);
      await runQueue(queue.state);

      // Now there is something worth being told about: a reminder if this
      // event goes quiet, and an answer if someone asks about one of these
      // photos. Never on first launch — design §12.
      if (!(await pushAlreadyAsked())) {
        const token = await registerForPush();
        if (token) {
          await api
            .registerDevice(token, RNPlatform.OS === 'android' ? 'android' : 'ios')
            .catch(() => {});
        }
      }
    },
    [api, event, runQueue],
  );

  /**
   * The whole camera roll, through the system picker.
   *
   * Its own function rather than the tail of `addPhotos`, because it is now
   * reached two ways: as the fallback when there is nothing to suggest from,
   * and from inside the suggestion screen when the suggestion is not what
   * somebody wanted. That second way is the point — see `onPickManually`.
   *
   * No permission prompt and no library access: the picker hands back the
   * files somebody chose and nothing else, which is why it can be the thing
   * that always works.
   */
  const pickFromLibrary = useCallback(async () => {
    /*
     * The picker's own failures, said out loud.
     *
     * `launchImageLibraryAsync` rejects rather than returning `canceled` when
     * iOS will not present it — most often because something else is already
     * on top — and every caller here reaches this through a `void`, so a
     * rejection was an unhandled promise and nothing else: press `+`, nothing
     * happens, no dialog, no message, no reason. A button that silently does
     * nothing is the one failure somebody reads as the app being broken,
     * because from the outside it is indistinguishable from one.
     */
    let picked: Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        // Photos only. Nothing downstream can handle a video — the deriver
        // makes AVIF, WebP and JPEG renditions with sharp — so offering one
        // here means it uploads, never becomes `ready`, and simply never
        // appears. Failing in the picker, where it cannot be chosen, beats
        // failing silently twenty minutes later.
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
        exif: false,
      });
    } catch {
      setQueueStatus('Could not open your photos — try again in a moment.');
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;

    // The other half of §18's precision number: a contribution that never got
    // a suggestion. Without this, "precision looks fine" and "almost nobody
    // saw a suggestion" are the same reading.
    api.observe({ kind: 'picker_used', eventId: event.id });

    await enqueue(
      picked.assets.map((asset, index) => ({
        id: `${Date.now()}-${index}`,
        source: asset.uri,
        name: asset.fileName ?? `photo-${index}.jpg`,
        size: asset.fileSize ?? 0,
        mime: asset.mimeType ?? 'image/jpeg',
      })),
    );

    // Earned the right to ask: they have contributed, so the pitch is
    // concrete rather than a permission wall in front of a stranger.
    if (access === 'undetermined' && windowFor()) setOfferUpgrade(true);
  }, [access, api, enqueue, event.id, windowFor]);

  const addPhotos = useCallback(async () => {
    // With library access and a known window, offer the photos rather than
    // asking someone to find them — the reason this client exists (§7.1).
    const window = windowFor();
    if ((access === 'granted' || access === 'limited') && window) {
      setAutoWindow(window);
      return;
    }

    await pickFromLibrary();
  }, [access, pickFromLibrary, windowFor]);

  /**
   * Save everything to the camera roll — the native terminal action.
   *
   * Asked rather than assumed, for the same reason the web offers "download
   * originals" and "download as JPEG" side by side (§7.7). On a phone the
   * honest axis is not format — the camera roll opens anything the camera
   * made — it is size: the originals from a 250-photo event are about a
   * gigabyte, and pulling that over cellular onto a phone that may not have
   * room for it is not a decision to make on someone's behalf.
   *
   * This used to save the 2560px rendition with no mention of it, which meant
   * the native client's terminal action quietly returned downscaled copies of
   * photos the product promises at full quality.
   */
  const saveAll = useCallback(async () => {
    if (!feed || feed.photos.length === 0) return;

    const bytes = feed.photos.reduce((sum, p) => sum + (p.byteSize ?? 0), 0);
    const run = async (kind: 'original' | 'full') => {
      setSaving('Starting…');
      try {
        const { saved, failed } = await saveToCameraRoll(
          feed.photos.map((p) => ({
            id: p.id,
            url: kind === 'original' ? p.original : p.full,
            mime: kind === 'original' ? p.mime : 'image/jpeg',
          })),
          (done, total) => setSaving(`Saving ${done} of ${total}`),
        );
        Alert.alert(
          'Saved',
          failed > 0
            ? `${saved} photos saved, ${failed} could not be saved.`
            : `${saved} photos are in your camera roll.`,
        );
      } catch (err) {
        Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(null);
      }
    };

    Alert.alert(
      `Save ${feed.photos.length} photos`,
      `Full quality is about ${formatSize(bytes)}. Smaller copies are quicker and fine for looking at.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Smaller copies', onPress: () => void run('full') },
        { text: 'Full quality', onPress: () => void run('original') },
      ],
    );
  }, [feed]);

  /**
   * The event's cover, for whoever runs it.
   *
   * This was one bare button that offered both actions unconditionally, because
   * the feed did not say whether a cover existed — so the row meant "there
   * may or may not be one, press to find out", and "Remove it" was offered on
   * events with nothing to remove. The feed carries `coverUrl` now, so the row
   * shows the picture and the sheet only offers removal when there is something
   * to take away.
   *
   * Still a sheet rather than two buttons on the screen: replacing a cover is
   * the common case and removing one is rare, and the rare destructive action
   * is better one press further away than sitting next to the ordinary one.
   */
  const chosenCover = feed?.event.coverUrl ?? null;

  /**
   * What the album actually leads with: the chosen cover, or its first photograph.
   *
   * This reverses a rule that was written down a few feet below — "never a
   * photograph pulled out of the grid, that is a decision about which evening
   * this was". The objection was sound about *which* photograph: an album's
   * first upload by timestamp is an accident of whose phone finished first.
   *
   * What changed is that the first one is no longer an accident. The picker
   * chooses the order now, and the one leading the grid is the one somebody put
   * first — so borrowing it is reading a decision that has already been made,
   * not inventing one. And the alternative was worse than it sounded: an album
   * full of photographs whose door was a coloured letter, because nobody went
   * looking for a setting they had no reason to know existed.
   *
   * Kept apart from `chosenCover` deliberately. The edit sheet below offers
   * "Remove it" only where there is something to remove, and if this fed it the
   * borrowed picture it would offer to remove a cover nobody set.
   */
  const cover = chosenCover ?? feed?.photos[0]?.card ?? feed?.photos[0]?.src ?? null;

  /**
   * Who each photograph belongs to, by the key each one carries.
   *
   * Built once rather than searched per row: an album is a long list and
   * `people.find` inside a `renderItem` is the sort of thing that is free at
   * five photographs and a dropped frame at three hundred.
   */
  const byline = useMemo(
    () => new Map((feed?.people ?? []).map((person) => [person.key, person])),
    [feed],
  );

  /**
   * How many comments each photograph has.
   *
   * Counted off the thread the album already has rather than asked for: a
   * comment is an event message with a `photo_id`, so the number is a pass over
   * a list that is already in hand. Built once, for the same reason the byline
   * is — `messages.filter` inside a `renderItem` is a walk of the whole
   * conversation per row.
   *
   * Tombstones do not count. A deleted comment leaves a row so the messages
   * either side of it do not appear to answer each other, and counting it would
   * put "1 comment" under a photograph whose only comment is gone.
   */
  const talk = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of feed?.messages ?? []) {
      if (!message.photoId || message.deleted) continue;
      counts.set(message.photoId, (counts.get(message.photoId) ?? 0) + 1);
    }
    return counts;
  }, [feed]);

  /**
   * The photographs by id, for the comments that are about one.
   *
   * A map rather than a `find` inside the row: the board is one list and the
   * album is another, and scanning the second for every row of the first is
   * the shape that is fine at four photographs and visible at four hundred.
   *
   * `src` is the 320 rather than `card` or the full size — the thumbnail on a
   * comment is 52 points, and it is usually already in the cache because the
   * grid drew the same picture.
   */
  const photoById = useMemo(() => {
    const byId = new Map<string, FeedPhoto>();
    for (const photo of feed?.photos ?? []) byId.set(photo.id, photo);
    return byId;
  }, [feed]);

  /**
   * One photograph, into the camera roll.
   *
   * The sheet's Download Album asks first — how many, and whether the full
   * quality is worth the megabytes — because that question is about a hundred
   * files and a minute of waiting. One picture is not that question: it is a
   * second, it is a few megabytes, and asking is the whole cost of the action
   * doubled.
   *
   * The original rather than a rendition. Somebody saving a single photograph
   * wants the photograph, and the size argument that makes the smaller copies
   * worth offering in bulk does not apply to one.
   */
  const saveOne = useCallback(
    /**
     * Answers whether it landed, which the corner button has no use for and
     * the sheet does: a menu that stays open over the photograph after the one
     * thing you asked it for is done is a menu you have to dismiss twice.
     *
     * The acknowledgement is `savedNote`, not the dismissal. Closing on its
     * own would only mean "something happened", and something happening is
     * also what a failure looks like from there.
     */
    async (photo: FeedPhoto): Promise<boolean> => {
      setSavingOne(photo.id);
      try {
        const { saved } = await saveToCameraRoll(
          [{ id: photo.id, url: photo.original, mime: photo.mime }],
          () => {},
        );
        if (saved === 0) throw new Error('not saved');
        setSavedNote(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSavedNote(false), 2200);
        return true;
      } catch (err) {
        Alert.alert(
          'Could not save it',
          err instanceof Error && err.message.includes('Permission')
            ? err.message
            : 'Try again in a moment.',
        );
        return false;
      } finally {
        setSavingOne(null);
      }
    },
    [],
  );

  /**
   * A picture chosen here, waiting to be framed.
   *
   * Changing the cover used to be one gesture — pick, upload, done — and the
   * framing that the create screen offers was missing from the one place
   * somebody goes when they have decided the cover is wrong. So a photograph
   * picked here now goes through the same frame, and only then goes up.
   */
  const [framingCover, setFramingCover] = useState<string | null>(null);
  /** Whether the frame is open on the album's own photographs. */
  const [framingAlbum, setFramingAlbum] = useState(false);
  /**
   * Handing somebody the camera, or taking it back.
   *
   * Straight to a refresh rather than an optimistic flip: the roster is the
   * server's list and this writes to it, so the honest thing for the row to
   * show is what came back. It is one tap on a screen nobody is scrolling
   * fast, which is the case where a round trip is affordable and a local guess
   * that disagrees with the next poll is not.
   *
   * Approving somebody's open request happens on the server as a side effect —
   * a host who goes looking rather than waiting should not then find the same
   * question still sitting in their queue.
   */
  const setHost = useCallback(
    async (actorId: string, host: boolean) => {
      try {
        await api.setEventHost(event.id, actorId, host);
        await refresh();
      } catch {
        setQueueStatus('Could not change that — try again in a moment.');
      }
    },
    [api, event.id, refresh],
  );

  /** The album photograph on its way up as a cover, if one is. */
  const [sendingCover, setSendingCover] = useState(false);

  const sendCover = useCallback(
    async (uri: string, framing: CoverFraming, photoId?: string | null) => {
      const target = api.coverTarget(event.id, framing, photoId);
      try {
        await uploadCover(target.url, target.headers, uri);
        // The screen draws the cover now, so it has to be re-read: without this
        // you chose a photograph, nothing moved, and the only way to find out
        // whether it took was to leave and come back.
        await refresh();
      } catch {
        // Worth saying here, unlike on the create screen: there is no share
        // sheet to get on with, and somebody who just chose a picture is
        // watching for it to take.
        Alert.alert('Could not set the cover', 'Try again in a moment.');
      }
    },
    [api, event.id, refresh],
  );

  /**
   * The photographs this album can be fronted by, and which of them it is.
   *
   * `full` rather than the thumbnail the strip draws: the tile is 320 pixels
   * across and a cover cut from it would be a cover of a thumbnail. `card` is
   * the fallback for a photograph the deriver has not reached yet, and `src`
   * after that.
   */
  const coverChoices = useMemo(
    () =>
      (feed?.photos ?? []).map((photo) => ({
        id: photo.id,
        uri: photo.card ?? photo.src,
        full: photo.full,
      })),
    [feed?.photos],
  );

  /**
   * One of the album's own photographs, made into the cover.
   *
   * Down and back up, which looks wasteful and is the only thing available:
   * `apps/web/src/storage/index.ts` opens by saying, in capitals, that the app
   * tier is handed a storage client with no method that returns bytes — so
   * that no photograph can ever be routed through the Next.js origin. A "make
   * the cover out of photo X" endpoint would be exactly that route. The
   * download here is client ↔ storage, straight to a presigned URL, which is
   * the movement the invariant exists to preserve.
   *
   * The id goes up with it so the frame can be reopened on this picture next
   * time. See `coverTarget`.
   */
  const sendAlbumCover = useCallback(
    async (photoId: string, framing: CoverFraming) => {
      const photo = coverChoices.find((choice) => choice.id === photoId);
      if (!photo) return;
      setSendingCover(true);
      let file: Awaited<ReturnType<typeof fetchForCover>> | null = null;
      try {
        file = await fetchForCover(photo.full, photoId);
        await sendCover(file.uri, framing, photoId);
      } catch {
        Alert.alert('Could not set the cover', 'Try again in a moment.');
      } finally {
        // One upload's worth of file. `sendCover` has either sent it or
        // reported that it could not, and either way nothing reads it again.
        try {
          file?.delete();
        } catch {
          // A cache file that will not delete is the operating system's to
          // clear, and not worth a second error on top of the first.
        }
        setSendingCover(false);
      }
    },
    [coverChoices, sendCover],
  );

  /**
   * Framing the album's own photographs, rather than picking a new one.
   *
   * The `⋯` sheet's cover row used to open an alert whose first action opened
   * the camera roll — so "change the cover" meant "choose another picture",
   * every time, from a screen that could not show what the cover currently was
   * or where it sat. Nudging an existing cover a little to the left was not
   * something the product could do at all.
   *
   * It opens the frame directly now, on the photograph the cover was cut from,
   * at the position it was left at, with the rest of the album underneath to
   * try instead. `coverPhotoId` and `coverFraming` come down with the feed for
   * exactly this; both are null for a cover set before they were recorded, and
   * that falls back to the photograph the album leads with, centred — which is
   * what somebody is looking at anyway.
   *
   * The camera roll is gone from this path, and that is a real narrowing. Two
   * reasons, and the second is the one that decided it. A cover is a picture of
   * the evening and the evening is in the album, so reaching outside it is the
   * unusual case dressed as the default. And a cover taken from outside never
   * goes through the deriver, which is where the child-safety scan lives —
   * `schema.ts` names that as the one gap in the pipeline. A cover made from a
   * photograph already in the album has been scanned by construction.
   *
   * An album with nothing in it has nothing to offer, so that one still opens
   * the library: it is the only picture there could be.
   */
  const framer = useCallback(() => {
    if (coverChoices.length > 0) {
      setFramingAlbum(true);
      return;
    }
    void (async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        // Re-encoded out of the picker, which is most of the difference between
        // a two-megabyte request and a twelve-megabyte one. The server
        // re-encodes again, to the size it actually draws.
        quality: 0.8,
        exif: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      // Framed before it is sent, not after — there is no undo on a cover, and
      // the version everybody else sees would be the unframed one.
      setFramingCover(picked.assets[0].uri);
    })();
  }, [coverChoices.length]);

  /**
   * Taking the cover off, which is now its own row rather than an alert.
   *
   * It used to be the second action in the sheet the cover row opened, which
   * was the right shape while that sheet existed — the rare destructive action
   * one press further away than the ordinary one. The ordinary one is the frame
   * now and opens directly, so there is no sheet left to hide this in, and a
   * row of its own under the picture is where it belongs. Still asks first,
   * which the alert's `destructive` style was doing on its behalf.
   */
  const removeCover = useCallback(() => {
    Alert.alert(
      'Remove the cover?',
      'The album goes back to leading with its first photograph.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.removeCover(event.id);
              await refresh();
            } catch {
              Alert.alert('Could not remove the cover', 'Try again in a moment.');
            }
          },
        },
      ],
    );
  }, [api, event.id, refresh]);

  const messages = feed?.messages ?? [];

  /*
   * Where the unread mark sits.
   *
   * `null` until the first feed lands, and then set to whatever was already
   * there: a banner on opening an event would otherwise announce the entire
   * history of the conversation as new. After that it only moves forward, on
   * reaching the bottom of the thread.
   */
  useEffect(() => {
    if (feed && seen === null) setSeen(feed.messages.length);
  }, [feed, seen]);

  /**
   * The note itself, built once and drawn in two layers.
   *
   * Not a component and not two copies of the markup: the save is pressed from
   * the album and from inside the photograph's viewer, which is a modal, and a
   * view in this tree cannot be seen from inside one. So the element is made
   * here and placed on both sides of that boundary — see the two comments at
   * the placements.
   *
   * `pointerEvents="none"` throughout. It says a thing happened; it is not
   * something to press, and for two seconds it sits over the corner of
   * somebody's photograph.
   */
  const saved = savedNote ? (
    <View style={styles.savedShell} pointerEvents="none">
      <BlurView intensity={18} tint="light" style={styles.savedNote}>
        <Glyph name="download" size={15} color="#14171c" />
        <Text style={styles.savedText}>Saved to your photos</Text>
      </BlurView>
    </View>
  ) : null;

  const unread = seen === null ? 0 : Math.max(0, messages.length - seen);
  const latest = messages[messages.length - 1] ?? null;

  /*
   * The banner drops in and takes itself away.
   *
   * Six seconds is long enough to read one line and short enough that it is
   * not a bar across the top of somebody's photographs. Dismissing it does not
   * mark the thread read — the count is still on the Talk tab, which is where
   * it belongs; this is a notification, not the conversation.
   */
  useEffect(() => {
    if (unread === 0) return;
    setBannerGone(false);
    const timer = setTimeout(() => setBannerGone(true), 6000);
    return () => clearTimeout(timer);
  }, [unread, messages.length]);

  /*
   * Read, in both senses.
   *
   * The local `seen` is what clears the banner and the count on the tab while
   * this screen is open. The call to the server is what stops the Groups tab
   * showing this conversation as waiting the next time it is drawn — that mark
   * is durable and per-person, where `seen` lasts as long as the screen does.
   *
   * Failure is swallowed: not having recorded that you read something is not
   * worth an alert over a conversation you are looking at.
   */
  /*
   * The photographs the create flow chose, sent once.
   *
   * A ref rather than a dependency, because the guard is "this set, ever" and
   * not "this set, while the prop is unchanged": the effect re-runs when
   * `enqueue` is rebuilt, and without the latch a refresh would send them all a
   * second time. `resolveForUpload` turns ids into files the queue can send —
   * the picker deliberately carried neither.
   */
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !initialUpload?.length) return;
    sent.current = true;
    void (async () => {
      try {
        await enqueue(await resolveForUpload(initialUpload));
      } catch {
        // The album exists and the photographs are still on the phone. Add
        // photos is the way back to them, which is the same recovery as any
        // other upload that did not start.
        setQueueStatus('Could not start those uploads — use Add photos.');
      }
    })();
  }, [enqueue, initialUpload]);

  const markRead = useCallback(() => {
    setSeen(messages.length);
    void api.markEventRead(event.id, event.linkToken).catch(() => {});
  }, [api, event.id, event.linkToken, messages.length]);

  /*
   * The whole journey, as one fraction.
   *
   * Still uploading, plus uploaded and not yet through the deriver. When both
   * reach zero the batch is over and the bar goes — which is now the same
   * moment the album is actually full, rather than the moment the last byte
   * left the phone.
   */
  const outstanding = uploading + (feed?.arriving ?? 0);
  useEffect(() => {
    if (batch === null) return;
    if (outstanding > 0) {
      setProgress(Math.min(1, Math.max(0, (batch - outstanding) / batch)));
      return;
    }
    /*
     * Zero can mean "not told yet", so it is held rather than believed.
     *
     * `uploading` drops to zero the instant the last byte leaves, and the feed
     * at that moment is still the one fetched before any of this started — it
     * says `arriving: 0` because it was read before the rows existed. Believing
     * the sum straight away ended the batch on a stale answer: the bar vanished
     * partway with the album still empty, which is exactly what it looked like.
     *
     * Three seconds is longer than a refresh takes and shorter than anybody
     * would wait wondering. If something really is still coming, the poll below
     * will have said so by then and this never fires.
     */
    const settle = setTimeout(() => {
      setBatch(null);
      setProgress(null);
    }, 3000);
    return () => clearTimeout(settle);
  }, [batch, outstanding]);

  /*
   * Keep asking while anything is still being processed.
   *
   * The deriver takes a second or two per photograph and tells nobody when it
   * is done, so without this the album sits on whatever it knew when it opened
   * and only a pull-to-refresh moves it. Every two seconds while something is
   * arriving, and not at all otherwise: an album nobody is adding to must not
   * poll in somebody's pocket.
   */
  /*
   * Whether anything is still on its way, readable without re-subscribing.
   *
   * A ref rather than a dependency, and that distinction is the whole bug. This
   * condition was the interval's dependency list — but `uploading` is written
   * every 400ms while the queue runs, so the effect tore its timer down and
   * built a new one four hundred milliseconds into every two-second wait. It
   * never once reached the end of a cycle, so it never fired. What looked like
   * "polling stops after the first photograph" was polling that had never
   * started, with a single post-upload refresh doing all the work.
   */
  const stillComing = useRef(false);
  stillComing.current = uploading > 0 || (feed?.arriving ?? 0) > 0;

  /*
   * One timer, made once, for as long as the album is open.
   *
   * `refresh` is stable, so nothing re-renders this away: it ticks on its own
   * schedule and asks the ref each time whether there is any reason to look.
   * The tick costs a comparison when there is nothing coming, which is the
   * price of a poll that cannot be cancelled by the thing it is waiting for.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (stillComing.current) void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  /*
   * The seam under the cover, used as the progress bar.
   *
   * Animated rather than set, because the queue reports every 400ms and a line
   * that jumps in five steps reads as five separate events. `width` cannot go on
   * the native driver — only transforms can — which is acceptable for a 2pt view
   * that changes four times a second and never while a gesture is in flight.
   */
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(bar, {
      toValue: progress ?? 0,
      duration: 350,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [bar, progress]);

  /** This room's four verbs, for the thread that draws them. */
  const eventThread = useMemo(
    () => ({
      post: (body: string) => api.postMessage(event.id, body),
      edit: (id: string, body: string) => api.editMessage(id, body),
      remove: (id: string) => api.deleteMessage(id),
      react: (id: string, emoji: string) => api.react(id, emoji),
    }),
    [api, event.id],
  );

  /**
   * The link, on the clipboard.
   *
   * This was the OS share sheet, and the sheet is the more capable control —
   * it knows every app on the phone. What it is not is predictable: it takes a
   * second to appear, it covers the screen, and where it puts the link depends
   * on a grid of icons that is different on everybody's phone. The common case
   * is somebody who wants the link *in their hand* to paste into a conversation
   * they already have open.
   *
   * So: one tap, the link is copied, and the button says so. `copied` is what
   * makes that true — a copy with no visible consequence is indistinguishable
   * from a button that did nothing.
   */
  const [copied, setCopied] = useState(false);
  const copyLink = useCallback(() => {
    // The link alone. The name arrives with it — a shared link unfurls into a
    // card carrying the event's title, so putting it in the message body as
    // well says it twice.
    void Clipboard.setStringAsync(`${webBase}/e/${event.linkToken}`);
    setCopied(true);
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [event.linkToken, webBase]);

  /**
   * Ending the album, and stepping out of it.
   *
   * Two actions that look alike in a menu and are nothing alike: one takes the
   * evening away from everybody who was there, the other takes this person off
   * a list. They are never offered together — the host sees the first, everyone
   * else the second — because a row whose meaning depends on who is reading it
   * is a row somebody will misread.
   *
   * Both confirm, and the destructive one says what it costs in photographs.
   * Both leave by `onBack`, which re-reads the event list, so the album is gone
   * from the home screen rather than sitting there until something else
   * refreshes it.
   */
  const deleteAlbum = useCallback(() => {
    const count = feed?.photos.length ?? 0;
    Alert.alert(
      `Delete ${event.name}?`,
      count > 0
        ? `This takes the album and its ${count} ${count === 1 ? 'photo' : 'photos'} away from everybody in it. It cannot be undone.`
        : 'This takes the album away from everybody in it. It cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteEvent(event.id);
              onBack();
            } catch {
              Alert.alert('Could not delete it', 'Try again in a moment.');
            }
          },
        },
      ],
    );
  }, [api, event.id, event.name, feed, onBack]);

  const leaveAlbum = useCallback(() => {
    Alert.alert(
      `Leave ${event.name}?`,
      'It comes off your list. Photographs you added stay — they belong to the evening. If it is public the link still works, so you can come back.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const { throughGroup } = await api.leaveEvent(event.id);
              onBack();
              /*
               * The half of leaving that is not this album's to give.
               *
               * An album inside a group reaches the home screen through the
               * membership, not through the participant row — so the row going
               * is real and the album is still there. Said here rather than
               * left to be discovered on the next pull to refresh, which is
               * where it reads as the Leave button having failed.
               */
              if (throughGroup) {
                Alert.alert(
                  'Still in your list',
                  `${event.name} belongs to a group you are in, so it stays on your home screen. Leaving the group is what takes it off.`,
                );
              }
            } catch {
              Alert.alert('Could not leave', 'Try again in a moment.');
            }
          },
        },
      ],
    );
  }, [api, event.id, event.name, onBack]);

  /**
   * Asking to be one of the people who may add.
   *
   * Held locally as well as read off the feed, for the reason the visibility
   * pills are: one round trip is long enough for a tap to feel ignored, and
   * the feed that would carry the answer is on a poll. `null` means "whatever
   * the server says", which is the state on every load.
   *
   * The server's answer is what lands, not an assumed `open`: a repeat ask on
   * something already declined comes back `declined` rather than reopening it,
   * and a line that said "Asked" over that would be pressing past somebody's
   * no on their behalf.
   */
  const askToHost = useCallback(async () => {
    setAskingToHost(true);
    try {
      const body = await api.askToHost(event.id);
      setHostAsk((body.status as 'open' | 'approved' | 'declined') ?? 'open');
      // Approved happens when the host had already promoted them and the feed
      // had not come round yet — the album can be added to now, and the poll
      // would take its time saying so.
      if (body.status === 'approved') void refresh();
    } catch {
      setQueueStatus('Could not ask just now — try again in a moment.');
    } finally {
      setAskingToHost(false);
    }
  }, [api, event.id, refresh]);

  /** Whichever way in `+` takes: the picker, or the account it first needs. */
  const add = useCallback(() => {
    if (signedIn === false) return setGateOpen(true);
    void addPhotos();
  }, [addPhotos, signedIn]);


  /** The evening this was, for the line under the name. */
  const when = dateLabel(
    feed?.event.startsAt ??
      event.startsAt ??
      (feed?.photos.length
        ? feed.photos.reduce((oldest, p) => (p.takenAt < oldest ? p.takenAt : oldest), feed.photos[0]!.takenAt)
        : null),
  );

  const visible = (policy ?? feed?.event.accessPolicy) ?? 'public';

  const tabs = (
    <Segmented
      pane={pane}
      unread={unread}
      onPane={(next) => {
        setPane(next);
        // Arriving on the thread is half of having read it; reaching the
        // bottom is the other half and the list says when that happens.
        if (next === 'talk' && messages.length === 0) markRead();
      }}
      t={t}
      dark={dark}
    />
  );

  const { width } = useWindowDimensions();

  /**
   * Which of the two views of the photographs is showing.
   *
   * The grid is the default and sits on the left, because it is the view that
   * answers "what is in here" — a screenful is nine photographs rather than
   * one, and somebody opening an album they have already seen is usually
   * looking for a particular picture. The column is one photograph per row at
   * the width of the screen, which is looking rather than finding.
   *
   * Both of these shipped at different times as *the* view, and the argument
   * for each was right about a different moment. Keeping both and making the
   * choice a swipe is cheaper than being right about which moment matters more.
   */
  const [view, setView] = useState<'grid' | 'column'>('grid');
  const pager = useRef<ScrollView | null>(null);
  const gridList = useRef<FlatList<FeedPhoto> | null>(null);
  const columnList = useRef<FlatList<FeedPhoto> | null>(null);

  /**
   * The photograph at the top of whichever view is showing.
   *
   * Kept so that swiping between the two lands on the same pictures. Without
   * it, a swipe at photograph 90 of 200 arrives at the top of the other view,
   * which reads as the gesture having reloaded the album.
   *
   * A ref rather than state: it changes on every scroll frame and nothing
   * renders from it.
   */
  const anchor = useRef(0);
  const onSeen = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      const first = viewableItems[0]?.index;
      if (typeof first === 'number') anchor.current = first;
    },
    [],
  );

  /*
   * Uniform rows in both views, which is what lets either be scrolled to an
   * index it has not drawn.
   *
   * The column's rows are the screen's width at 4:5 plus the gap; the grid's
   * are a third of the width, square, plus the same gap. Without
   * `getItemLayout`, `scrollToIndex` warns rather than arrives.
   */
  const columnRow = width * (5 / 4) + PHOTO_GAP;
  /*
   * One tile, measured rather than flexed.
   *
   * `gridTile` was `flex: 1`, which is right for every row but the last one
   * and wrong there: `numColumns` does not pad a short final row, so an album
   * of seven photographs ended with a single tile taking the whole width of
   * the screen — a square the size of three, at the foot of a contact sheet.
   * Two left over were half a screen each. Giving the tile a width makes the
   * last row start at the left and stop where it runs out, which is what a
   * grid does.
   *
   * The gaps come out of the width before it is divided. They did not before,
   * and the row height `getItemLayout` promised was `width / 3 + PHOTO_GAP`
   * against an actual `(width - 2 * PHOTO_GAP) / 3` — five points of drift per
   * row, compounding down a long album until `scrollToIndex` landed somewhere
   * else. One number now, and both readings take it from here.
   */
  const gridTile = (width - PHOTO_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const gridRowHeight = gridTile + PHOTO_GAP;
  const columnLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: columnRow,
      offset: columnRow * index,
      index,
    }),
    [columnRow],
  );
  const gridLayout = useCallback(
    (_data: unknown, index: number) => {
      // By row, because `numColumns` puts three items at one offset.
      const row = Math.floor(index / GRID_COLUMNS);
      return { length: gridRowHeight, offset: gridRowHeight * row, index };
    },
    [gridRowHeight],
  );

  /**
   * Go to one of the two views, from the control under the tabs.
   *
   * Scrolls the pager rather than setting the state directly, so that the two
   * ways in agree by construction: the animation lands on `onPaged`, which is
   * what carries the anchor across to the list arriving — pressing and swiping
   * therefore do exactly the same thing, rather than the button being a
   * shortcut that skips the half of the work somebody would notice missing.
   */
  const showView = useCallback(
    (which: 'grid' | 'column') => {
      pager.current?.scrollTo({ x: which === 'column' ? width : 0, animated: true });
    },
    [width],
  );

  /**
   * The swipe has landed: say which view it landed on, and go to the pictures
   * that were on screen when it started.
   *
   * Only the list that has just come into view is moved. The one being left is
   * about to be off screen, and scrolling it would be a jump nobody sees.
   */
  const onPaged = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const next = event.nativeEvent.contentOffset.x > width / 2 ? 'column' : 'grid';
      setView(next);
      const list = next === 'column' ? columnList.current : gridList.current;
      const count = feed?.photos.length ?? 0;
      if (!list || anchor.current <= 0 || anchor.current >= count) return;
      list.scrollToIndex({ index: anchor.current, animated: false });
    },
    [feed?.photos.length, width],
  );

  /**
   * One photograph as a tile, a third of the screen across.
   *
   * `card` rather than `grid`: a tile is about 130 points, which is 390 device
   * pixels on a 3× phone, and the 1280 the column needs is four times more file
   * than this slot can show. Square and cropped, which is the trade a contact
   * sheet makes — and the reason the column is a swipe away rather than gone.
   */
  const renderTile = useCallback(
    ({ item }: { item: FeedPhoto }) => {
      const who = item.by ? byline.get(item.by) : undefined;
      return (
        <Pressable
          style={{ width: gridTile, height: gridTile }}
          onPress={() => setSelected(item)}
        >
          <ExpoImage
            source={{ uri: item.card ?? item.src }}
            style={styles.gridShot}
            contentFit="cover"
            transition={120}
          />
          {/*
            Whose photograph it is, and nothing else.

            The column says it with a face and a handle; a tile is a third of
            the screen and the handle does not fit — at 129 points "kostopoulou"
            is either four pixels tall or most of the picture. The face alone
            still answers the question this view makes hardest to answer, which
            is "who took all of these": a contact sheet of two hundred
            photographs by five people is five colours repeating down it, and
            the pattern is legible long before any single face is.

            Not a control. A 16pt target inside a 129pt tile is a place where
            the tile stops opening the photograph for no reason a thumb can
            predict, so this is decoration and the whole tile stays one press.
          */}
          {who && (
            <View pointerEvents="none" style={styles.gridBy}>
              {who.avatarUrl ? (
                <ExpoImage
                  source={{ uri: who.avatarUrl }}
                  style={styles.gridFace}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View
                  style={[
                    styles.gridFace,
                    styles.gridFaceBlank,
                    { backgroundColor: lensFor(who.key).fill },
                  ]}
                >
                  <Text style={[styles.gridInitial, { color: lensFor(who.key).ink }]}>
                    {initialOf(who.name)}
                  </Text>
                </View>
              )}
            </View>
          )}
        </Pressable>
      );
    },
    [byline, gridTile],
  );

  /**
   * One photograph, the width of the screen.
   *
   * Lifted out of the list so the two views can share it. The grid draws a
   * tile instead — see `renderTile` — and what the two have in common is the
   * photograph, not the furniture round it.
   */
  const renderColumn = useCallback(
    ({ item }: { item: FeedPhoto }) => {
        const who = item.by ? byline.get(item.by) : undefined;
        const added = shortDate(item.addedAt);
        /*
         * What has happened to this photograph, if anything has.
         *
         * Only the halves that are not zero, and no line at all when
         * both are: "0 comments" under every picture in a quiet album
         * is a column of nothing, and it is worse than nothing because
         * it makes the pictures people *have* said something about
         * harder to pick out.
         */
        const said = [
          talk.get(item.id)
            ? `${talk.get(item.id)} ${talk.get(item.id) === 1 ? 'comment' : 'comments'}`
            : null,
          item.reactions.length
            ? `${item.reactions.length} ${item.reactions.length === 1 ? 'reaction' : 'reactions'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Pressable style={styles.tile} onPress={() => setSelected(item)}>
            {/*
              The 1280 now that a row is the whole width of the screen:
              393 points is 1179 device pixels on a 3× phone, and the 640
              that was right for a third of a row cannot fill one. Both
              fall back the same way — each is null only until the
              deriver has been round, and `src` is then all there is.
            */}
            <ExpoImage
              source={{ uri: item.grid ?? item.card ?? item.src }}
              style={styles.thumb}
              contentFit="cover"
              transition={120}
            />

            {/*
              Just enough shadow in the two corners to carry white.

              Top and bottom only, and weaker than the cover's: these
              are the photographs themselves rather than a header, and
              darkening one to label it is the product having an opinion
              about somebody's picture. Clear through the middle, which
              is most of it.
            */}
            <LinearGradient
              colors={['rgba(0,0,0,0.34)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.34)']}
              locations={[0, 0.32, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            {/*
              Whose it is, top left.

              An album is several people's photographs in one column and
              it never said which was whose — the People pane counted
              them and the grid attributed none of them. The handle
              rather than the display name: a column of names reads as
              captions, a column of handles reads as attribution.
            */}
            {who && (
              /*
                The byline goes to the person, the rest of the row goes
                to the photograph.

                Nested inside the row's own `Pressable`, which is what
                makes both work: the inner one takes the touch when it
                lands on the face or the handle, and the outer one takes
                everything else. It stopped being `pointerEvents="none"`
                for exactly this.

                Only when there is a handle. Somebody who arrived by
                link and added photographs has a name and a face here
                and no profile to open, and a control that does nothing
                is worse than a label that never offered.
              */
              <Pressable
                onPress={
                  who.handle ? () => onOpenPerson(who.handle!) : undefined
                }
                disabled={!who.handle}
                accessibilityRole={who.handle ? 'button' : 'text'}
                accessibilityLabel={
                  who.handle
                    ? `${who.handle}, see their profile`
                    : who.name
                }
                hitSlop={6}
                style={styles.tileBy}
              >
                {who.avatarUrl ? (
                  <ExpoImage
                    source={{ uri: who.avatarUrl }}
                    style={styles.tileFace}
                    contentFit="cover"
                    transition={120}
                  />
                ) : (
                  <View
                    style={[
                      styles.tileFace,
                      styles.tileFaceBlank,
                      { backgroundColor: lensFor(who.key).fill },
                    ]}
                  >
                    <Text
                      style={[styles.tileInitial, { color: lensFor(who.key).ink }]}
                    >
                      {initialOf(who.name)}
                    </Text>
                  </View>
                )}
                <Text style={styles.tileHandle} numberOfLines={1}>
                  {who.handle ?? who.name}
                </Text>
              </Pressable>
            )}

            {/*
              When it arrived, opposite the person who added it.

              It sat inside the byline, on the argument that who and
              when are one fact. They are — but they are one fact of
              very different weights: the handle is what you read, and
              the date is what you check. In the same line the date rode
              on the end of a name that can be any length, so it landed
              somewhere different on every row and the column had no
              edge. Pinned to the corner it is a column you can run your
              eye down, which is the only way a date in a grid is worth
              anything.
            */}
            {added && (
              <Text style={styles.tileWhen} pointerEvents="none">
                {added}
              </Text>
            )}

            {/*
              What people have done with it, bottom left.

              Words rather than glyphs and a number. Two counts in the
              corner of a photograph are read once, if at all, and
              "3 comments" is legible at a glance where a speech bubble
              with a 3 beside it asks somebody to decode two symbols
              first. There is room: the row is the width of the screen.
            */}
            {said !== '' && (
              <Text style={styles.tileSaid} pointerEvents="none" numberOfLines={1}>
                {said}
              </Text>
            )}

            {/*
              And a way to keep it, bottom right.

              Saving one photograph out of somebody else's evening is
              the common case and it had no control at all: the only way
              was Download Album, which is the whole thing and a
              question about megabytes first.
            */}
            <Pressable
              onPress={() => void saveOne(item)}
              disabled={savingOne !== null}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={
                savingOne === item.id ? 'Saving' : 'Save this photo'
              }
              style={({ pressed }) => [
                styles.tileSave,
                { opacity: savingOne === item.id ? 0.5 : pressed ? 0.6 : 1 },
              ]}
            >
              <Glyph name="download" size={18} color="#fff" />
            </Pressable>
          </Pressable>
        );
    },
    [byline, onOpenPerson, savingOne, saveOne, t, talk],
  );

  /*
   * The auto-select sheet, which has to be decided *after* every hook above.
   *
   * This branch used to sit thirty lines into the component, ahead of a dozen
   * of them. Opening the sheet therefore rendered this screen with a dozen
   * hooks fewer than the render before it, and React — which matches hooks by
   * position, not by name — refuses a render that runs fewer than the last
   * one. The screen the `+` button opens was the render that could not happen.
   *
   * It reads worse here, further from the thing it replaces. That is the
   * trade: an early return in a component is only early in the source, never
   * in the hooks.
   */
  if (autoWindow) {
    return (
      <AutoSelect
        window={autoWindow}
        theme={t}
        onCancel={() => setAutoWindow(null)}
        /*
          The way out of the guess and into the whole camera roll.

          Granting the library turned the `+` into this screen and nothing
          else, so an album whose window holds none of your photographs — a
          weekend added to on the Tuesday, an evening somebody else set the
          dates of, a phone whose clock was wrong — ended at "Nothing from
          this time on this phone" with a Cancel under it. The picker was
          still there in the code; it was simply unreachable for anybody the
          permission had been granted by, which is everybody the feature was
          built for.
        */
        onPickManually={() => {
          setAutoWindow(null);
          void pickFromLibrary();
        }}
        onShown={(preselected, candidates) =>
          api.observe({
            kind: 'autoselect_shown',
            eventId: event.id,
            count: preselected,
            outOf: candidates,
          })
        }
        onConfirm={async (assetIds, preselected) => {
          setAutoWindow(null);
          // How much of the suggestion survived. `outOf` is what was ticked
          // when the screen opened, not what was offered — precision is about
          // the guess, and someone adding photos the guess missed should not
          // read as the guess having been right.
          api.observe({
            kind: 'autoselect_confirmed',
            eventId: event.id,
            count: assetIds.filter((id) => preselected.includes(id)).length,
            outOf: preselected.length,
          });
          await enqueue(await resolveForUpload(assetIds));
        }}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/*
        One head, and the tabs under it, for all three panes.

        The photographs got the cover; the conversation and the roster got a
        folded-up version of it — a 38pt thumbnail, the name and a count, on a
        bar. Two headers for one album, so moving between the tabs rebuilt the
        top of the screen: the cover appeared and vanished, the title changed
        size, and the album looked like a different screen depending on which
        of its tabs was up. One cover now, and only what is below the tabs
        changes, which is what a tab is for.
      */}
      {/* White ink over the cover, for as long as the cover is what is
          under the clock. */}
      <StatusBar style="light" />

      <View style={styles.cover}>
        {cover ? (
          /*
            The photograph, brightened and then put behind glass — the image and
            the treatment are one component because the order of the two is the
            whole of it. See `CoverGlass`.

            Below the scrim, which still carries the title and the corner discs:
            the glass makes those legible in the common case and the gradient is
            what makes them legible in every case.
          */
          <CoverGlass uri={cover} />
        ) : (
          // Nothing chosen and nothing to borrow — an album nobody has put a
          // photograph in yet. The event's own lens, which is the same
          // letter-on-a-colour every other doorless thing in the product gets.
          // No glass over it: there is nothing behind a flat colour to obscure,
          // and blurring one is work that changes no pixel.
          <View style={{ flex: 1, backgroundColor: lensFor(event.id).fill }} />
        )}

        {/*
          Dark at the top and the bottom, clear through the middle.

          Not a flat wash: what has to be legible is the clock and the back
          arrow at the top and the title at the foot, and darkening the
          whole photograph to carry four words would be the product
          deciding that somebody's cover is a texture. The middle stop is
          at 45%, which is where the two gradients meet without either
          reaching the other.
        */}
        <LinearGradient
          colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/*
          What is still landing, along the bottom edge of the cover.

          It sat on the top edge of the page below, which is sixteen points
          further down — so it read as a line floating in the gap rather than as
          part of anything. The cover's own edge is a line somebody already
          sees, so colouring that in costs no room and adds no furniture.

          White rather than the accent: it lies on a photograph, which can be
          any colour at all, and the scrim at the foot of the cover is already
          there to make white legible — it is what the title and the faces above
          it rely on.

          Null progress draws nothing rather than an empty track, because an
          unfilled bar under every album would be a permanent promise of
          something happening.
        */}
        {/*
          The last few points of the header, given back to the page.

          The glass ended on a line: a panel, an edge, and then the tabs. Fading
          the foot of it into the page's own colour means the header stops
          without a boundary to notice — the same trick the scrim above it plays
          in the other direction, and short enough that it reads as the panel
          ending rather than as a band across the bottom of it.

          After the scrim rather than before. The scrim's bottom stop is dark,
          so drawn over this it would put the shadow back on top of the fade and
          the edge would return underneath it.
        */}
        <LinearGradient
          colors={[t.bgClear, t.bg]}
          /*
            Clear for the first six points, then four points of ramp.

            An even fade across the whole band is a soft edge, which reads as
            the panel being out of focus rather than as it ending. The bias
            keeps the glass looking like glass almost all the way down and then
            resolves — a crisp edge that happens to have no line in it, which is
            the thing an even ramp cannot be.

            0.6 rather than the 0.34 it was: the band is already as short as it
            can usefully be, so compressing the transition inside it is the only
            room left. Much past this and there is not enough ramp for a ramp,
            and the line comes back — which is what all of this exists to
            remove.
          */
          locations={[0.6, 1]}
          style={styles.coverFoot}
          pointerEvents="none"
        />

        {progress !== null && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.uploadBar,
              { backgroundColor: t.accent },
              {
                width: bar.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        )}
      </View>

      {/*
        The two corners, in the disc every other corner in the product uses.

        Back was `‹ All events` — words, on a photograph, with nothing behind
        them — and the options were a dark blur circle. The blur was the careful
        answer to sitting on somebody's picture, and the trouble with it is that
        it only works while the ink is white, so these two could never match the
        two on the profile. A filled disc solves the same problem the way the
        rest of the product already does.

        And the words go with it: `All events` was describing where the back
        button went, which is the one thing a back button never needs to say.
      */}
      <RoundButton
        t={t}
        onPress={onBack}
        accessibilityLabel="Back to your albums"
        style={styles.coverBack}
      >
        <Back color={t.fg} />
      </RoundButton>

      {/*
        Everything this screen used to stack, behind one glyph.

        Eight full-width slabs sat between the name and the first photograph —
        share, save, who can see it, the cover, asking people in, starting a
        group — so that opening an album showed you a column of settings and, if
        you scrolled, some photographs. They are the same actions with the same
        copy and the same calls; they are in a sheet now, which is where an
        album's settings go.
      */}
      <RoundButton
        t={t}
        onPress={() => setSheetOpen(true)}
        accessibilityLabel="Album options"
        style={styles.coverMore}
      >
        <More color={t.fg} />
      </RoundButton>

      <View style={styles.coverTitle} pointerEvents="box-none">
        {/*
          The feed's name before the route's.

          `event` is the summary this screen was opened with — a copy made when
          the album was first reached, which does not move when somebody
          renames it. Now that renaming happens on this screen, taking the name
          from the copy would leave the header showing the old one until you
          left and came back.
        */}
        <Text style={styles.coverName} numberOfLines={2}>
          {feed?.event.name ?? event.name}
        </Text>
        <View style={styles.coverMeta}>
          <Faces members={feed?.members ?? []} />
          <View style={styles.coverMetaLine}>
            <Text style={styles.coverMetaText}>
              {feed
                ? `${feed.count} ${feed.count === 1 ? 'photo' : 'photos'}`
                : (feedError ?? 'Loading…')}
              {when ? ` · ${when} · ` : ' · '}
            </Text>
            {/*
              Who can see it, as a picture. An open padlock on a public
              album and a closed one on a private album, in the line
              somebody reads immediately before handing the link on — which
              is the moment the answer matters and the only moment it was
              previously given, three slabs down, in a paragraph.
            */}
            <Glyph
              name={visible === 'private' ? 'locked' : 'unlocked'}
              size={15}
              color="rgba(255,255,255,0.92)"
            />
          </View>
        </View>
      </View>

      <View style={[styles.page, { backgroundColor: t.bg }]}>
        <View style={styles.tabRow}>
          {tabs}
          {/*
            Dimmed on the server's answer about *this* reader, not on a fact
            about the album.

            It read `uploadsOpen`, which is a property of the album and was the
            same for everybody. With three settings that stops being true: on a
            host-only album everybody would have been offered the button and
            refused on the way up, which is the shape of failure that teaches
            people the app is unreliable rather than that the album is closed.

            `feed` is null on the first frame, and `canAdd` is undefined then.
            Left enabled in that moment on purpose: a control that starts
            disabled and enables itself is a control somebody has already
            decided does not work.
          */}
          <Pressable
            onPress={add}
            disabled={feed ? !feed.canAdd : false}
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: t.card,
                borderColor: t.line,
                opacity: feed && !feed.canAdd ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Glyph name="plus" size={18} color={t.fg} />
          </Pressable>
        </View>

        {pane === 'photos' ? (
          <>
            {/*
              Why the `+` is dim, and the one thing to do about it.

              A disabled button with no sentence beside it is the app looking
              broken: the reader can see the album, can talk in it, and cannot
              work out why the one control they came for is greyed. Saying
              "hosts add the photographs here" is the difference between a
              refusal and a rule.

              Only where asking is actually a thing — `canAsk` is the server's
              answer, not a guess off `contributePolicy`, so an album set to
              "Only me" says its piece and offers nothing, which is correct:
              there is no set to join and a button to ask would make "Only me"
              something its owner has to keep defending.

              Declined stays declined, and it reads as the album's rule rather
              than as a verdict. Telling somebody they were turned down is the
              host's to do, not the screen's — the same reasoning a friend
              request follows.
            */}
            {feed && !feed.canAdd && feed.hosting.canAsk && (
              <View style={styles.queueLine}>
                <Text style={[styles.queueText, { color: t.dim }]}>
                  {hostAsk === 'open' || feed.hosting.asked === 'open'
                    ? 'Asked to be a host. You can add photos once that is answered.'
                    : 'Hosts add the photographs here.'}
                </Text>
                {hostAsk !== 'open' && feed.hosting.asked !== 'open' && (
                  <Pressable
                    onPress={() => void askToHost()}
                    hitSlop={8}
                    disabled={askingToHost}
                    accessibilityRole="button"
                    accessibilityLabel="Ask to be a host of this album"
                  >
                    <Text
                      style={[styles.queueDo, { color: t.accent, opacity: askingToHost ? 0.5 : 1 }]}
                    >
                      Ask to be a host
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/*
              The lines between the tabs and the grid: an upload in flight, and
              the one offer that is made after a contribution rather than in
              front of it.

              Most of these go away on their own. The one that does not is a
              failure, and it used to have nothing under it — `failed` is
              terminal after four attempts and nothing but `done` is pruned, so
              "6 didn't upload" sat there through every later run with nothing
              to press and nothing to dismiss. That is not a report, it is a
              scar, and a permanent line is one people learn to read past.
            */}
            {queueStatus && (
              <View style={styles.queueLine}>
                <Text style={[styles.queueText, { color: t.dim }]}>
                  {queueStatus}
                  {waitingForNetwork
                    ? // Nothing is lost and nothing needs doing. Saying this
                      // plainly is the difference between someone waiting and
                      // someone force-quitting the app on their photos.
                      ' — they are saved and will go up on their own.'
                    : !BACKGROUND_UPLOAD_SUPPORTED &&
                      stuck.failed === 0 &&
                      stuck.stale === 0 &&
                      ' — keep the app open until this finishes'}
                </Text>

                {/*
                  One remedy, chosen by which kind of stuck this is.

                  A failed item wants another attempt: the condition that beat
                  it may be gone, and pressing this is the new information that
                  earns a fresh set of attempts. A stale one wants the opposite
                  — its bytes are gone, another four attempts would find them
                  just as gone, and the only honest thing to offer is to let it
                  go. The photographs are in the camera roll either way.
                */}
                {stuck.failed > 0 ? (
                  <Pressable
                    onPress={() => void retryStuck()}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Try again with ${stuck.failed} ${stuck.failed === 1 ? 'photo' : 'photos'}`}
                  >
                    <Text style={[styles.queueDo, { color: t.accent }]}>Try again</Text>
                  </Pressable>
                ) : (
                  stuck.stale > 0 && (
                    <Pressable
                      onPress={() => void forgetStuck()}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Stop asking about these"
                    >
                      <Text style={[styles.queueDo, { color: t.accent }]}>Never mind</Text>
                    </Pressable>
                  )
                )}
              </View>
            )}

            {offerUpgrade && (
              <View
                style={[styles.upgrade, { backgroundColor: t.card, borderColor: t.line }]}
              >
                <Text style={[styles.body, { color: t.fg }]}>
                  Next time we can find them for you — pick out the photos from
                  the evening so you do not have to scroll. Your photos stay on
                  your phone; only the ones you choose are uploaded.
                </Text>
                <Button
                  label="Let it find them"
                  t={t}
                  primary
                  onPress={async () => {
                    setAccess(await requestLibraryAccess());
                    setOfferUpgrade(false);
                  }}
                />
                <Button label="Not now" t={t} onPress={() => setOfferUpgrade(false)} />
              </View>
            )}

            {/*
              One photograph per row, the width of the screen.

              It was a three-column grid of 121pt squares, which is a contact
              sheet: good for finding a photograph you already know is in
              there, and nothing at all like looking at one. Every square was
              also a crop — `contentFit="cover"` on a 1:1 tile throws away the
              ends of everything anybody shot in portrait.

              A column of full-width pictures is what the home screen does with
              evenings, and this is the same argument one level down: the
              photograph is the thing, so it gets the width. Square corners and
              no side gutter for the same reason the cards have none.
            */}
            {/*
              Which view is showing — and, now, how to change it.

              It was two 4pt bars with the one you were on filled: an indicator
              rather than a control, on the reasoning that the gesture is the
              swipe and this only had to say the swipe existed. It never did
              say that. A short mark under a row of tabs is read as a tab
              underline, which is a thing that *reports* where you are, so
              nobody learned there was a second view to reach.

              Two glyphs, each a small drawing of the layout it opens — a
              2×2 of squares, and one tall frame. The literal icon is the right
              one here for once: both views hold the same photographs and
              differ only in how they are laid out, so a diagram of the layout
              is a complete description.

              And they are pressable, which is the other half of the fix. The
              swipe still works and is still the faster way; a control that
              names the two views is what makes somebody try it.
            */}
            <View style={styles.viewBar}>
              <View style={styles.viewTrack}>
                {(
                  [
                    ['grid', 'grid', 'Grid'],
                    ['column', 'portrait', 'One at a time'],
                  ] as const
                ).map(([which, glyph, label]) => (
                  <Pressable
                    key={which}
                    onPress={() => showView(which)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: view === which }}
                    accessibilityLabel={label}
                    style={styles.viewSegment}
                  >
                    <Glyph
                      name={glyph}
                      size={18}
                      /* The same pairing the tab bubble uses: the one you are
                         on steps up to `fg` and gains half a unit of stroke,
                         because at 18 points a change of value alone is easy
                         to miss. */
                      weight={view === which ? 2.4 : 1.8}
                      color={view === which ? t.fg : t.dim}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {/*
              Two views of the same photographs, side by side.

              A horizontal pager rather than a control that swaps the list:
              swiping between them is the gesture the bar above describes, and
              it is the one that makes the two feel like two views of one thing
              rather than two screens. `pagingEnabled` does the snapping.
            */}
            <ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onPaged}
              style={styles.pager}
            >
              <View style={{ width }}>
                <FlatList
                  ref={gridList}
                  numColumns={GRID_COLUMNS}
                  columnWrapperStyle={styles.gridRow}
                  getItemLayout={gridLayout}
                  onViewableItemsChanged={onSeen}
                  data={feed?.photos ?? []}
                  keyExtractor={(photo) => photo.id}
                  contentContainerStyle={styles.gridContent}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      tintColor={t.dim}
                      onRefresh={async () => {
                        setRefreshing(true);
                        await refresh();
                        setRefreshing(false);
                      }}
                    />
                  }
                  ListEmptyComponent={
                    feed ? (
                      <Text style={[styles.body, { color: t.dim, padding: 28 }]}>
                        Nothing here yet. Add yours and everyone else will see there
                        is something to add to.
                      </Text>
                    ) : null
                  }
                  renderItem={renderTile}
                />
              </View>

              <View style={{ width }}>
                <FlatList
                  ref={columnList}
                  getItemLayout={columnLayout}
                  onViewableItemsChanged={onSeen}
                  data={feed?.photos ?? []}
                  keyExtractor={(photo) => photo.id}
                  contentContainerStyle={styles.gridContent}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      tintColor={t.dim}
                      onRefresh={async () => {
                        setRefreshing(true);
                        await refresh();
                        setRefreshing(false);
                      }}
                    />
                  }
                  ListEmptyComponent={
                    feed ? (
                      <Text style={[styles.body, { color: t.dim, padding: 28 }]}>
                        Nothing here yet. Add yours and everyone else will see there
                        is something to add to.
                      </Text>
                    ) : null
                  }
                  renderItem={renderColumn}
                />
              </View>
            </ScrollView>
          </>
        ) : pane === 'talk' ? (
          <Thread
            actions={eventThread}
            /*
              Null until the feed lands, not an empty conversation.

              `messages` is `feed?.messages ?? []` because every other reader
              of it wants a list to count — but handing that to the thread made
              the album's Talk pane claim "nothing has been said here" for the
              length of the first request, and then contradict itself when the
              feed arrived.
            */
            messages={feed ? messages : null}
            canPost={feed?.canPost ?? false}
            /*
             * And the photograph a comment is about, where it is about one.
             *
             * The board and the photo viewer are two ways into one thread —
             * a comment written under a picture is a line here carrying that
             * picture's id. Without this the board drew the line and dropped
             * the subject, so "look at her face in this one" arrived with no
             * *this one* in it.
             */
            photoOf={(photoId) => {
              const photo = photoById.get(photoId);
              return photo ? { id: photo.id, src: photo.src } : null;
            }}
            // Tapping it opens that photograph, which is the other half: the
            // comment says which picture, and the picture is one tap away.
            onOpenPhoto={(photoId) => {
              const photo = photoById.get(photoId);
              if (photo) setSelected(photo);
            }}
            // This event's contributors and nobody else — the rule the web's
            // mention list follows, and the reason it is safe for a text
            // field a link-holder can type into.
            people={(feed?.people ?? []).map((person) => ({
              key: person.key,
              name: person.name,
              mine: person.mine,
            }))}
            t={t}
            // The pane starts below the cover, and `KeyboardAvoidingView`
            // measures from its own parent — so the composer needs telling how
            // far down the screen it really is or the keyboard covers it.
            keyboardOffset={PAGE_TOP}
            onChanged={refresh}
            onSeen={markRead}
          />
        ) : (
          <People
            roster={feed?.roster ?? []}
            t={t}
            canAdminister={feed?.event.canAdminister ?? false}
            /*
              The live setting, so the control appears the moment the sheet
              above changes it rather than one poll later — and disappears
              again if it is changed back. `adding` is the local guess the
              pills answer with; the feed is the truth once it lands.
            */
            hosted={(adding ?? feed?.event.contributePolicy) === 'host'}
            onSetHost={(actorId, host) => void setHost(actorId, host)}
          />
        )}
      </View>

      {/*
        In the album's own layer, and only while nothing is in front of it.

        The same rule the cover frame and the photograph's `⋯` sheet both
        follow: on iOS a view in this tree is *behind* a full-screen modal, so
        a note drawn here while the viewer is up would be invisible — and the
        viewer is exactly where one of the two saves is pressed. It is drawn
        again inside that modal, below.
      */}
      {!selected && saved}

      {/*
        One line, over the cover, when somebody says something while you
        are looking at the photographs. It is the whole of the notification
        this screen needs: who, what they said, and how many are waiting.

        Over the photographs only. It is a way *into* the conversation, so on
        the conversation it would be a banner announcing the thing directly
        underneath it, and on the roster it would sit over the first two
        people for no reason.
      */}
      {pane === 'photos' && latest && unread > 0 && !bannerGone && !savedNote && (
        <Pressable
          onPress={() => setPane('talk')}
          accessibilityRole="button"
          accessibilityLabel={`${unread} new ${unread === 1 ? 'message' : 'messages'}`}
          style={styles.bannerShell}
        >
          <BlurView intensity={18} tint="light" style={styles.banner}>
            <Bubble name={latest.author.name} url={latest.author.avatarUrl} keyed={latest.author.key} />
            <Text style={[styles.bannerText, { color: '#14171c' }]} numberOfLines={1}>
              <Text style={styles.bannerName}>{latest.author.name} </Text>
              {latest.deleted ? 'Message deleted' : latest.body}
            </Text>
            <Text style={styles.bannerCount}>
              {unread} new
            </Text>
          </BlurView>
        </Pressable>
      )}

      {sheetOpen && (
        <HostSheet
          api={api}
          t={t}
          feed={feed}
          event={event}
          cover={cover}
          policy={policy}
          policyError={policyError}
          saving={saving}
          Button={ButtonEl}
          onClose={() => setSheetOpen(false)}
          copied={copied}
          feedError={feedError}
          onCopyLink={copyLink}
          onSaveAll={saveAll}
          onDelete={deleteAlbum}
          onLeave={leaveAlbum}
          onEditCover={framer}
          onRemoveCover={feed?.event.coverUrl ? removeCover : null}
          coverBusy={sendingCover}
          name={feed?.event.name ?? event.name}
          onNameSaved={refresh}
          /*
            The frame, rendered *inside* the sheet's modal rather than beside it.

            This is the trap the photograph's own `⋯` sheet has a paragraph
            about further down, and it is the same one: on iOS a modal
            presented while a full-screen modal is already up presents
            underneath it. As a sibling of `<HostSheet>` this opened every time
            and was never visible — and then appeared over the album the moment
            the sheet was dismissed, which is exactly how the older bug read.
            A screen about the cover belongs in the same layer as the row that
            opens it.

            Passed as an element rather than by giving `HostSheet` six more
            props: everything it needs — the album's photographs, the feed, the
            upload — lives out here, and threading all of it through a
            presentational component to have it rebuilt on the other side would
            put the cover's logic in two files.
          */
          coverFramer={
            /*
              Two ways into the same screen, and both of them belong here.

              The library one fires only for an album with nothing in it —
              there are no photographs of its own to offer, so the only picture
              there could be is one off the camera roll. Its row of thumbnails
              draws nothing, because there is no selection to try instead; what
              it is here for is the frame and the zoom.
            */
            framingCover ? (
              <CoverFramer
                photos={[{ id: 'picked', uri: framingCover }]}
                coverId="picked"
                t={t}
                onCancel={() => setFramingCover(null)}
                onConfirm={(_id, framing) => {
                  const uri = framingCover;
                  setFramingCover(null);
                  void sendCover(uri, framing);
                }}
              />
            ) : framingAlbum && coverChoices.length > 0 ? (
              <CoverFramer
                photos={coverChoices}
                /*
                  `coverPhotoId` is null for a cover set before it was recorded
                  and for one chosen off the camera roll. Both fall back to the
                  photograph the album leads with, which is what the person
                  opening this is looking at.
                */
                coverId={feed?.event.coverPhotoId ?? coverChoices[0]!.id}
                initial={feed?.event.coverFraming ?? undefined}
                stripLabel="IN THIS ALBUM"
                t={t}
                onCancel={() => setFramingAlbum(false)}
                onConfirm={(id, framing) => {
                  setFramingAlbum(false);
                  void sendAlbumCover(id, framing);
                }}
              />
            ) : null
          }
          adding={adding ?? feed?.event.contributePolicy ?? 'everyone'}
          savingContribute={savingContribute}
          contributeError={contributeError}
          onContribute={async (value) => {
            setAdding(value);
            setContributeError(null);
            setSavingContribute(true);
            try {
              await api.setContributePolicy(event.id, value);
              // Not because the pills need it — they answered the press
              // already — but because the add button at the foot of the album
              // is drawn from `canAdd`, which only the server can decide.
              await refresh();
            } catch {
              setAdding(null);
              setContributeError('Could not change that. Try again in a moment.');
            } finally {
              setSavingContribute(false);
            }
          }}
          onPolicy={async (value) => {
            setPolicy(value);
            setPolicyError(null);
            try {
              await api.setAccessPolicy(event.id, value);
              // Not because the pills need it — they answered the press
              // already — but because the padlock over the cover and the
              // number waiting are both read off the feed.
              await refresh();
            } catch {
              setPolicy(null);
              setPolicyError('Could not change that. Try again in a moment.');
            }
          }}
          onGroup={async (name) => {
            try {
              const group = await api.createGroup(event.id, name, false);
              setSheetOpen(false);
              onGroupsChanged();
              onOpenGroup(group.id);
            } catch {
              Alert.alert('Could not make the group', 'Try again in a moment.');
            }
          }}
          onOpenGroup={onOpenGroup}
        />
      )}

      {/*
        The account, asked for only when somebody has reached for the thing
        that needs one. Never in front of the photographs — which is what the
        card sitting permanently above the grid amounted to.
      */}
      <Modal visible={gateOpen} animationType="slide" transparent onRequestClose={() => setGateOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setGateOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
            <AccountCard
              api={api}
              t={t}
              Button={ButtonEl}
              gate
              why="Adding photos needs an account. Looking does not — carry on browsing without one."
              onSignedIn={() => {
                setGateOpen(false);
                onSignedIn();
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/*
        The photograph, on its own, over everything.

        A full-screen modal rather than a sheet: what was here was a thumbnail
        on a card above five full-width buttons, on the screen whose whole
        subject is one picture. The viewer owns the glass; the five buttons are
        behind its `⋯`, which opens the sheet below.
      */}
      {/*
        The same frame the create screen offers, on the one screen somebody
        opens because the cover is wrong.

        One photograph, so its row of thumbnails draws nothing — the picture was
        just chosen out of the library and there is no album selection to try
        instead. What it is here for is the frame and the zoom.
      */}
      {selected && (
        <Modal visible animationType="fade" onRequestClose={() => setSelected(null)}>
          <PhotoViewer
            api={api}
            eventId={event.id}
            photo={
              // Re-read off the feed rather than held: a reaction refreshes the
              // feed, and the copy captured when the tile was tapped would go
              // on showing the counts as they were before the tap.
              feed?.photos.find((p) => p.id === selected.id) ?? selected
            }
            /*
              The album's own thread, filtered to this photograph.
              
              There is no second table and no second request: `event_message`
              has carried a `photo_id` since the web let somebody reply to a
              picture, and the feed has been sending those rows all along. A
              comment is a line in the album's conversation that happens to be
              about one of its photographs.
            */
            comments={(feed?.messages ?? []).filter((m) => m.photoId === selected.id)}
            t={t}
            canReact={feed?.canPost ?? false}
            canPost={feed?.canPost ?? false}
            onClose={() => {
              /*
               * Both, and that is the fix for a real bug.
               *
               * Opening `⋯` and then swiping out of the photograph left
               * `actionsFor` set, so the options sheet appeared over the album
               * — a "remove my photo" prompt about a picture nobody was looking
               * at any more. The viewer owns the sheet, so the viewer closing
               * closes it.
               */
              setSelected(null);
              setActionsFor(null);
            }}
            onChanged={refresh}
            onOptions={() => setActionsFor(selected)}
          />

          {/*
            And here, for the same reason the sheet below is here: the save is
            pressed from that sheet, and a note drawn in the album's own tree
            would be behind this modal at the moment it had something to say.
          */}
          {saved}

          {/*
            Inside the viewer's modal, not beside it.

            This was a sibling of the `<Modal>` above, which on iOS means it
            presented *underneath* a full-screen modal that was already up: the
            sheet opened every time, was never visible, and then appeared over
            the album the moment the photograph was swiped away. That last part
            was reported as a bug and treated as one — the state is cleared on
            close, which is still right — but the state was never the fault. A
            sheet about a photograph belongs in the same layer as the
            photograph.
          */}
          {actionsFor && (
            <PhotoActions
              api={api}
              photo={
                // Re-read, for the same reason the viewer re-reads: tagging
                // refreshes the feed, and the copy taken when `⋯` was pressed
                // would go on showing the names as they were before.
                feed?.photos.find((p) => p.id === actionsFor.id) ?? actionsFor
              }
              /*
                Who may be tagged: the people already in this album.

                Not a search of everybody with an account. A tag is a claim
                about somebody's face, and pointing at a person who cannot open
                the album — and so cannot object — is the thing the server
                refuses anyway. The picker offers what the server accepts.
              */
              members={feed?.members ?? []}
              t={t}
              /*
                The same save the column view puts in a photograph's corner.

                Reached from the viewer, which is where somebody looking at one
                picture actually is: the corner button lives on a row in a list
                they have already scrolled past by the time they decide they
                want it, and the viewer's own chrome is a `⋯` and nothing else.
                One function behind both, so "saved" means the same thing
                either way — the camera's own file, not a rendition.
              */
              onDownload={() => {
                void saveOne(actionsFor).then((saved) => {
                  if (saved) setActionsFor(null);
                });
              }}
              downloading={savingOne === actionsFor.id}
              onClose={() => setActionsFor(null)}
              onChanged={async () => {
                await refresh();
                // Removing or hiding the photograph takes the viewer with it —
                // there is nothing left underneath for it to be showing.
                setSelected(null);
              }}
            />
          )}
        </Modal>
      )}

    </View>
  );
}

/**
 * Photos · Talk · People, as one control.
 *
 * Glyphs rather than words, and the middle one carries the number: a count on
 * a tab is the only place in this screen that says somebody is waiting to be
 * answered, and it has to survive being the third of three items on a 240pt
 * control. The active item is a white card inside the well, which is the
 * shape iOS uses and the reason no second colour is needed to say which pane
 * you are in.
 */

/**
 * The four tabs, floating over whatever is behind them.
 *
 * Its own component because it is no longer the tabs screen's own furniture.
 * Somebody else's page is reached by tapping a byline or a search result and
 * used to replace the whole app while it was open — a screen with one `‹` in
 * the corner and no way to anywhere else, which is the shape of a modal and
 * not of a page you arrived at by browsing. The bar draws over it now, and
 * pressing a tab takes the page off the top of the stack on the way.
 */
function TabBar({
  tab,
  t,
  dark,
  onTab,
}: {
  tab: Tab;
  t: Theme;
  dark: boolean;
  onTab: (tab: Tab) => void;
}) {
  /*
   * Two views for one bubble, and the nesting is not decoration: iOS clips a
   * layer's shadow the moment `overflow: 'hidden'` is set, and the blur needs
   * exactly that to be clipped into a capsule. So the outer view carries the
   * shadow and the inner one carries the blur.
   */
  return (
    <View style={styles.tabShell}>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint="systemChromeMaterial"
        blurMethod="dimezisBlurView"
        style={[styles.tabBar, { borderColor: t.line }]}
      >
        {/*
          Glyphs, where four words used to be.

          Four labels across a 365pt bubble is four pieces of type
          competing with the photographs running underneath it, and
          "Events / Groups / Find / You" is the one row in this product
          that is read once and recognised forever after. The drawings
          are the web rail's own — see `Glyph.tsx` — so the two clients
          point at a group with the same picture. The label survives as
          the accessibility name, which is where a word is still worth
          having.
        */}
        {(
          [
            ['home', 'photos', 'Albums'],
            ['chats', 'bubbles', 'Chats'],
            ['search', 'search', 'Find'],
            ['profile', 'profile', 'You'],
          ] as [Tab, GlyphName, string][]
        ).map(([id, glyph, label]) => (
          <Pressable
            key={id}
            style={[
              styles.tab,
              /*
               * A wash of the page's own value, not a colour.
               *
               * Translucent on purpose: over a blur an opaque fill reads
               * as a patch stuck on the glass. And grey rather than the
               * accent — a filled blue capsule is the loudest thing on a
               * screen of other people's photographs, and a tab bar is
               * chrome. What makes the selected one legible is the glyph
               * inside it, which is the page's full-strength foreground
               * against four in `dim`; the capsule only has to say where
               * the foreground one is seated.
               */
              tab === id && { backgroundColor: dark ? '#ffffff1f' : '#0000000f' },
            ]}
            onPress={() => onTab(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            accessibilityLabel={label}
          >
            {/*
              The page's foreground, and a stroke heavier than the
              family's own.

              Both, because one without the other is half a state. The
              four unselected glyphs are `dim`, so the selected one steps
              up to `fg` — the same distance between a heading and the
              line under it, said in a picture — and the extra half-unit
              of stroke is what carries that distance at 22 points, where
              a two-step change in value alone is easy to miss on a bar
              sitting over a bright photograph.

              `fg` rather than the accent. Colour on this bar would be
              the only colour in the chrome, and the photographs running
              underneath it are the things entitled to have one.
            */}
            <Glyph
              name={glyph}
              size={22}
              weight={tab === id ? 2.5 : 2}
              color={tab === id ? t.fg : t.dim}
            />
          </Pressable>
        ))}
      </BlurView>
    </View>
  );
}

function Segmented({
  pane,
  unread,
  onPane,
  t,
  dark,
}: {
  pane: Pane;
  unread: number;
  onPane: (pane: Pane) => void;
  t: Theme;
  dark: boolean;
}) {
  const items: [Pane, GlyphName, string][] = [
    ['photos', 'photos', 'Photos'],
    ['talk', 'bubble', 'Comments'],
    ['people', 'group', 'People'],
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: dark ? '#ffffff14' : '#eef0f4' }]}>
      {items.map(([id, glyph, label]) => {
        const on = pane === id;
        return (
          <Pressable
            key={id}
            onPress={() => onPane(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={
              id === 'talk' && unread > 0 ? `${label}, ${unread} new` : label
            }
            style={[
              styles.segment,
              on && [styles.segmentOn, { backgroundColor: t.card }],
            ]}
          >
            <Glyph name={glyph} size={20} color={on ? t.fg : t.dim} />
            {id === 'talk' && unread > 0 && (
              <Text style={[styles.segmentCount, { color: t.accent }]}>{unread}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The faces over the cover: three, and then how many more.
 *
 * Rings in white rather than in the page colour, because what is behind them
 * is a photograph — a ring the colour of the background would be a hole in
 * whatever the cover happens to be.
 */
function Faces({ members }: { members: Member[] }) {
  const shown = members.slice(0, CARD_FACES);
  const more = members.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <View style={styles.faceStack}>
      {shown.map((member) => {
        const lens = lensFor(member.actorId);
        return member.avatarUrl ? (
          <ExpoImage
            key={member.actorId}
            source={{ uri: member.avatarUrl }}
            style={[styles.faceRing, { backgroundColor: lens.fill }]}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View
            key={member.actorId}
            style={[styles.faceRing, styles.faceCentred, { backgroundColor: lens.fill }]}
          >
            <Text style={[styles.faceLetter, { color: lens.ink }]}>
              {initialOf(member.name)}
            </Text>
          </View>
        );
      })}
      {more > 0 && (
        <View style={[styles.faceRing, styles.faceCentred, styles.faceMore]}>
          <Text style={styles.faceMoreText}>+{more}</Text>
        </View>
      )}
    </View>
  );
}

/** One face in the unread banner — theirs, or the letter on their lens. */
function Bubble({ name, url, keyed }: { name: string; url: string | null; keyed: string }) {
  const lens = lensFor(keyed);
  return url ? (
    <ExpoImage source={{ uri: url }} style={styles.bannerFace} contentFit="cover" transition={120} />
  ) : (
    <View style={[styles.bannerFace, styles.faceCentred, { backgroundColor: lens.fill }]}>
      <Text style={[styles.bannerFaceLetter, { color: lens.ink }]}>{initialOf(name)}</Text>
    </View>
  );
}

/**
 * Everything the album's screen used to stack above its first photograph.
 *
 * ## Three actions, then four questions
 *
 * The sheet used to be one list, and everything in it looked equally like
 * everything else: sharing the link, saving every photograph and changing who
 * could see it were all a title with a line of explanation under it, stacked.
 * Two of those are things you *do* and take a second; the rest are things you
 * *decide* and change the album.
 *
 * So the doing sits across the top as three icons — copy the link, download it,
 * and the one that ends your part in it — and the deciding is below in the
 * order somebody actually meets it: what it looks like, who is in it, who can
 * see it, and whether this keeps happening. Icons for the first three because
 * they are the same three verbs every phone already has a picture for, and a
 * row of three is glanceable in a way a stack of three paragraphs is not.
 *
 * The last of the three is the reason they are not four: **Delete** and
 * **Leave** occupy one slot and are never both offered. The host ends the
 * evening for everybody; everybody else steps out of it. Neither is a smaller
 * version of the other, and a single row whose meaning turned on who was
 * reading it is a row somebody would eventually misread.
 */
function HostSheet({
  api,
  t,
  feed,
  event,
  cover,
  policy,
  policyError,
  saving,
  copied,
  feedError,
  Button: ButtonEl,
  onClose,
  onCopyLink,
  onSaveAll,
  onDelete,
  onLeave,
  onEditCover,
  onRemoveCover,
  coverBusy,
  coverFramer,
  name,
  onNameSaved,
  onPolicy,
  adding,
  savingContribute,
  contributeError,
  onContribute,
  onGroup,
  onOpenGroup,
}: {
  api: Api;
  t: Theme;
  feed: Feed | null;
  event: SavedEvent;
  cover: string | null;
  policy: 'public' | 'private' | null;
  policyError: string | null;
  saving: string | null;
  /** True for a moment after the link goes on the clipboard. */
  copied: boolean;
  /** Why the feed is not here, when it is not coming. */
  feedError: string | null;
  Button: typeof Button;
  onClose: () => void;
  onCopyLink: () => void;
  onSaveAll: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onEditCover: () => void;
  /**
   * Take the cover off, or null where there is nothing to take off.
   *
   * Null rather than a disabled row: an album leading with its first
   * photograph has no cover set, and offering to remove one would be offering
   * to undo something nobody did.
   */
  onRemoveCover: (() => void) | null;
  /** Whether a photograph is on its way up as the cover. */
  coverBusy: boolean;
  /**
   * The cover frame, when it is open — drawn inside this sheet's own modal.
   *
   * Handed over as an element because a modal presented from outside this one
   * presents *underneath* it on iOS. See the note at the call site, and the
   * longer one on `PhotoActions`, which is the same mistake made once already.
   */
  coverFramer: React.ReactNode;
  /** What the album is currently called, as the server has it. */
  name: string;
  /** Re-reads the feed, so the header behind the sheet catches up. */
  onNameSaved: () => void | Promise<void>;
  onPolicy: (value: 'public' | 'private') => void;
  /** Who may add photographs, as chosen or as the feed has it. */
  adding: ContributePolicy;
  savingContribute: boolean;
  contributeError: string | null;
  onContribute: (value: ContributePolicy) => void;
  onGroup: (name: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState('');
  /*
   * Whether the answer has arrived at all, kept apart from what the answer is.
   *
   * `host` is false both for somebody who is not the host and for a sheet that
   * has not been told yet, and collapsing those two was the bug: the album's
   * chrome is drawn from the saved listing and appears at once, so `⋯` is
   * pressable a moment before the feed lands. Opening it then asked "is this
   * person the host", got "not yet", and confidently offered the creator of the
   * album a door out of it — then swapped the label under their thumb when the
   * real answer turned up.
   *
   * The rest of the screen already works this way: the composer reads
   * `feed.canPost` rather than guessing, so a refusal is never a surprise. This
   * is the same rule applied to the one control where guessing wrong offers to
   * remove somebody from their own evening.
   */
  const known = feed !== null;
  const host = feed?.event.canAdminister === true;
  const visible = (policy ?? feed?.event.accessPolicy) ?? 'public';
  const photos = feed?.photos.length ?? 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/*
        The dim is a sibling of the sheet, not its parent.

        It used to wrap it — a `Pressable` for the backdrop, a second one around
        the sheet to swallow presses that should not close it, and the scroll
        view inside both. That nesting is what made the first swipe on an opened
        sheet do nothing: a touch anywhere in it is offered to the deepest view
        that wants to be the responder, the sheet's own `Pressable` said yes on
        the way down, and the scroll had to wait for that press to end before it
        could take the gesture back. You swiped, nothing moved, you swiped again
        and it worked — which reads as the page taking a moment to wake up.

        Flat, there is nothing above the scroll view to claim anything: the dim
        is behind it and covers the whole screen, so a tap on the visible part
        still closes, and a tap on the sheet lands on the sheet because the
        sheet is drawn over it.
      */}
      <View style={styles.sheetShell}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        {/*
          The way out, above the sheet rather than at the foot of it.

          It was a Done button under everything, which meant closing a sheet you
          had scrolled to the bottom of was easy and closing one you had not
          meant scrolling to find the exit. This is the album's own back button,
          in the same disc, in the same corner, at the same size — so the
          gesture that leaves this is the gesture that leaves the screen under
          it, and it never moves.
        */}
        <RoundButton
          t={t}
          onPress={onClose}
          accessibilityLabel="Close"
          style={styles.sheetBack}
        >
          <Back color={t.fg} />
        </RoundButton>

        <View style={[styles.sheet, { backgroundColor: t.bg }]}>
          <ScrollView contentContainerStyle={styles.sheetScroll}>
            <View style={styles.actions}>
              <Action
                t={t}
                icon="share"
                /* The label says what the tap did, for two seconds. A copy is
                   invisible otherwise — the clipboard is not a place you can
                   see. */
                label={copied ? 'Link copied' : 'Copy link'}
                onPress={onCopyLink}
              />
              <Action
                t={t}
                icon="download"
                label={saving ?? 'Download Album'}
                onPress={onSaveAll}
                /* Nothing to download from an empty album, and a live button
                   that can only apologise is worse than one that is plainly
                   not yet for you. */
                disabled={photos === 0 || saving !== null}
              />
              {/*
                Empty until the answer is in, rather than wrong until then.

                A reserved column instead of nothing at all, so the two actions
                either side keep their thirds and the row does not re-centre
                itself the moment the feed lands.
              */}
              {!known ? (
                <View style={styles.action} />
              ) : host ? (
                <Action t={t} icon="trash" label="Delete Album" onPress={onDelete} danger />
              ) : (
                <Action t={t} icon="door" label="Leave Album" onPress={onLeave} danger />
              )}
            </View>

            {/*
              What the sheet looks like before it has been told anything.

              Held at a height rather than collapsed to the three actions: a
              sheet that arrives one inch tall and then stands up to full height
              reads as the app changing its mind, where a sheet that arrives at
              a sensible size and fills in reads as a page loading — which is
              what it is.
            */}
            {!known && (
              <View style={styles.sheetWaiting}>
                {feedError ? (
                  <Text style={[styles.small, { color: t.dim }]}>{feedError}</Text>
                ) : (
                  <Waiting size={28} />
                )}
              </View>
            )}

            {/*
              What it leads with.

              The explanation under it is gone: the row *is* the photograph, at
              the size the album draws it, and a line saying "what this event
              leads with everywhere" was describing a picture sitting right
              beside the words. It shows the borrowed first photograph when
              nobody has chosen one, which is what the album's header shows —
              so this row is never a different answer from the screen behind it.
            */}
            {host && (
              <Pressable
                onPress={onEditCover}
                style={({ pressed }) => [
                  styles.coverRow,
                  { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={cover ? 'Change the album cover' : 'Choose an album cover'}
              >
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.coverShot} resizeMode="cover" />
                ) : (
                  // Dashed, which means "nothing here" rather than "a very dark
                  // photograph" — the same call the web's empty tile makes.
                  <View style={[styles.coverEmpty, { borderColor: t.line }]} />
                )}
                <View style={styles.coverWords}>
                  <Text style={[styles.coverTitleText, { color: t.fg }]}>Album cover</Text>
                  {/*
                    What the row does, which it never said.

                    It used to open an alert that asked the question again, so
                    the row itself could get away with a title. It opens the
                    frame directly now, and a photograph with one word beside
                    it does not say whether pressing it changes the picture or
                    merely shows it larger.
                  */}
                  <Text style={[styles.coverHint, { color: t.dim }]}>
                    {coverBusy ? 'Setting it…' : 'Move the frame, or pick another'}
                  </Text>
                </View>
              </Pressable>
            )}

            {/*
              Taking it off, under the picture it would take off.

              This was the second action in the alert the row above used to
              open — the rare destructive one, kept a press further away than
              the ordinary one. The ordinary one goes straight to the frame
              now, so there is no alert left to keep this in, and the rule it
              was following is served instead by where it sits: below the
              picture, in the quieter type, and it still asks before it acts.
            */}
            {host && onRemoveCover && (
              <Pressable
                onPress={onRemoveCover}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove the album cover"
                style={({ pressed }) => [styles.coverOff, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.coverOffText, { color: t.warn }]}>Remove cover</Text>
              </Pressable>
            )}

            {/*
              What it is called, under the picture it is called beside.

              The create screen asks for this and nothing has been able to
              change it since — so the name was the one thing you had to get
              right in the thirty seconds before you sent the link, on a screen
              where you had not yet seen a single photograph of the evening you
              were naming. The route has accepted the field all along.

              Directly below the cover because the two are the album's face:
              the picture and the words on it, which is how a card draws them
              and how the album's own header does.
            */}
            {host && <NameCard api={api} t={t} event={event} name={name} onSaved={onNameSaved} />}

            {/*
              The other door into a private album, and the one the app did not
              have: somebody who made one could send the link and wait to be
              asked, but could not ask anybody.
            */}
            {host && <InviteCard api={api} t={t} eventId={event.id} Button={ButtonEl} />}

            {/*
              Who can see it, changeable here.

              The app asked this once — two pills on the create screen — and
              then never again, which is the wrong way round: the choice is
              made in the first thirty seconds, before anybody has been sent
              anything, and what you want is obvious only once they have.

              Host only, because it decides what everybody else can reach. The
              note under it is not decoration: "private" sounds like it should
              throw people out, and it does not.
            */}
            {host && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.label, { color: t.fg }]}>Who can see it</Text>
                <View style={styles.pills}>
                  {(
                    [
                      ['public', 'Public'],
                      ['private', 'Private'],
                    ] as ['public' | 'private', string][]
                  ).map(([value, label]) => {
                    const on = visible === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => !on && onPolicy(value)}
                        style={[
                          styles.pill,
                          on
                            ? { borderColor: t.accent, borderWidth: 1.5, backgroundColor: t.bg }
                            : { borderColor: t.line, backgroundColor: t.card },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            on && styles.pillTextOn,
                            { color: on ? t.accent : t.fg },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.small, { color: t.dim }]}>
                  {visible === 'private'
                    ? 'Only the people in it. Anyone else with the link can ask, and you answer — everyone already here stays in.'
                    : 'Anyone can see it, no account needed. Adding photos always needs one.'}
                </Text>
                {(feed?.event.waiting ?? 0) > 0 && (
                  <Text style={[styles.small, { color: t.accent }]}>
                    {feed!.event.waiting}{' '}
                    {feed!.event.waiting === 1 ? 'person is' : 'people are'} waiting to be
                    let in — answer them on Events.
                  </Text>
                )}
                {policyError && <Text style={[styles.small, { color: t.dim }]}>{policyError}</Text>}
              </View>
            )}

            {/*
              Who can add photographs, which is not the same question as who
              can see it and used to be answered by a switch that was on or
              off. Two of these three were that switch's "on"; the third — you
              put the photographs in and everybody else looks — could not be
              said at all.

              Its own card beside the visibility one because it is the same
              kind of question, and host-only because it decides what everybody
              else can do.
            */}
            {host && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.label, { color: t.fg }]}>Who can add photos</Text>
                <ContributeChoice
                  t={t}
                  value={adding}
                  // The live value, not the saved one: switching an album to
                  // private renames the middle answer from "Everyone" to
                  // "Members" in the same breath, which is the point of asking
                  // the two questions on one sheet.
                  accessPolicy={visible}
                  disabled={savingContribute}
                  onChange={onContribute}
                  note="Nothing already added is removed, whichever of the three this is."
                />
                {contributeError && (
                  <Text style={[styles.small, { color: t.warn }]}>{contributeError}</Text>
                )}
              </View>
            )}

            {/*
              What the link does, beside the thing that sends it. Only for a
              private album: on a public one the link does the obvious thing,
              and a line saying so on every event is a line that stops being
              read.
            */}
            {visible === 'private' && !host && (
              <Text style={[styles.small, { color: t.dim }]}>
                Private — the link lets somebody ask. Whoever made this album decides.
              </Text>
            )}

            {/*
              Last, because it is the only question about the future.

              Only the host, and only for an event that is not already in one.
              The pitch is the recurrence, not the feature: nobody wants "a
              group", they want to stop sending the link every time. An event
              that is already in a group says which one instead, and opens it.
            */}
            {host && !feed?.event.groupId && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                {naming ? (
                  <>
                    <Text style={[styles.label, { color: t.fg }]}>Name the group</Text>
                    <TextInput
                      value={groupName}
                      onChangeText={setGroupName}
                      placeholder="Sunday roast"
                      placeholderTextColor={t.dim}
                      autoFocus
                      onSubmitEditing={() => onGroup(groupName.trim())}
                      style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
                    />
                    <Text style={[styles.small, { color: t.dim }]}>
                      Everyone here keeps their access. Nobody is added to the
                      group without choosing to.
                    </Text>
                    <Button
                      label="Make the group"
                      onPress={() => onGroup(groupName.trim())}
                      disabled={!groupName.trim()}
                      t={t}
                      primary
                    />
                    <Button label="Cancel" onPress={() => setNaming(false)} t={t} />
                  </>
                ) : (
                  <>
                    <Text style={[styles.body, { color: t.fg }]}>
                      Do this often with these people? A group keeps the albums
                      together, so you only send the link once.
                    </Text>
                    <Button
                      label="Create group from this album"
                      onPress={() => setNaming(true)}
                      t={t}
                    />
                  </>
                )}
              </View>
            )}

            {feed?.event.groupId && (
              <Row
                label={`in ${feed.event.groupName}`}
                note="Open the group this album is in."
                onPress={() => {
                  onClose();
                  onOpenGroup(feed.event.groupId!);
                }}
                t={t}
              />
            )}
          </ScrollView>
        </View>
      </View>

      {/* Over the sheet, in the sheet's own layer. See the note at the call
          site: presented from outside this modal it would open underneath it. */}
      {coverFramer}
    </Modal>
  );
}

/**
 * One of the three across the top: a glyph in a disc, and two words under it.
 *
 * Sized to a third of the sheet, so three of them fit without wrapping and the
 * touch target is the whole column rather than the 44 points of circle. The
 * destructive one is drawn in the theme's own warning colour and is still the
 * same shape as its neighbours — a red row is a label, not a barrier, and the
 * barrier is the confirmation behind it.
 */
function Action({
  t,
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  t: Theme;
  icon: GlyphName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const ink = disabled ? t.dim : danger ? t.warn : t.fg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.actionDisc, { backgroundColor: t.card, borderColor: t.line }]}>
        <Glyph name={icon} size={21} color={ink} />
      </View>
      <Text style={[styles.actionLabel, { color: ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One action in the sheet: what it does, and one line about what that means.
 *
 * `danger` colours the label and nothing else — the same reading `Action`
 * takes above: a red label says which row this is, and the barrier is the
 * confirmation behind it rather than the colour. The note stays dim, because
 * it is the sentence that has to be read calmly.
 */
function Row({
  label,
  note,
  onPress,
  disabled,
  danger,
  t,
}: {
  label: string;
  note: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  t: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => [
        styles.sheetRow,
        {
          backgroundColor: t.card,
          borderColor: t.line,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[styles.coverTitleText, { color: disabled ? t.dim : danger ? t.warn : t.fg }]}
      >
        {label}
      </Text>
      <Text style={[styles.coverNote, { color: t.dim }]}>{note}</Text>
    </Pressable>
  );
}

// --- per-photo safety actions -------------------------------------------------

/**
 * What each of the three says once it has happened.
 *
 * The same sentences the web says, and deliberately the same: they are the
 * only account somebody gets of what became of a report they made, and the 48
 * hours in the first is a promise the auto-hide job actually keeps. The other
 * copy is `DONE` in `apps/web/app/components/PhotoView.tsx`, which says the
 * same thing about rewording them — two clients telling one person two
 * different stories about what blocking did is worse than either story.
 */
const DONE = {
  removal:
    'Asked the host to take it down. If they have not answered in 48 hours it is hidden automatically.',
  report: 'Reported. Someone will look at it.',
  block:
    'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.',
} as const;

/**
 * The same set as the web photo page — remove your own, or ask/report/block
 * someone else's. App Store Guideline 1.2 requires these reachable in the app,
 * and this is a photo-sharing app carrying other people's faces regardless.
 *
 * The web moved these behind a `···` when the photograph became a page of its
 * own; here they stay as they are. That is not drift: this is a sheet somebody
 * opened for one photograph, so there is nothing else on it for them to
 * compete with — the reason for hiding them on the web was that they sat in
 * the open at the same weight as a comment.
 */
function PhotoActions({
  api,
  photo,
  members,
  t,
  onDownload,
  downloading,
  onClose,
  onChanged,
}: {
  api: Api;
  photo: FeedPhoto;
  /** Into the camera roll. The album screen owns it — see `saveOne`. */
  onDownload: () => void;
  /** Whether this one is on its way there. */
  downloading: boolean;
  /** The album's own people — the only ones who may be tagged. */
  members: Member[];
  t: Theme;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [term, setTerm] = useState('');

  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      Alert.alert(label, done);
      await onChanged();
      onClose();
    } catch {
      Alert.alert('That did not work', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Blocking asks twice, and the second press says what it does.
   *
   * An alert rather than the web's swap-the-label-in-place, because that is
   * what a destructive confirmation is on a phone and because this sheet has
   * no room to grow a second state. The wording is the cost, not the act: you
   * stop seeing them and they are not told — a block somebody thinks is a
   * report is a block they will not use on the person they most want to stop
   * seeing.
   *
   * It does not offer an undo, because there is not one. `DELETE /api/blocks`
   * exists and no screen on either client calls it, and it is keyed by a
   * photograph of the person being unblocked — which the block has just hidden.
   * Saying "you can undo this in Settings" would be the product promising
   * something no button does. Until a block list exists somewhere, this says
   * what it does and stops there.
   */
  const confirmBlock = () =>
    Alert.alert(
      'Block this person?',
      'Their photographs disappear from every album you share, here and anywhere else. They are not told, and nobody else is affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => void act('Blocked', () => api.block(photo.id), DONE.block),
        },
      ],
    );

  /*
   * Who is already named, and who is left to name.
   *
   * Matched on the opaque per-event key rather than on an actor id, because
   * that is what a tag carries — `members` has ids because the roster is drawn
   * from them, and the two lists meet on the handle. Somebody with no handle
   * cannot be matched and so cannot be double-offered, which shows as their
   * name appearing in the list under a tag they already have: a small wrong
   * thing, and the alternative is sending actor ids with the tags.
   */
  const tagged = new Set(photo.tags.map((tag) => tag.handle ?? tag.name));
  const offerable = members
    .filter((member) => !tagged.has(member.handle ?? member.name))
    .filter((member) =>
      term.trim() === ''
        ? true
        : `${member.name} ${member.handle ?? ''}`
            .toLowerCase()
            .includes(term.trim().toLowerCase()),
    );

  const tag = async (actorId: string) => {
    setBusy(true);
    try {
      await api.tagPhoto(photo.id, actorId);
      setTerm('');
      await onChanged();
    } catch {
      Alert.alert('Could not tag', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      {/*
        A sheet at the foot of the screen, until there is a keyboard.

        Tagging is the one thing in here with a text field in it, and a bottom
        sheet with a keyboard over it is a list somebody is typing into that
        they cannot see — the field, the names and the chips were all under the
        keys. So the tagging state goes to the top instead, where the keyboard
        cannot reach it, and the two menu buttons stay where a sheet belongs.
      */}
      <View style={tagging ? styles.sheetTop : styles.sheetBackdrop}>
        <View
          style={[
            styles.sheet,
            tagging && styles.sheetTopPanel,
            { backgroundColor: t.card },
          ]}
        >
          {/*
            Two menus, and which one you get is not a matter of taste.

            Yours: take it down, or say who is in it. Somebody else's: report
            it. That is the whole of it — what a person can do about a
            photograph depends entirely on whether they put it there.
          */}
          {/*
            Keeping a copy, above everything else in here.

            The only thing in this sheet that is not about taking something
            away — removing a photograph, asking for it to come down,
            reporting it, blocking somebody — and the only one most people will
            ever press. Under three destructive rows it would be the safe
            action buried beneath the dangerous ones, which is backwards.

            Offered whoever the photograph belongs to. Saving somebody else's
            picture out of an album you are in is the same thing the column
            view has always offered from its corner, and the same thing
            "Download album" does in bulk; a rule that let you keep all of them
            and not one of them would be a rule about nothing.

            Not while tagging: that state replaces the menu with a field and a
            list of names, and a save button under it belongs to a sheet that
            is not on screen.
          */}
          {!tagging && (
            <Button
              label={downloading ? 'Saving…' : 'Download'}
              t={t}
              disabled={busy || downloading}
              onPress={onDownload}
            />
          )}

          {photo.mine ? (
            <>
              {!tagging ? (
                <>
                  <Button
                    label="Remove photo"
                    t={t}
                    primary
                    disabled={busy}
                    onPress={() =>
                      act('Removed', () => api.removeOwn(photo.id), 'It is gone.')
                    }
                  />
                  <Button
                    label={
                      photo.tags.length > 0
                        ? `Tag 'em (${photo.tags.length})`
                        : "Tag 'em"
                    }
                    t={t}
                    disabled={busy}
                    onPress={() => setTagging(true)}
                  />
                </>
              ) : (
                <>
                  {/*
                    Already named, each one removable.

                    The uploader can take a tag off because they put it on. The
                    person tagged can too, from their own side — the route
                    allows both, and nobody has to ask permission to stop being
                    named in a photograph.
                  */}
                  {photo.tags.length > 0 && (
                    <View style={styles.tagRow}>
                      {photo.tags.map((who) => (
                        <Pressable
                          key={who.key}
                          disabled={busy}
                          onPress={() => {
                            const member = members.find(
                              (m) => (m.handle ?? m.name) === (who.handle ?? who.name),
                            );
                            if (!member) return;
                            setBusy(true);
                            void api
                              .untagPhoto(photo.id, member.actorId)
                              .then(onChanged)
                              .catch(() => {})
                              .finally(() => setBusy(false));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${who.name}`}
                          style={[styles.tagChip, { borderColor: t.line, backgroundColor: t.bg }]}
                        >
                          <Text style={[styles.tagName, { color: t.fg }]}>{who.name}</Text>
                          <Text style={[styles.tagX, { color: t.dim }]}>×</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <TextInput
                    value={term}
                    onChangeText={setTerm}
                    placeholder="Who is in it?"
                    placeholderTextColor={t.dim}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    inputAccessoryViewID={KEYBOARD_BAR}
                    style={[styles.input, { borderColor: t.line, color: t.fg, backgroundColor: t.bg }]}
                    accessibilityLabel="Who is in it?"
                  />

                  {/*
                    A way off the keyboard, on the keyboard.

                    A search field with no submit has nothing to press to put the
                    keys away — tapping outside is the usual escape and there is
                    no outside here, because the sheet is the screen. iOS puts
                    an accessory bar directly above the keys for exactly this,
                    so the button is where somebody's thumb already is rather
                    than at the far end of the panel.

                    iOS only: `InputAccessoryView` is not implemented on
                    Android, where the back key does this and always has.
                  */}
                  {Platform.OS === 'ios' && (
                    <InputAccessoryView nativeID={KEYBOARD_BAR}>
                      <View style={[styles.keyBar, { backgroundColor: t.card, borderTopColor: t.line }]}>
                        <Pressable
                          onPress={Keyboard.dismiss}
                          accessibilityRole="button"
                          accessibilityLabel="Hide the keyboard"
                          hitSlop={10}
                        >
                          <Text style={[styles.keyBarDone, { color: t.accent }]}>Done</Text>
                        </Pressable>
                      </View>
                    </InputAccessoryView>
                  )}

                  {/*
                    The album's own people, filtered as you type.

                    No search of everybody with an account, because the server
                    refuses a tag on somebody who is not in the event — a tag is
                    not a way to point at a person who cannot open the album and
                    so cannot object. The picker offers what the server accepts.
                  */}
                  <ScrollView style={styles.tagList} keyboardShouldPersistTaps="handled">
                    {offerable.length === 0 ? (
                      <Text style={[styles.small, { color: t.dim }]}>
                        {members.length === 0
                          ? 'Nobody else is in this album yet.'
                          : 'Everybody here is already tagged.'}
                      </Text>
                    ) : (
                      offerable.map((member) => (
                        <Pressable
                          key={member.actorId}
                          disabled={busy}
                          onPress={() => void tag(member.actorId)}
                          accessibilityRole="button"
                          accessibilityLabel={`Tag ${member.name}`}
                          style={({ pressed }) => [
                            styles.tagPick,
                            { borderBottomColor: t.line, opacity: pressed ? 0.6 : 1 },
                          ]}
                        >
                          <Text style={[styles.tagName, { color: t.fg }]}>{member.name}</Text>
                          {member.handle && (
                            <Text style={[styles.small, { color: t.dim }]}>@{member.handle}</Text>
                          )}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>

                  <Button label="Done" t={t} onPress={() => setTagging(false)} />
                </>
              )}
            </>
          ) : (
            /*
              Somebody else's photograph, and the three things you may
              legitimately want to do about it.

              Only `Report` was here, which left the app one of the four things
              Guideline 1.2 asks for short — and, the rating aside, left the
              person in a picture with nothing to press. The endpoints and the
              client methods have both existed all along; nothing called them.

              `Row` rather than `Button` because each of these needs its one
              line. What separates asking the host from reporting to us is not
              visible in either label, and a block that does not say it is
              silent is one people do not use on the person they most want to
              stop seeing.
            */
            <>
              <Row
                label="That's me — take it down"
                note="Asks whoever made the album, without saying who asked. Hidden automatically if they do not answer."
                t={t}
                disabled={busy}
                onPress={() =>
                  act('Asked', () => api.removalRequest(photo.id), DONE.removal)
                }
              />
              <Row
                label="Report"
                note="Comes to us rather than to the host."
                t={t}
                disabled={busy}
                onPress={() => act('Reported', () => api.report(photo.id), DONE.report)}
              />
              <Row
                label="Block this person"
                note="Hides everything they have added, here and everywhere else."
                danger
                t={t}
                disabled={busy}
                onPress={confirmBlock}
              />
            </>
          )}
          {!tagging && <Button label="Close" t={t} onPress={onClose} />}
        </View>
      </View>
    </Modal>
  );
}

// --- chrome -------------------------------------------------------------------

/**
 * What the album is called, changed after the fact.
 *
 * The create screen asks for a name and nothing could touch it afterwards, so
 * it was the one thing you had to get right in the thirty seconds before you
 * sent the link — on a screen where you had not yet seen a single photograph
 * of the evening you were naming. The route has accepted the field since
 * albums had one.
 *
 * Its own component because it holds a draft, and a draft in `HostSheet` would
 * be reset every time anything else on that sheet changed — the sheet is
 * re-rendered by the feed poll, by a cover landing, by the policy pills. A
 * field somebody is halfway through typing into must not be one of the things
 * a refresh is allowed to move.
 *
 * Saved on a button rather than on blur. Blur is ambiguous here: the sheet
 * scrolls, the keyboard dismisses, and neither of those is somebody saying
 * they are done — and a name that saved itself on the way past would rename
 * the album on everybody's home screen halfway through a word.
 */
function NameCard({
  api,
  t,
  event,
  name,
  onSaved,
}: {
  api: Api;
  t: Theme;
  event: SavedEvent;
  name: string;
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Follows the server, but only while nobody is typing.
   *
   * The feed lands after this mounts and can land again at any time. Without
   * this the field would show whatever it was born with; with it applied
   * unconditionally, a poll landing mid-word would take the word away. So it
   * moves only when the draft still matches what the server last said — which
   * also covers somebody renaming it from the website while this is open.
   */
  const known = useRef(name);
  useEffect(() => {
    setDraft((was) => (was === known.current ? name : was));
    known.current = name;
  }, [name]);

  const trimmed = draft.trim();
  /*
   * Empty is not a name. The route refuses it — "what an album is called on a
   * card, in a notification and in the thread, and '' in all of those is a
   * blank space nobody can point at" — and refusing it here is the difference
   * between a button that does nothing and a button that is not offered.
   */
  const dirty = trimmed !== '' && trimmed !== name.trim();

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setName(event.id, draft.trim());
      await onSaved();
    } catch {
      setError('Could not rename it. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, draft, event.id, onSaved]);

  return (
    <View style={[styles.sheetRow, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>Album name</Text>
      {/*
        Where it shows up, rather than what the field is called. "Name" alone
        is a label; this says what renaming actually moves, which is the thing
        somebody wants to know before doing it to a link they have already sent.
      */}
      <Text style={[styles.small, { color: t.dim }]}>
        What it is called everywhere — on cards, in notifications and in the
        conversation. The link keeps working.
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Naxos, August"
        placeholderTextColor={t.dim}
        /* The route's own ceiling. Stopping the keys at 120 is kinder than
           accepting 160 and answering `invalid_name`. */
        maxLength={120}
        returnKeyType="done"
        onSubmitEditing={() => dirty && void save()}
        style={[styles.input, styles.nameField, { borderColor: t.line, color: t.fg, backgroundColor: t.bg }]}
        accessibilityLabel="The album's name"
      />
      {/*
        Only once there is a change worth saving. A button that is always there
        and usually does nothing is a button people stop reading.
      */}
      {dirty && (
        <Button
          label={busy ? 'Saving…' : 'Save name'}
          onPress={() => void save()}
          t={t}
          primary
          disabled={busy}
        />
      )}
      {error && <Text style={[styles.small, { color: t.warn }]}>{error}</Text>}
    </View>
  );
}

/**
 * One tab, kept alive while another is in front of it.
 *
 * `display: 'none'` rather than unmounting, which is the whole point: the tab
 * keeps its state, its fetched data and its scroll position, so coming back to
 * it is instant instead of a spinner and a round trip. A hidden view is not
 * measured or drawn, so the four of them cost memory and nothing else.
 *
 * `pointerEvents` as well as `display`, because a hidden view that still
 * answers touches is a screen you can press through by accident — belt and
 * braces, since `display: 'none'` should already remove it from the tree.
 */
function Pane({ showing, children }: { showing: boolean; children: React.ReactNode }) {
  return (
    <View
      style={[styles.pane, !showing && styles.paneHidden]}
      pointerEvents={showing ? 'auto' : 'none'}
      // Hidden panes are not there as far as a screen reader is concerned,
      // which is what `ActivityIndicator` and every label inside them would
      // otherwise be announced as part of.
      accessibilityElementsHidden={!showing}
      importantForAccessibility={showing ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}


function Button({
  label,
  onPress,
  t,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  t: Theme;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.accent : 'transparent',
          borderColor: primary ? t.accent : t.line,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.onAccent : t.fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

type Theme = ReturnType<typeof theme>;

function theme(dark: boolean) {
  /*
   * `warn` is the product's only red, and it appears on exactly two labels:
   * deleting an album and leaving one. Both are picked to clear text contrast
   * on `card` rather than to be as red as possible — a warning nobody can read
   * is decoration, and a shout on every screen stops meaning anything.
   */
  /*
   * `bgClear` is `bg` at zero alpha, and it exists because `'transparent'` is
   * not the same thing.
   *
   * CSS transparent — and React Native's — is transparent *black*. A gradient
   * from it to a near-white page interpolates through darkened greys on the way,
   * so a fade that should dissolve instead smudges: the dirty-gradient problem,
   * and the reason the foot of the album header looked soft rather than clean.
   * Ramping alpha on the page's own colour keeps every intermediate step the
   * colour it is going to be, and only its opacity changes.
   */
  return dark
    ? { bg: '#0d0f12', bgClear: 'rgba(13,15,18,0)', card: '#171a1f', line: '#272b33',
        fg: '#f2f4f7', dim: '#9aa3af', accent: '#6ea8fe', onAccent: '#0d0f12',
        warn: '#ff7b70' }
    : { bg: '#f7f8fa', bgClear: 'rgba(247,248,250,0)', card: '#ffffff', line: '#e3e6ea',
        fg: '#14171c', dim: '#5b6472', accent: '#1a5fd0', onAccent: '#ffffff',
        warn: '#c23127' };
}

/** How far the floating chrome sits from the screen's edges. */
const FLOAT_INSET = 14;
/** How far the tab bubble sits above the bottom, clear of the home indicator. */
const BUBBLE_BOTTOM = 28;
/**
 * How much of what is behind the chrome comes through it.
 *
 * `systemChromeMaterial` is the system's own tab-bar material, so the tint
 * follows light and dark without this file knowing which it is in. The
 * intensity is the one number worth tuning by eye: lower and the photographs
 * read through as mush, higher and the bubble stops being glass.
 */
const BLUR_INTENSITY = 55;

/** Enough elevation to read as floating, not enough to look like a dialog. */
const FLOAT_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.16,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  // Android draws no iOS shadow; this is the same claim in its own units.
  elevation: 8,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* --- the album, photographs first ------------------------------------

     Everything down to `gridContent` is one screen described in absolute
     positions, which is unusual in this file and is the point: the cover is
     full-bleed under the clock, the title sits on it, and the body is a sheet
     that starts below it. A column of views in normal flow cannot put white
     type over a photograph and a grey page under it without the page's
     background being drawn over the picture. */
  cover: { position: 'absolute', top: 0, left: 0, right: 0, height: COVER },
  /* Level with each other, and a little lower than either was: they were at 46
     and 40, which is close enough to look like a mistake rather than a
     decision. 52 also puts them clear of the clock on every size of phone. */
  coverBack: { position: 'absolute', top: 52, left: 16, zIndex: 3 },
  coverMore: { position: 'absolute', top: 52, right: 16, zIndex: 3 },
  /* Glass rather than a solid disc: it sits on a photograph nobody chose for
     it, and a grey circle is a hole in whatever is behind it. */
  /*
   * Under the corner discs, which end at 88, and sized so a two-line name still
   * reaches the bottom edge and no further: 104 + two lines at 30 + a 6pt gap +
   * the meta row is the header's height. The old 140 was the same sum against a
   * taller panel.
   */
  coverTitle: { position: 'absolute', top: 104, left: 20, right: 20, zIndex: 3, gap: 6 },
  /* The shadow is what keeps four words legible over a cover that turns out to
     be a white tablecloth. */
  coverName: {
    fontSize: 27,
    lineHeight: 30,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  coverMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  coverMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.92)' },
  faceStack: { flexDirection: 'row' },
  /* The ring is white rather than the page colour — what is behind these is a
     photograph, and a ring in `#f7f8fa` would be a notch cut out of it. */
  faceRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    marginRight: -8,
  },
  faceCentred: { alignItems: 'center', justifyContent: 'center' },
  faceLetter: { fontSize: 10.5, fontWeight: '700' },
  faceMore: { backgroundColor: 'rgba(255,255,255,0.85)', marginRight: 0 },
  faceMoreText: { fontSize: 9.5, fontWeight: '700', color: '#5b6472' },
  /* The page, starting 16 points into the cover's bottom scrim. */
  page: { position: 'absolute', top: PAGE_TOP, left: 0, right: 0, bottom: 0 },
  /*
   * The cover's bottom edge.
   *
   * White until the foot of the header started fading into the page: white on a
   * photograph under a dark scrim is legible, and white on the page's own
   * near-white is not there at all. The accent instead, which is what the rest
   * of the product uses to mean "this is happening" and which now has a plain
   * background to be legible against rather than somebody's photograph.
   */
  /*
   * The byline and the save, in the two corners of a photograph.
   *
   * White with a shadow rather than a disc: a filled circle in the corner of
   * every row is furniture, and there are as many of these as there are
   * photographs. The corners are where a phone camera already puts its own
   * labels, so they read as being about the picture rather than as controls
   * belonging to the app.
   */
  tileBy: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    /* Short of the date in the opposite corner, so a long handle truncates
       rather than running under it. A date with a year is about eighty points,
       and the corners are inset by ten each. */
    maxWidth: '62%',
  },
  /*
   * A rounded square, not a circle.
   *
   * The same corner the home card's byline uses, and the profile's own picture
   * before it: a quarter of the box, so 24 and 28 and 104 are one decision at
   * three sizes. A circle here and a soft corner two screens away is two
   * shapes for one thing — somebody's face — and the album is reached *from*
   * the card that already draws it the other way.
   *
   * The overlapping crowd over a cover stays circular. That row only reads as
   * a crowd because the circles overlap, which squares do not do.
   */
  tileFace: { width: 24, height: 24, borderRadius: 6 },
  tileFaceBlank: { alignItems: 'center', justifyContent: 'center' },
  tileInitial: { fontSize: 11, fontWeight: '700' },
  tileHandle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  /*
   * Below the two labels, in the corner nothing else wants.
   *
   * The top strip is now a line of text at each end — who added it and when —
   * and a third thing in it would be a control competing with two labels for
   * the same forty points. Down here it is the only thing in its corner, which
   * is what a control should be.
   */
  tileSave: { position: 'absolute', right: 10, bottom: 10, padding: 4 },
  /* Opposite the save, and short of it: the two never meet however many
     comments a photograph collects. */
  tileSaid: {
    position: 'absolute',
    left: 10,
    bottom: 14,
    maxWidth: '72%',
    fontSize: 12.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  /*
   * Opposite the byline, pinned to the corner rather than trailing the handle.
   *
   * Riding on the end of a name means landing somewhere different on every row,
   * and a date that moves is a date nobody reads. Dimmer than the handle: it is
   * the part you check rather than the part you read.
   */
  tileWhen: {
    position: 'absolute',
    top: 10,
    right: 10,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.78)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  uploadBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2.5,
    zIndex: 3,
  },
  /*
   * How much of the header dissolves into the page.
   *
   * Ten, and it has been eighteen and forty on the way here. The failure at
   * every length is the same one: the page below is the colour this fades to,
   * so a long ramp does not read as the header ending softly — it reads as the
   * page starting higher up than it does, and the header looks like it has been
   * cropped short. Only the last few points can belong to both.
   *
   * With the bias below, the ramp itself is about six points. That is enough to
   * have no line in it and not enough to be a band, which is the whole brief.
   *
   * It also keeps the fade clear of the album's name, which sits at the foot of
   * the header and reaches into this when it wraps to two lines.
   */
  coverFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 10 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* The sentence and its remedy on one line, the remedy at the end of it where
     a thumb already is rather than under it as a third stacked thing. */
  queueLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  queueText: { flex: 1, fontSize: 13, lineHeight: 18 },
  queueDo: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  upgrade: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12, marginHorizontal: 16, marginBottom: 10 },
  /* --- the album, folded up ---------------------------------------------

     The head the thread and the roster get: the same event, with its cover
     shrunk to a thumbnail so that the conversation has the screen. */
  /* 72 to the first line of it, which is this file's standing allowance for
     the status bar — the same number every scroll screen here starts at. The
     design measures 14 from the bottom of the bar; there is no safe-area
     library in this project, so the allowance is the one constant rather than
     a second guess at how tall a notch is. */
  head: { borderBottomWidth: 1, paddingTop: 72, paddingHorizontal: 16, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headBack: { fontSize: 22, lineHeight: 24 },
  headThumb: { width: 38, height: 38, borderRadius: 10 },
  headName: { fontSize: 18, fontWeight: '700' },
  headMeta: { fontSize: 12.5 },
  sharePill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 13 },
  sharePillText: { fontSize: 13.5, fontWeight: '600' },
  headMore: { fontSize: 18, fontWeight: '600' },
  headTabs: { marginTop: 12 },
  /* --- Photos · Talk · People -------------------------------------------

     A well with a card in it, which is the shape iOS uses and the reason the
     selected pane needs no second colour to be legible. */
  segmented: { flex: 1, flexDirection: 'row', gap: 4, borderRadius: 10, padding: 3 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
  },
  segmentOn: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentCount: { fontSize: 13, fontWeight: '700' },
  /* --- somebody said something -------------------------------------------

     One line that drops in over the cover and takes itself away again. The
     shell carries the shadow and the blur is clipped inside it, for the same
     reason the tab bubble is two views. */
  bannerShell: {
    position: 'absolute',
    top: 76,
    left: 12,
    right: 12,
    zIndex: 4,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  /* Light in both themes, and not an oversight: it sits over a photograph
     rather than over the page, so it takes its contrast from the cover
     underneath it and not from whichever theme the phone is in. The ink is
     fixed for the same reason. */
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 14,
    overflow: 'hidden',
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.93)',
  },
  /*
   * The saved note, at the foot rather than at the top.
   *
   * The unread banner has the top of this screen, and the two can be up at
   * once — somebody saves a photograph in an album whose conversation is
   * moving. Stacking them would be two white slabs in one corner; the banner
   * is also the only one of the two that can be pressed, so it keeps the place
   * a thumb goes.
   *
   * Above where the viewer's own chrome sits, because this is drawn inside
   * that modal as well as in the album behind it.
   */
  savedShell: {
    position: 'absolute',
    bottom: 112,
    left: 12,
    right: 12,
    zIndex: 5,
    alignItems: 'center',
  },
  /* Light in both themes, like the banner and for the same reason: it sits
     over a photograph rather than over the page, so it takes its contrast from
     the picture underneath and not from whichever theme the phone is in. */
  savedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 9,
    paddingHorizontal: 15,
    backgroundColor: 'rgba(255,255,255,0.93)',
  },
  savedText: { fontSize: 14, fontWeight: '600', color: '#14171c' },
  bannerFace: { width: 24, height: 24, borderRadius: 12 },
  bannerFaceLetter: { fontSize: 11, fontWeight: '700' },
  bannerText: { flex: 1, minWidth: 0, fontSize: 14 },
  bannerName: { fontWeight: '700' },
  bannerCount: { fontSize: 12, color: '#5b6472' },
  /* --- the sheet behind `⋯` ---------------------------------------------- */
  sheetScroll: { gap: 10, paddingBottom: 10 },
  sheetRow: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 2 },
  /* Taller than a single-line field and top-aligned, because a caption is a
     sentence: two hundred characters is three lines on this width, and a box
     that shows one of them hides most of what somebody wrote. */
  /* One line, unlike the caption box this replaced: a name is a name, and a
     three-line field invites a sentence into a slot that shows one line
     everywhere it is drawn. */
  nameField: { marginTop: 8, marginBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /* A kept-alive tab. `position: 'absolute'` so the four of them stack rather
     than sitting in a column — only one is ever visible, and a hidden sibling
     taking part in the layout would halve the height of the one that is not. */
  pane: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  paneHidden: { display: 'none' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 12,
  },
  scroll: { padding: 20, paddingTop: 72, gap: 14 },
  /* Three across with hairline gaps, running under the safe area rather than
     stopping above it: the grid is one object and the last row of it being cut
     by the screen's edge is what says there is more. */
  /* No side gutter: the photographs run to both edges, as the home cards do. */
  gridContent: { paddingBottom: 12, gap: PHOTO_GAP },
  /* The pager holds two full-width pages, so it must not shrink to its
     content: without `flex` the lists have no height to scroll inside. */
  pager: { flex: 1 },
  /* `flex-start`, so a last row of one or two starts at the left edge and
     stops. The default is `stretch`, which on a row of fixed-width children
     does nothing — but it is the pairing that matters: the tiles are sized in
     the component (see `gridTile` there, which needs the screen's width) and
     this row must not try to distribute them. */
  gridRow: { gap: PHOTO_GAP, justifyContent: 'flex-start' },
  gridShot: { width: '100%', height: '100%', backgroundColor: '#8883' },
  /*
   * The face in a tile's corner, with a shadow under it.
   *
   * The column's byline needs no shadow because its handle has one and the two
   * read together. Alone on a photograph the face has to hold its own edge, and
   * a pale avatar on a bright sky is otherwise a smudge — so the shadow is on
   * the wrapper rather than the image, which is what lets the picture keep its
   * corners clipped while the shadow falls outside them.
   */
  gridBy: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  /* 16 rather than the column's 24: a tile is a third of the screen, and the
     same face drawn at the same size would be a fifth of the photograph. The
     corner is a quarter of the box, as everywhere else this product draws
     somebody. */
  gridFace: { width: 16, height: 16, borderRadius: 4 },
  gridFaceBlank: { alignItems: 'center', justifyContent: 'center' },
  gridInitial: { fontSize: 8, fontWeight: '700' },
  /*
   * The bar that says which view is showing, and nothing else.
   *
   * It had a white strip behind it, which made three pieces of chrome between
   * the tabs and the photographs where two will do — and a white one in dark
   * mode besides. What is left is the space, which the album's own background
   * shows through.
   */
  viewBar: { paddingTop: 6, paddingBottom: 6 },
  /* The two halves of the screen, each with its glyph in the middle of it: the
     left one opens the view on the left and the right one the view on the
     right, so where the control sits is also what it does. */
  viewTrack: { flexDirection: 'row', paddingHorizontal: 20 },
  /* Tall enough to be a target rather than a picture. 34 against an 18pt glyph
     is 8 points of slop each side, which is what stops a press at the top of a
     scrolling album from landing on the first row of photographs instead. */
  viewSegment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 26, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  /* One floating control, where there were two bars.

     The tab bar spanned the screen with a hairline on top, and a join pill sat
     as a rounded slab pressed against it — two different shapes stacked at the
     bottom of every screen, neither of them the shape iOS itself now uses. The
     pill is gone entirely (its screen is a header action on Events now, where
     somebody who has just been sent a link is looking), and what is left
     floats: clear of the edges, clear of the home indicator, with the
     photographs running underneath it.

     The shadow is what makes it read as floating; the blur is what makes it
     read as glass rather than as a slab hovering over the page.

     That blur is `expo-blur`, and it is the one place a `BlurView` belongs
     here. The README's rule is about event *cards*, where a BlurView would
     sample the white card behind it rather than the photographs — which is why
     those use `blurRadius` on `expo-image` instead. Chrome is the opposite
     case: sampling what is behind it is the entire job. */
  tabShell: {
    position: 'absolute',
    left: FLOAT_INSET,
    right: FLOAT_INSET,
    bottom: BUBBLE_BOTTOM,
    borderRadius: 999,
    ...FLOAT_SHADOW,
  },
  tabBar: {
    /* Above the home indicator rather than padded around it.

       The old bar reached the bottom of the screen and reserved 24pt inside
       itself for the indicator — a constant standing in for a safe-area
       library. Floating removes the guess: the whole bubble sits clear of that
       strip, so a phone without an indicator loses nothing and one with it
       needs no allowance. */
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    flexDirection: 'row',
    padding: 8,
  },
  /* Each tab is a capsule inside the capsule, which is what seats the selected
     one without a second colour: the fill is a wash of the page's own value
     through the glass, the way the system tab bar does it. The glyph inside is
     what actually says which tab you are on — see the note at the call site. */
  /* The glyph is centred in the capsule and 22 points across, which is the
     size the web rail draws the same drawings at. The vertical padding is what
     the four labels used to need and is kept: the bubble's height is the one
     measurement on this screen that people's thumbs have learned. */
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 999 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  /* The two who-can-see-it pills, the same shape the create screen asks the
     same question with — one control, one look, wherever it is asked. */
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  button: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  listRow: { paddingVertical: 10 },
  tile: { flex: 1 },
  /* 4:5 rather than square, and no radius.
     A 1:1 crop takes the ends off everything shot in portrait, which is most
     of what a phone shoots at an evening; 4:5 is the tallest shape that still
     fits two photographs on a screen, so the column still reads as a list
     rather than as one picture at a time. */
  thumb: { width: '100%', aspectRatio: 4 / 5, backgroundColor: '#8883' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  /* The same thing without the press handling: the dim is a separate view
     underneath now, so this one only decides where the sheet sits. */
  sheetShell: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  sheet: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
    maxHeight: '86%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  sheetImage: { width: '100%', height: 240, borderRadius: 10, backgroundColor: '#8883' },
  // A card in the same family as `card`, laid out sideways: the picture reads
  // first, the words explain it. 3:2 rather than square, because that is the
  // shape a cover is drawn in on the home screen.
  coverRow: { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' },
  coverShot: { width: 66, height: 44, borderRadius: 8, backgroundColor: '#8883' },
  coverEmpty: { width: 66, height: 44, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed' },
  coverWords: { flex: 1, gap: 2 },
  /* Under the title, in the quieter type: the row is a picture and one line
     of words, and the line has to carry what pressing it does. */
  coverHint: { fontSize: 13, lineHeight: 18 },
  /* Not a button. A bordered control for "remove" beside a bordered control
     for "change" is two objects of equal weight offering a common action and
     a rare destructive one; a line of red text under the picture is read by
     whoever is looking for it and by nobody else. */
  coverOff: { paddingVertical: 10, paddingHorizontal: 4, alignSelf: 'flex-start' },
  coverOffText: { fontSize: 14.5, fontWeight: '600' },
  coverTitleText: { fontSize: 16, fontWeight: '600' },
  coverNote: { fontSize: 13 },
  /* Above the sheet, at the album's own back-button inset — so leaving the
     sheet and leaving the screen are the same gesture in the same place. It
     rides on the sheet's top edge rather than sitting at a fixed height,
     because the sheet is as tall as its contents. */
  sheetBack: { alignSelf: 'flex-start', marginLeft: 16, marginBottom: 12 },
  actions: { flexDirection: 'row', paddingTop: 2, paddingBottom: 6 },
  /* Thirds. Equal columns rather than content-width, so the three glyphs line
     up whatever their labels say — "Link copied" is four characters longer
     than "Copy link" and the row must not shuffle when it flips. */
  action: { flex: 1, alignItems: 'center', gap: 8 },
  actionDisc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  /* Roughly what the cover row and one card would have occupied, so the sheet
     does not have to stand up once it knows what it is. */
  sheetWaiting: { height: 160, alignItems: 'center', justifyContent: 'center', padding: 24 },
  /* Who is already named, as chips that come off when pressed. */
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tagName: { fontSize: 14.5, fontWeight: '600' },
  tagX: { fontSize: 16, lineHeight: 18 },
  /* Bounded, so a room of thirty does not push the field off the sheet. */
  tagList: { maxHeight: 220 },
  tagPick: { paddingVertical: 11, borderBottomWidth: 1, gap: 2 },
  /* The bar that rides on top of the keyboard. Right-aligned, because that is
     where every system one puts its Done. */
  keyBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  keyBarDone: { fontSize: 16, fontWeight: '600' },
  /*
   * The sheet, at the top, for the one state that has a keyboard under it.
   *
   * Clear of the status bar and the notch, and bounded so a long roster
   * scrolls inside the panel rather than growing it off the bottom of the
   * screen and back under the keys it was moved to escape.
   */
  sheetTop: { flex: 1, justifyContent: 'flex-start', paddingTop: 64, backgroundColor: '#000b' },
  sheetTopPanel: {
    marginHorizontal: 12,
    borderRadius: 18,
    maxHeight: '70%',
  },
});

/** Rough, and rounded up: this number exists to prevent a surprise, not to be exact. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.ceil(bytes / 1024 ** 2)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
