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

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
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

import {
  Api,
  ApiError,
  tokenFromInput,
  type EventListing,
  type Feed,
  type FeedPhoto,
} from './src/api';
import { AccountCard, GroupsTab, HomeTab, ProfileTab, SearchTab } from './src/Events';
import { CreateEvent } from './src/CreateEvent';
import { DoorScreen } from './src/Door';
import { GroupScreen, GroupSearch } from './src/Groups';
import { PersonScreen } from './src/Person';
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

type Route =
  | { screen: 'tabs' }
  | { screen: 'join' }
  | { screen: 'event'; event: SavedEvent }
  /**
   * The door of a private album — a real link to one that has not let this
   * person in. A screen rather than an error string on the join screen,
   * because a deep link can arrive from anywhere: the app may be sitting
   * inside another event or not running at all, and there would be no join
   * screen to put the message on.
   */
  | { screen: 'door'; eventId: string; name: string }
  | { screen: 'group'; id: string }
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
  const [events, setEvents] = useState<EventListing[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const open = useCallback(async (event: SavedEvent) => {
    setRemembered(await rememberEvent(event));
    setRoute({ screen: 'event', event });
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
    setDisplayName(null);
    setSignedIn(false);
    setRoute({ screen: 'tabs' });
    setTab('home');
  }, []);

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
        <EventScreen
          api={api}
          event={route.event}
          webBase={API_BASE}
          t={t}
          signedIn={signedIn}
          onSignedIn={refreshAccount}
          Button={Button}
          onBack={() => {
            void refreshEvents();
            setRoute({ screen: 'tabs' });
          }}
          onOpenGroup={(id) => setRoute({ screen: 'group', id })}
          onGroupsChanged={refreshGroups}
        />
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

      {route.screen === 'group' && (
        <GroupScreen
          api={api}
          groupId={route.id}
          t={t}
          onBack={() => {
            void refreshGroups();
            void refreshEvents();
            setRoute({ screen: 'tabs' });
          }}
          onOpenEvent={open}
          onCreateEvent={(name) => setRoute({ screen: 'create', groupId: route.id, groupName: name })}
          Button={Button}
        />
      )}

      {/*
        Somebody's page, pushed over whichever tab found them. The app's own
        event list goes with it: the events you are both in are all events this
        device already holds a link token for, so opening one from here is the
        same act as opening it from home.
      */}
      {route.screen === 'person' && (
        <PersonScreen
          api={api}
          handle={route.handle}
          events={events}
          t={t}
          onBack={() => setRoute({ screen: 'tabs' })}
          onOpenEvent={openListing}
          Button={Button}
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
        <DoorScreen
          api={api}
          eventId={route.eventId}
          name={route.name}
          t={t}
          onBack={() => setRoute({ screen: 'tabs' })}
          // Approved between the link being sent and the button being pressed.
          // Nothing to wait for, so the list is refreshed and the door closes.
          onLetIn={() => {
            void refreshEvents();
            setRoute({ screen: 'tabs' });
          }}
          Button={Button}
        />
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
              Button={Button}
            />
          )}
          {tab === 'groups' && (
            <GroupsTab
              api={api}
              t={t}
              onOpenGroup={(id) => setRoute({ screen: 'group', id })}
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
            <ProfileTab
              api={api}
              events={events}
              displayName={displayName}
              t={t}
              onOpen={openListing}
              onRename={(next) => {
                setDisplayName(next);
                if (next) void api.setDisplayName(next).catch(() => {});
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
            Above the tab bar and on every tab: being sent a link is how most
            people arrive, and it should never be more than one tap away
            wherever they happen to be.
          */}
          <Pressable
            style={[styles.joinBar, { backgroundColor: t.card, borderColor: t.line }]}
            onPress={() => setRoute({ screen: 'join' })}
            accessibilityRole="button"
            accessibilityLabel="Open an event from a link, a code or a QR code"
          >
            <Text style={[styles.body, { color: t.accent }]}>
              Have a link or a code? Open it
            </Text>
          </Pressable>

          <View style={[styles.tabBar, { backgroundColor: t.card, borderColor: t.line }]}>
            {(
              [
                ['home', 'Events'],
                ['groups', 'Groups'],
                ['search', 'Find'],
                ['profile', 'You'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <Pressable
                key={id}
                style={styles.tab}
                onPress={() => setTab(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === id }}
                accessibilityLabel={label}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: tab === id ? t.accent : t.dim },
                    tab === id && styles.tabLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
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

function EventScreen({
  api,
  event,
  webBase,
  t,
  signedIn,
  onSignedIn,
  Button: ButtonEl,
  onBack,
  onOpenGroup,
  onGroupsChanged,
}: {
  api: Api;
  event: SavedEvent;
  /** Where links live, for the one this screen hands to the share sheet. */
  webBase: string;
  t: Theme;
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
  const [namingGroup, setNamingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
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

  /**
   * Roll this event into a group — design §3.
   *
   * Offered from an event rather than as "create a group", because "the same
   * people keep doing things together" is something you notice afterwards.
   * Only the host sees it, and only once: an event belongs to at most one
   * group, and the server refuses a second.
   */
  const createGroup = useCallback(async () => {
    const name = groupName.trim();
    if (!name) return;
    try {
      const group = await api.createGroup(event.id, name, false);
      setNamingGroup(false);
      setGroupName('');
      onGroupsChanged();
      onOpenGroup(group.id);
    } catch {
      Alert.alert('Could not make the group', 'Try again in a moment.');
    }
  }, [api, event.id, groupName, onGroupsChanged, onOpenGroup]);

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

  return (
    <View style={styles.root}>
      <FlatList
        data={feed?.photos ?? []}
        keyExtractor={(photo) => photo.id}
        numColumns={3}
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
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <Pressable onPress={onBack}>
              <Text style={[styles.body, { color: t.accent }]}>‹ All events</Text>
            </Pressable>
            {/*
              The name, and the one thing an event is for.

              Sharing was not reachable from this screen at all — the link
              appeared once, on the screen that made the event, and after that
              the only way to send it to somebody was to make another. It is
              the system sheet rather than a panel of our own: it already knows
              which group chat these people use, and picking somebody in it
              tells this app nothing about who they are.
            */}
            <View style={styles.eventTitleRow}>
              <Text style={[styles.h1, { color: t.fg, flex: 1 }]}>{event.name}</Text>
              <Pressable
                onPress={() => {
                  // The link alone. The name arrives with it — a shared link
                  // unfurls into a card carrying the event's title, so putting
                  // it in the message body as well says it twice.
                  void Share.share({ message: `${webBase}/e/${event.linkToken}` });
                }}
                accessibilityRole="button"
                accessibilityLabel="Share this event"
                style={({ pressed }) => [
                  styles.eventShare,
                  { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.eventShareText, { color: t.fg }]}>Share</Text>
              </Pressable>
            </View>
            <Text style={[styles.body, { color: t.dim }]}>
              {feed
                ? `${feed.count} ${feed.count === 1 ? 'photo' : 'photos'} from ${feed.contributors} ${feed.contributors === 1 ? 'person' : 'people'}`
                : (feedError ?? 'Loading…')}
            </Text>

            {/*
              What the link does, beside the button that sends it.

              The web says this inside its share panel; the app hands the link
              to the system sheet, which has nowhere to put a sentence — so it
              goes here, where somebody reads it immediately before tapping
              Share. Only for a private album: on a public one the link does
              the obvious thing, and a line saying so on every event is a line
              that stops being read.
            */}
            {(policy ?? feed?.event.accessPolicy) === 'private' && (
              <Text style={[styles.small, { color: t.dim }]}>
                {feed?.event.canAdminister
                  ? 'Private — whoever you send the link to can ask, and you answer.'
                  : 'Private — the link lets somebody ask. Whoever made this album decides.'}
              </Text>
            )}

            {feed?.event.groupId && (
              <Pressable onPress={() => onOpenGroup(feed.event.groupId!)}>
                <Text style={[styles.body, { color: t.accent }]}>
                  in {feed.event.groupName} ›
                </Text>
              </Pressable>
            )}

            {feed?.event.uploadsOpen !== false && signedIn === true && (
              <Button label="Add photos" onPress={addPhotos} t={t} primary />
            )}
            {feed?.event.uploadsOpen !== false && signedIn === false && (
              <AccountCard
                api={api}
                t={t}
                Button={ButtonEl}
                gate
                why="Adding photos needs an account. Looking does not — carry on browsing without one."
                onSignedIn={onSignedIn}
              />
            )}
            {queueStatus && (
              <Text style={[styles.body, { color: t.dim }]}>
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
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
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

            {(feed?.photos.length ?? 0) > 0 && (
              <Button
                label={saving ?? 'Save all to my camera roll'}
                onPress={saveAll}
                disabled={saving !== null}
                t={t}
              />
            )}

            {/*
              Who can see it, changeable here.

              The app asked this once — two pills on the create screen — and
              then never again, which is the wrong way round: the choice is
              made in the first thirty seconds, before anybody has been sent
              anything, and what you want is obvious only once they have. The
              web grew a manage screen for it; the app has this screen, so it
              is here.

              Host only, because it decides what everybody else can reach. The
              note under it is not decoration: "private" sounds like it should
              throw people out, and it does not.
            */}
            {feed?.event.canAdminister && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.label, { color: t.fg }]}>Who can see it</Text>
                <View style={styles.pills}>
                  {(
                    [
                      ['public', 'Public'],
                      ['private', 'Private'],
                    ] as ['public' | 'private', string][]
                  ).map(([value, label]) => {
                    const on = (policy ?? feed.event.accessPolicy) === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={async () => {
                          if (on) return;
                          setPolicy(value);
                          setPolicyError(null);
                          try {
                            await api.setAccessPolicy(event.id, value);
                            // Not because the pills need it — they answered the
                            // press already — but because the sentence under
                            // the link and the number waiting both change with
                            // this, and they are read off the feed.
                            await refresh();
                          } catch {
                            setPolicy(null);
                            setPolicyError('Could not change that. Try again in a moment.');
                          }
                        }}
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
                  {(policy ?? feed.event.accessPolicy) === 'private'
                    ? 'Only the people in it. Anyone else with the link can ask, and you answer — everyone already here stays in.'
                    : 'Anyone can see it, no account needed. Adding photos always needs one.'}
                </Text>
                {feed.event.waiting > 0 && (
                  /*
                    Said here rather than only in the bubble on Home, because
                    this is the screen somebody is on when they turn private on
                    and then wonder where the asking happens. Answered where
                    they are, on the tab that already lists it.
                  */
                  <Text style={[styles.small, { color: t.accent }]}>
                    {feed.event.waiting}{' '}
                    {feed.event.waiting === 1 ? 'person is' : 'people are'} waiting to be
                    let in — answer them on Events.
                  </Text>
                )}
                {policyError && (
                  <Text style={[styles.small, { color: t.dim }]}>{policyError}</Text>
                )}
              </View>
            )}

            {/*
              Only the host, and only for an event that is not already in one.
              The pitch is the recurrence, not the feature: nobody wants "a
              group", they want to stop sending the link every time.
            */}
            {/*
              Host only. It changes what everybody else sees on their home
              screen, which is the same reason the web keeps it on the manage
              screen rather than on the event.

              The picture is here rather than only behind the press, matching
              the web's manage screen: the cover is the one setting on this
              screen whose value is an image, and an image described in words
              is a setting you have to remember rather than read.
            */}
            {feed?.event.canAdminister && (
              <Pressable
                onPress={editCover}
                // Same press feedback as `Button`, because it sits in a column
                // of them and a row that does not dim under a finger reads as
                // the one thing on the screen that did not take the press.
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
                  <Text style={[styles.coverTitle, { color: t.fg }]}>Event cover</Text>
                  <Text style={[styles.coverNote, { color: t.dim }]}>
                    {cover
                      ? 'What this event leads with everywhere.'
                      : 'Leading with its newest photograph.'}
                  </Text>
                </View>
              </Pressable>
            )}

            {feed?.event.canAdminister && !feed.event.groupId && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                {namingGroup ? (
                  <>
                    <Text style={[styles.label, { color: t.fg }]}>Name the group</Text>
                    <TextInput
                      value={groupName}
                      onChangeText={setGroupName}
                      placeholder="Sunday roast"
                      placeholderTextColor={t.dim}
                      autoFocus
                      onSubmitEditing={createGroup}
                      style={[
                        styles.input,
                        { color: t.fg, borderColor: t.line, backgroundColor: t.bg },
                      ]}
                    />
                    <Text style={[styles.small, { color: t.dim }]}>
                      Everyone here keeps their access. Nobody is added to the
                      group without choosing to.
                    </Text>
                    <Button
                      label="Make the group"
                      onPress={createGroup}
                      disabled={!groupName.trim()}
                      t={t}
                      primary
                    />
                    <Button label="Cancel" onPress={() => setNamingGroup(false)} t={t} />
                  </>
                ) : (
                  <>
                    <Text style={[styles.body, { color: t.fg }]}>
                      Do this often with these people? A group keeps the events
                      together, so you only send the link once.
                    </Text>
                    <Button
                      label="Start a group from this event"
                      onPress={() => setNamingGroup(true)}
                      t={t}
                    />
                  </>
                )}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          feed ? (
            <Text style={[styles.body, { color: t.dim, paddingVertical: 40 }]}>
              Nothing here yet. Add yours and everyone else will see there is
              something to add to.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.tile} onPress={() => setSelected(item)}>
            <Image source={{ uri: item.src }} style={styles.thumb} />
          </Pressable>
        )}
      />

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

const styles = StyleSheet.create({
  root: { flex: 1 },
  /* The event's name, and Share on the same line as it. A full-width button
     under the title would be the third stacked slab on this screen and would
     read as the thing to do, which is adding photos. */
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eventShare: {
    flex: 0, borderWidth: 1, borderRadius: 999,
    paddingVertical: 7, paddingHorizontal: 14,
  },
  eventShareText: { fontSize: 14, fontWeight: '600' },
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
  gridContent: { padding: 12, paddingTop: 64 },
  h1: { fontSize: 26, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  // Pinned above the tab bar rather than inside a tab: arriving from a link
  // is how most people get here, and it should never be a tab away.
  joinBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 76,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    flexDirection: 'row',
    // Room for the home indicator. A safe-area library would be exact; this
    // is a constant that is right on every phone with one and slightly
    // generous on the few without.
    paddingBottom: 24,
    paddingTop: 10,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { fontSize: 14 },
  tabLabelActive: { fontWeight: '700' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  button: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  listRow: { paddingVertical: 10 },
  tile: { flex: 1 / 3, padding: 3 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 6, backgroundColor: '#8883' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  sheet: { padding: 16, paddingBottom: 40, gap: 10, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  sheetImage: { width: '100%', height: 240, borderRadius: 10, backgroundColor: '#8883' },
  // A card in the same family as `card`, laid out sideways: the picture reads
  // first, the words explain it. 3:2 rather than square, because that is the
  // shape a cover is drawn in on the home screen.
  coverRow: { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' },
  coverShot: { width: 66, height: 44, borderRadius: 8, backgroundColor: '#8883' },
  coverEmpty: { width: 66, height: 44, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed' },
  coverWords: { flex: 1, gap: 2 },
  coverTitle: { fontSize: 16, fontWeight: '600' },
  coverNote: { fontSize: 13 },
});

/** Rough, and rounded up: this number exists to prevent a surprise, not to be exact. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.ceil(bytes / 1024 ** 2)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
