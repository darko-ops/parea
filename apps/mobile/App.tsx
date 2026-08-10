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
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { resolveWindow, type Window } from '@parea/autoselect';

import { Api, tokenFromInput, type Feed, type FeedPhoto } from './src/api';
import { CreateEvent } from './src/CreateEvent';
import { GroupScreen, GroupSearch } from './src/Groups';
import { arrivalFromUrl } from './src/links';
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
  loadEvents,
  loadQueue,
  rememberEvent,
  saveActorToken,
  saveQueue,
  saveToCameraRoll,
  uploadItem,
  type SavedEvent,
} from './src/platform';
import { UploadQueue } from '@parea/upload';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type MyGroup = { id: string; name: string; role: 'member' | 'admin' };

/**
 * Where the app is. Three destinations and no history stack — every screen
 * here is one step from home, and a navigation library would be more moving
 * parts than the product has screens.
 */
type Route =
  | { screen: 'home' }
  | { screen: 'event'; event: SavedEvent }
  | { screen: 'group'; id: string }
  | { screen: 'create'; groupId?: string; groupName?: string };

export default function App() {
  const dark = useColorScheme() === 'dark';
  const t = useMemo(() => theme(dark), [dark]);
  const api = useMemo(
    () => new Api(API_BASE, null, RNPlatform.OS === 'android' ? 'android' : 'ios'),
    [],
  );

  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [route, setRoute] = useState<Route>({ screen: 'home' });
  const [arriving, setArriving] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const open = useCallback(async (event: SavedEvent) => {
    setEvents(await rememberEvent(event));
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
      } catch {
        setJoinError("Couldn't find that. Check the link or the code and try again.");
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

  useEffect(() => {
    (async () => {
      const token = await loadActorToken();
      if (token) api.setToken(token);
      setEvents(await loadEvents());
      setReady(true);
      // Both after the token: one asks who this device is, the other answers
      // as them. Groups are empty for anyone who has never contributed, which
      // is the common first launch and not an error.
      void refreshGroups();
      await arrive(await Linking.getInitialURL());
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void arrive(url);
    });
    return () => subscription.remove();
  }, [api, arrive, refreshGroups]);

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
          t={t}
          onBack={() => setRoute({ screen: 'home' })}
          onOpenGroup={(id) => setRoute({ screen: 'group', id })}
          onGroupsChanged={refreshGroups}
        />
      )}

      {route.screen === 'create' && (
        <CreateEvent
          api={api}
          webBase={API_BASE}
          groupId={route.groupId}
          groupName={route.groupName}
          t={t}
          onCancel={() =>
            setRoute(
              route.groupId
                ? { screen: 'group', id: route.groupId }
                : { screen: 'home' },
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
            setRoute({ screen: 'home' });
          }}
          onOpenEvent={open}
          onCreateEvent={(name) => setRoute({ screen: 'create', groupId: route.id, groupName: name })}
          Button={Button}
        />
      )}

      {route.screen === 'home' && (
        <JoinScreen
          api={api}
          events={events}
          groups={groups}
          t={t}
          onOpen={open}
          onOpenGroup={(id) => setRoute({ screen: 'group', id })}
          onCreateEvent={() => setRoute({ screen: 'create' })}
          onJoin={join}
          busy={arriving}
          error={joinError}
        />
      )}

      {/*
        A tapped link can land while the app is already somewhere else.
        Without this the screen simply changes under someone who is watching
        an upload, with no account of why.
      */}
      {arriving && route.screen !== 'home' && (
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
      <Text style={[styles.h1, { color: t.fg }]}>
        Every photo from everyone who was there
      </Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Paste a link, or say the code</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="amber-fox"
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
      <Button label="Start an event" onPress={onCreateEvent} t={t} />

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
  t,
  onBack,
  onOpenGroup,
  onGroupsChanged,
}: {
  api: Api;
  event: SavedEvent;
  t: Theme;
  onBack: () => void;
  onOpenGroup: (groupId: string) => void;
  onGroupsChanged: () => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedPhoto | null>(null);
  const [autoWindow, setAutoWindow] = useState<Window | null>(null);
  const [access, setAccess] = useState<LibraryAccess>('undetermined');
  const [offerUpgrade, setOfferUpgrade] = useState(false);
  const [namingGroup, setNamingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    void libraryAccess().then(setAccess);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setFeed(await api.feed(event.id, event.linkToken));
    } catch {
      /* stale data beats an error screen over photos you already had */
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
        setQueueStatus(
          queue.failedCount > 0 ? `${queue.failedCount} didn't upload` : null,
        );
        await refresh();
      }
    },
    [api, event, refresh],
  );

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
      mediaTypes: ['images', 'videos'],
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

  const saveAll = useCallback(async () => {
    if (!feed || feed.photos.length === 0) return;
    setSaving('Starting…');
    try {
      const { saved, failed } = await saveToCameraRoll(
        feed.photos.map((p) => ({ id: p.id, url: p.full })),
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
  }, [feed]);

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
            <Text style={[styles.h1, { color: t.fg }]}>{event.name}</Text>
            <Text style={[styles.body, { color: t.dim }]}>
              {feed
                ? `${feed.count} ${feed.count === 1 ? 'photo' : 'photos'} from ${feed.contributors} ${feed.contributors === 1 ? 'person' : 'people'}`
                : 'Loading…'}
            </Text>

            {feed?.event.groupId && (
              <Pressable onPress={() => onOpenGroup(feed.event.groupId!)}>
                <Text style={[styles.body, { color: t.accent }]}>
                  in {feed.event.groupName} ›
                </Text>
              </Pressable>
            )}

            {feed?.event.uploadsOpen !== false && (
              <Button label="Add photos" onPress={addPhotos} t={t} primary />
            )}
            {queueStatus && (
              <Text style={[styles.body, { color: t.dim }]}>
                {queueStatus}
                {!BACKGROUND_UPLOAD_SUPPORTED &&
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
              Only the host, and only for an event that is not already in one.
              The pitch is the recurrence, not the feature: nobody wants "a
              group", they want to stop sending the link every time.
            */}
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
 * The same set as the web lightbox — remove your own, or ask/report/block
 * someone else's. App Store Guideline 1.2 requires these reachable in the app,
 * and this is a photo-sharing app carrying other people's faces regardless.
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
});
