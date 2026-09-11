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
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { resolveWindow, type Window } from '@parea/autoselect';
import { CARD_FACES, dateLabel } from '@parea/cards';

import {
  Api,
  ApiError,
  tokenFromInput,
  type EventListing,
  type Feed,
  type FeedPhoto,
  type Member,
  type MyGroupDetail,
} from './src/api';
import { Glyph, type GlyphName } from './src/Glyph';
import { initialOf, lensFor } from './src/lens';
import { People, Thread } from './src/Thread';
import { AccountCard, GroupsTab, HomeTab, SearchTab } from './src/Events';
import { CreateEvent } from './src/CreateEvent';
import { DoorScreen } from './src/Door';
import { GroupScreen, GroupSearch } from './src/Groups';
import { GroupThread } from './src/GroupThread';
import { InviteCard } from './src/InvitePeople';
import { PersonScreen } from './src/Person';
import { SwipeBack } from './src/SwipeBack';
import { ProfileScreen } from './src/Profile';
import { arrivalFromUrl } from './src/links';
import { notificationTarget } from './src/notifications';
import { AutoSelect } from './src/AutoSelect';
import {
  libraryAccess,
  requestLibraryAccess,
  resolveForUpload,
  type LibraryAccess,
} from './src/library';
import { Platform as RNPlatform } from 'react-native';

import {
  BACKGROUND_UPLOAD_SUPPORTED,
  loadActorToken,
  pushAlreadyAsked,
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
type Tab = 'home' | 'groups' | 'search' | 'profile';

/**
 * Which pane of an event is up — its photographs, its conversation, or who is
 * in it. Three panes of one screen rather than three screens: they are all
 * about the same evening, and pushing the thread as its own route would give
 * the conversation a back button to the album it is already inside.
 */
type Pane = 'photos' | 'talk' | 'people';

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
  | { screen: 'groupThread'; group: MyGroupDetail }
  | { screen: 'person'; handle: string }
  | { screen: 'create'; groupId?: string; groupName?: string };

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
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [arriving, setArriving] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const open = useCallback(async (event: SavedEvent, pane?: Pane) => {
    setRemembered(await rememberEvent(event));
    setRoute({ screen: 'event', event, pane });
  }, []);

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
  const refreshEvents = useCallback(async () => {
    const next = await api.myEvents().catch(() => null);
    if (next) setEvents(next);
    setLoadingEvents(false);
  }, [api]);

  const openListing = useCallback(
    (event: EventListing) =>
      open({
        id: event.id,
        name: event.name,
        linkToken: event.linkToken,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      }),
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
    setSignedIn(false);
    setRoute({ screen: 'tabs' });
    setTab('home');
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
  }, [api, arrive, follow, refreshEvents, refreshGroups]);

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
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
            webBase={API_BASE}
            t={t}
            dark={dark}
            signedIn={signedIn}
            onSignedIn={refreshAccount}
            Button={Button}
            onBack={leaveEvent}
            onOpenGroup={(id) => setRoute({ screen: 'group', id })}
            onGroupsChanged={refreshGroups}
          />
        </SwipeBack>
      )}

      {route.screen === 'create' && signedIn === false && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <AccountCard
            api={api}
            t={t}
            Button={Button}
            gate
            why="Making an event needs an account, so the people you invite know whose event it is."
            onSignedIn={() => {
              void refreshAccount();
              void refreshEvents();
            }}
          />
        </ScrollView>
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
          webBase={API_BASE}
          groupId={route.groupId}
          groupName={route.groupName}
          t={t}
          onCancel={() =>
            setRoute(
              route.groupId
                ? { screen: 'group', id: route.groupId }
                : { screen: 'tabs' },
            )
          }
          onCreated={(created) => {
            void refreshGroups();
            void open({
              id: created.id,
              name: created.name,
              linkToken: created.linkToken,
              startsAt: created.startsAt,
              endsAt: created.endsAt,
            });
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
            onCreateEvent={(name) => setRoute({ screen: 'create', groupId: route.id, groupName: name })}
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
          onCreateEvent={() => setRoute({ screen: 'create' })}
          onJoin={join}
          onBack={() => setRoute({ screen: 'tabs' })}
          busy={arriving}
          error={joinError}
        />
      )}

      {route.screen === 'tabs' && (
        <>
          {tab === 'home' && (
            <HomeTab
              api={api}
              events={events}
              loading={loadingEvents}
              t={t}
              onOpen={openListing}
              onRefresh={refreshEvents}
              onCreate={() => setRoute({ screen: 'create' })}
              // The join screen's only way in, now that the pill above the tab
              // bar is gone: a link, a QR code or a spoken phrase.
              onOpenLink={() => setRoute({ screen: 'join' })}
              Button={Button}
            />
          )}
          {tab === 'groups' && (
            <GroupsTab
              api={api}
              // The covers under each group's name come off this list — the
              // albums this actor can already open — and never off the group.
              // See the note at the top of `GroupsTab`.
              events={events}
              t={t}
              openCreate={makeGroup}
              onOpenGroup={(id) => setRoute({ screen: 'group', id })}
              onOpenGroupThread={(group) => setRoute({ screen: 'groupThread', group })}
              // The album, opened on the conversation rather than on the
              // photographs — the one entry point allowed to ask for that.
              onOpenEventThread={(listing) => {
                void open(listing, 'talk');
              }}
              onGoToEvents={() => setTab('home')}
            />
          )}
          {tab === 'search' && (
            <SearchTab
              api={api}
              events={events}
              t={t}
              onOpen={openListing}
              onOpenGroup={(id) => setRoute({ screen: 'group', id })}
              onOpenPerson={(handle) => setRoute({ screen: 'person', handle })}
            />
          )}
          {tab === 'profile' && (
            <ProfileScreen
              api={api}
              events={events}
              webBase={API_BASE}
              t={t}
              onOpen={openListing}
              onCreateEvent={() => setRoute({ screen: 'create' })}
              onCreateGroup={() => {
                setTab('groups');
                setMakeGroup((n) => n + 1);
              }}
              onSignedIn={() => {
                // The account may speak for another device's actor, so what
                // this person can reach has just changed.
                void refreshEvents();
                void refreshGroups();
              }}
              onSignedOut={signOut}
              Button={Button}
            />
          )}

          {/*
            Two views for one bubble, and the nesting is not decoration: iOS
            clips a layer's shadow the moment `overflow: 'hidden'` is set, and
            the blur needs exactly that to be clipped into a capsule. So the
            outer view carries the shadow and the inner one carries the blur.
          */}
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
                  ['home', 'photos', 'Events'],
                  ['groups', 'group', 'Groups'],
                  ['search', 'search', 'Find'],
                  ['profile', 'profile', 'You'],
                ] as [Tab, GlyphName, string][]
              ).map(([id, glyph, label]) => (
                <Pressable
                  key={id}
                  style={[
                    styles.tab,
                    // Translucent, not the page colour: over a blur an opaque
                    // fill reads as a patch stuck on the glass. See the note on
                    // `tab` in the stylesheet.
                    tab === id && { backgroundColor: dark ? '#ffffff1f' : '#0000000f' },
                  ]}
                  onPress={() => setTab(id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === id }}
                  accessibilityLabel={label}
                >
                  <Glyph name={glyph} size={22} color={tab === id ? t.accent : t.dim} />
                </Pressable>
              ))}
            </BlurView>
          </View>
        </>
      )}

      {/*
        A tapped link can land while the app is already somewhere else.
        Without this the screen simply changes under someone who is watching
        an upload, with no account of why.
      */}
      {arriving && route.screen !== 'join' && (
        <View style={[styles.center, styles.overlay]}>
          <ActivityIndicator color={t.accent} />
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
      <Button label="Create Event" onPress={onCreateEvent} t={t} />

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
const PAGE_TOP = 248;

function EventScreen({
  api,
  event,
  initialPane,
  webBase,
  t,
  dark,
  signedIn,
  onSignedIn,
  Button: ButtonEl,
  onBack,
  onOpenGroup,
  onGroupsChanged,
}: {
  api: Api;
  event: SavedEvent;
  /** Which pane to land on. See the `useState` below for why it is optional. */
  initialPane?: Pane;
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
  onGroupsChanged: () => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [waitingForNetwork, setWaitingForNetwork] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedPhoto | null>(null);
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

  useEffect(() => {
    void libraryAccess().then(setAccess);
  }, []);

  const [feedError, setFeedError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFeed(await api.feed(event.id, event.linkToken));
      // The server has spoken, so the local guess is no longer needed. Left
      // standing, it would outrank a change made on another device.
      setPolicy(null);
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

  /** Resume anything left over from a previous launch, before anything else. */
  useEffect(() => {
    (async () => {
      const state = await loadQueue();
      if (state.items.length === 0) return;
      await runQueue(state);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runQueue = useCallback(
    async (state?: Awaited<ReturnType<typeof loadQueue>>) => {
      const queue = new UploadQueue(
        {
          presign: (eventId, files) => api.presign(eventId, event.linkToken, files),
          upload: uploadItem,
          complete: (photoId) => api.complete(photoId, event.linkToken),
          save: saveQueue,
        },
        state ?? (await loadQueue()),
      );

      const tick = setInterval(() => {
        setQueueStatus(
          queue.pendingCount > 0
            ? `${queue.doneCount} of ${queue.doneCount + queue.pendingCount} added`
            : null,
        );
      }, 400);

      try {
        await queue.run();
      } finally {
        clearInterval(tick);
        queue.prune();
        await saveQueue(queue.state);
        // Three outcomes, not two. "Waiting" and "failed" ask opposite things
        // of a person: one is do nothing, the other is try again.
        setWaitingForNetwork(queue.waitingForNetwork);
        setQueueStatus(
          queue.waitingForNetwork
            ? `${queue.pendingCount} waiting for a connection`
            : queue.failedCount > 0
              ? `${queue.failedCount} didn't upload`
              : null,
        );
        await refresh();
      }
    },
    [api, event, refresh],
  );

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

  const addPhotos = useCallback(async () => {
    // With library access and a known window, offer the photos rather than
    // asking someone to find them — the reason this client exists (§7.1).
    const window = windowFor();
    if ((access === 'granted' || access === 'limited') && window) {
      setAutoWindow(window);
      return;
    }

    // Otherwise the system picker: no permission prompt at all, and no library
    // access. The upgrade that unlocks auto-selection is offered after a
    // contribution, never in front of the first one — design §7.4.
    const picked = await ImagePicker.launchImageLibraryAsync({
      // Photos only. Nothing downstream can handle a video — the deriver makes
      // AVIF, WebP and JPEG renditions with sharp — so offering one here means
      // it uploads, never becomes `ready`, and simply never appears. Failing
      // in the picker, where it cannot be chosen, beats failing silently
      // twenty minutes later.
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      exif: false,
    });
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
  }, [access, enqueue, windowFor]);

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
   * the feed did not say whether a cover existed — so "Event cover" meant "there
   * may or may not be one, press to find out", and "Remove it" was offered on
   * events with nothing to remove. The feed carries `coverUrl` now, so the row
   * shows the picture and the sheet only offers removal when there is something
   * to take away.
   *
   * Still a sheet rather than two buttons on the screen: replacing a cover is
   * the common case and removing one is rare, and the rare destructive action
   * is better one press further away than sitting next to the ordinary one.
   */
  const cover = feed?.event.coverUrl ?? null;

  const editCover = useCallback(() => {
    const actions: Parameters<typeof Alert.alert>[2] = [
      {
        text: cover ? 'Choose a different photo' : 'Choose a photo',
        onPress: async () => {
          const picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: false,
            // Re-encoded out of the picker, which is most of the difference
            // between a two-megabyte request and a twelve-megabyte one. The
            // server re-encodes again, to the size it actually draws.
            quality: 0.8,
            exif: false,
          });
          if (picked.canceled || !picked.assets[0]) return;
          const target = api.coverTarget(event.id);
          try {
            await uploadCover(target.url, target.headers, picked.assets[0].uri);
            // The screen draws the cover now, so it has to be re-read: without
            // this you chose a photograph, nothing moved, and the only way to
            // find out whether it took was to leave and come back.
            await refresh();
          } catch {
            // Worth saying here, unlike on the create screen: there is no
            // share sheet to get on with, and somebody who just chose a
            // picture is watching for it to take.
            Alert.alert('Could not set the cover', 'Try again in a moment.');
          }
        },
      },
    ];

    if (cover) {
      actions.push({
        text: 'Remove it',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeCover(event.id);
            await refresh();
          } catch {
            Alert.alert('Could not remove the cover', 'Try again in a moment.');
          }
        },
      });
    }

    actions.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(
      'Event cover',
      cover
        ? 'The picture the event leads with, wherever it is shown.'
        : 'Choose the picture the event leads with. Without one it leads with its newest photograph.',
      actions,
    );
  }, [api, cover, event.id, refresh]);

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
  const markRead = useCallback(() => {
    setSeen(messages.length);
    void api.markEventRead(event.id, event.linkToken).catch(() => {});
  }, [api, event.id, event.linkToken, messages.length]);

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

  const shareLink = useCallback(() => {
    // The link alone. The name arrives with it — a shared link unfurls into a
    // card carrying the event's title, so putting it in the message body as
    // well says it twice.
    void Share.share({ message: `${webBase}/e/${event.linkToken}` });
  }, [event.linkToken, webBase]);

  /** Whichever way in `+` takes: the picker, or the account it first needs. */
  const add = useCallback(() => {
    if (signedIn === false) return setGateOpen(true);
    void addPhotos();
  }, [addPhotos, signedIn]);

  if (autoWindow) {
    return (
      <AutoSelect
        window={autoWindow}
        theme={t}
        onCancel={() => setAutoWindow(null)}
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
          <ExpoImage
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
          />
        ) : (
          // No cover and nothing to borrow: the event's own lens, which is
          // the same letter-on-a-colour every other doorless thing in the
          // product gets. Never a photograph pulled out of the grid — that
          // is a decision about which evening this was, made by an
          // upload's timestamp.
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
      </View>

      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={styles.coverBack}
        accessibilityRole="button"
        accessibilityLabel="All events"
      >
        <Text style={styles.coverBackText}>‹ All events</Text>
      </Pressable>

      {/*
        Everything this screen used to stack, behind one glyph.

        Eight full-width slabs sat between the name and the first
        photograph — share, save, who can see it, the cover, asking people
        in, starting a group — so that opening an album showed you a column
        of settings and, if you scrolled, some photographs. They are the
        same actions with the same copy and the same calls; they are in a
        sheet now, which is where an album's settings go.
      */}
      <Pressable
        onPress={() => setSheetOpen(true)}
        hitSlop={8}
        style={styles.coverMore}
        accessibilityRole="button"
        accessibilityLabel="Event options"
      >
        <BlurView intensity={10} tint="dark" style={styles.coverMoreBlur}>
          <Text style={styles.coverMoreGlyph}>⋯</Text>
        </BlurView>
      </Pressable>

      <View style={styles.coverTitle} pointerEvents="box-none">
        <Text style={styles.coverName} numberOfLines={2}>
          {event.name}
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
          <Pressable
            onPress={add}
            disabled={feed?.event.uploadsOpen === false}
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: t.card,
                borderColor: t.line,
                opacity: feed?.event.uploadsOpen === false ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Glyph name="plus" size={18} color={t.fg} />
          </Pressable>
        </View>

        {pane === 'photos' ? (
          <>
            {/*
              The transient lines, which are the only things still allowed
              between the tabs and the grid: an upload in flight and the one
              offer that is made after a contribution rather than in front of
              it. Both go away on their own.
            */}
            {queueStatus && (
              <Text style={[styles.queueLine, { color: t.dim }]}>
                {queueStatus}
                {waitingForNetwork
                  ? // Nothing is lost and nothing needs doing. Saying this
                    // plainly is the difference between someone waiting and
                    // someone force-quitting the app on their photos.
                    ' — they are saved and will go up on their own.'
                  : !BACKGROUND_UPLOAD_SUPPORTED &&
                    ' — keep the app open until this finishes'}
              </Text>
            )}

            {offerUpgrade && (
              <View
                style={[styles.upgrade, { backgroundColor: t.card, borderColor: t.line }]}
              >
                <Text style={[styles.body, { color: t.fg }]}>
                  Next time we can find them for you — pick out the photos from
                  the event so you do not have to scroll. Your photos stay on
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

            <FlatList
              data={feed?.photos ?? []}
              keyExtractor={(photo) => photo.id}
              numColumns={3}
              columnWrapperStyle={styles.gridRow}
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
              renderItem={({ item }) => (
                <Pressable style={styles.tile} onPress={() => setSelected(item)}>
                  {/*
                    The 640 rather than the 320. A tile is a third of the
                    screen's width, which is 390 device pixels on a 3× phone —
                    `src` is a 320 and was being scaled up into it. `card` is
                    null only before the deriver has been round, and `src` is
                    then the only thing that exists.
                  */}
                  <ExpoImage
                    source={{ uri: item.card ?? item.src }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={120}
                  />
                </Pressable>
              )}
            />
          </>
        ) : pane === 'talk' ? (
          <Thread
            actions={eventThread}
            messages={messages}
            canPost={feed?.canPost ?? false}
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
          <People roster={feed?.roster ?? []} t={t} />
        )}
      </View>

      {/*
        One line, over the cover, when somebody says something while you
        are looking at the photographs. It is the whole of the notification
        this screen needs: who, what they said, and how many are waiting.

        Over the photographs only. It is a way *into* the conversation, so on
        the conversation it would be a banner announcing the thing directly
        underneath it, and on the roster it would sit over the first two
        people for no reason.
      */}
      {pane === 'photos' && latest && unread > 0 && !bannerGone && (
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
          onShare={shareLink}
          onSaveAll={saveAll}
          onEditCover={editCover}
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

      {selected && (
        <PhotoActions
          api={api}
          photo={selected}
          t={t}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
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
    ['talk', 'plane', 'Talk'],
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
 * Share and save for anybody who can see it; the cover, who can see it, asking
 * people in and starting a group for whoever runs it. The copy, the order of
 * the questions and every call they make are the ones `EventScreen` already
 * made — this is where they are, not what they do.
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
  Button: ButtonEl,
  onClose,
  onShare,
  onSaveAll,
  onEditCover,
  onPolicy,
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
  Button: typeof Button;
  onClose: () => void;
  onShare: () => void;
  onSaveAll: () => void;
  onEditCover: () => void;
  onPolicy: (value: 'public' | 'private') => void;
  onGroup: (name: string) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState('');
  const host = feed?.event.canAdminister === true;
  const visible = (policy ?? feed?.event.accessPolicy) ?? 'public';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.bg }]} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.sheetScroll}>
            <Row label="Share" note="Send the link to whoever should be in it." onPress={onShare} t={t} />
            {(feed?.photos.length ?? 0) > 0 && (
              <Row
                label={saving ?? 'Save all to my camera roll'}
                note="Full quality or smaller copies — it asks which."
                onPress={onSaveAll}
                disabled={saving !== null}
                t={t}
              />
            )}

            {feed?.event.groupId && (
              <Row
                label={`in ${feed.event.groupName}`}
                note="Open the group this event is in."
                onPress={() => {
                  onClose();
                  onOpenGroup(feed.event.groupId!);
                }}
                t={t}
              />
            )}

            {host && (
              <Pressable
                onPress={onEditCover}
                style={({ pressed }) => [
                  styles.coverRow,
                  { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={cover ? 'Change the event cover' : 'Choose an event cover'}
              >
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.coverShot} resizeMode="cover" />
                ) : (
                  // Dashed, which means "nothing here" rather than "a very dark
                  // photograph" — the same call the web's empty tile makes.
                  <View style={[styles.coverEmpty, { borderColor: t.line }]} />
                )}
                <View style={styles.coverWords}>
                  <Text style={[styles.coverTitleText, { color: t.fg }]}>Event cover</Text>
                  <Text style={[styles.coverNote, { color: t.dim }]}>
                    {cover
                      ? 'What this event leads with everywhere.'
                      : 'Leading with its newest photograph.'}
                  </Text>
                </View>
              </Pressable>
            )}

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
              The other door into a private album, and the one the app did not
              have: somebody who made one could send the link and wait to be
              asked, but could not ask anybody.
            */}
            {host && <InviteCard api={api} t={t} eventId={event.id} Button={ButtonEl} />}

            {/*
              Only the host, and only for an event that is not already in one.
              The pitch is the recurrence, not the feature: nobody wants "a
              group", they want to stop sending the link every time.
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
                      Do this often with these people? A group keeps the events
                      together, so you only send the link once.
                    </Text>
                    <Button
                      label="Start a group from this event"
                      onPress={() => setNaming(true)}
                      t={t}
                    />
                  </>
                )}
              </View>
            )}

            <Button label="Done" onPress={onClose} t={t} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One action in the sheet: what it does, and one line about what that means. */
function Row({
  label,
  note,
  onPress,
  disabled,
  t,
}: {
  label: string;
  note: string;
  onPress: () => void;
  disabled?: boolean;
  t: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.sheetRow,
        {
          backgroundColor: t.card,
          borderColor: t.line,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.coverTitleText, { color: t.fg }]}>{label}</Text>
      <Text style={[styles.coverNote, { color: t.dim }]}>{note}</Text>
    </Pressable>
  );
}

// --- per-photo safety actions -------------------------------------------------

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
  t,
  onClose,
  onChanged,
}: {
  api: Api;
  photo: FeedPhoto;
  t: Theme;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

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

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Image source={{ uri: photo.full }} style={styles.sheetImage} />
          {photo.mine ? (
            <Button
              label="Remove my photo"
              t={t}
              primary
              disabled={busy}
              onPress={() =>
                act('Removed', () => api.removeOwn(photo.id), 'It is gone.')
              }
            />
          ) : (
            <>
              <Button
                label="That's me — take it down"
                t={t}
                disabled={busy}
                onPress={() =>
                  act(
                    'Asked',
                    () => api.removalRequest(photo.id),
                    'The host has 48 hours to answer, then it hides automatically.',
                  )
                }
              />
              <Button
                label="Report"
                t={t}
                disabled={busy}
                onPress={() =>
                  act('Reported', () => api.report(photo.id), 'Someone will look at it.')
                }
              />
              <Button
                label="Block this person"
                t={t}
                disabled={busy}
                onPress={() =>
                  act(
                    'Blocked',
                    () => api.block(photo.id),
                    'You will not see their photos. They are not told.',
                  )
                }
              />
            </>
          )}
          <Button label="Close" t={t} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

// --- chrome -------------------------------------------------------------------

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
  return dark
    ? { bg: '#0d0f12', card: '#171a1f', line: '#272b33', fg: '#f2f4f7',
        dim: '#9aa3af', accent: '#6ea8fe', onAccent: '#0d0f12' }
    : { bg: '#f7f8fa', card: '#ffffff', line: '#e3e6ea', fg: '#14171c',
        dim: '#5b6472', accent: '#1a5fd0', onAccent: '#ffffff' };
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
  cover: { position: 'absolute', top: 0, left: 0, right: 0, height: 232 },
  coverBack: { position: 'absolute', top: 46, left: 16, zIndex: 3 },
  coverBackText: { fontSize: 15, color: '#fff' },
  coverMore: { position: 'absolute', top: 40, right: 16, zIndex: 3 },
  /* Glass rather than a solid disc: it sits on a photograph nobody chose for
     it, and a grey circle is a hole in whatever is behind it. */
  coverMoreBlur: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,23,28,0.38)',
  },
  coverMoreGlyph: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 18 },
  coverTitle: { position: 'absolute', top: 140, left: 20, right: 20, zIndex: 3, gap: 6 },
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
  page: { position: 'absolute', top: 248, left: 0, right: 0, bottom: 0 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueLine: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 8 },
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
  bannerFace: { width: 24, height: 24, borderRadius: 12 },
  bannerFaceLetter: { fontSize: 11, fontWeight: '700' },
  bannerText: { flex: 1, minWidth: 0, fontSize: 14 },
  bannerName: { fontWeight: '700' },
  bannerCount: { fontSize: 12, color: '#5b6472' },
  /* --- the sheet behind `⋯` ---------------------------------------------- */
  sheetScroll: { gap: 10, paddingBottom: 10 },
  sheetRow: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  gridContent: { paddingHorizontal: 12, paddingBottom: 12, gap: 3 },
  gridRow: { gap: 3 },
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
  /* Each tab is a capsule inside the capsule, which is what makes the selected
     one legible without a second colour: the fill is the page's own background
     showing through the bar, the way the system tab bar seats its selection. */
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
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 6, backgroundColor: '#8883' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
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
  coverTitleText: { fontSize: 16, fontWeight: '600' },
  coverNote: { fontSize: 13 },
});

/** Rough, and rounded up: this number exists to prevent a surprise, not to be exact. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.ceil(bytes / 1024 ** 2)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
