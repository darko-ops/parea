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
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { AutoSelect } from './src/AutoSelect';
import {
  libraryAccess,
  requestLibraryAccess,
  resolveForUpload,
  type LibraryAccess,
} from './src/library';
import {
  BACKGROUND_UPLOAD_SUPPORTED,
  loadActorToken,
  loadEvents,
  loadQueue,
  rememberEvent,
  saveActorToken,
  saveQueue,
  saveToCameraRoll,
  uploadItem,
  type SavedEvent,
} from './src/platform';
import { UploadQueue } from './src/queue';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function App() {
  const dark = useColorScheme() === 'dark';
  const t = useMemo(() => theme(dark), [dark]);
  const api = useMemo(() => new Api(API_BASE), []);

  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [active, setActive] = useState<SavedEvent | null>(null);

  useEffect(() => {
    (async () => {
      const token = await loadActorToken();
      if (token) api.setToken(token);
      setEvents(await loadEvents());
      setReady(true);
    })();
  }, [api]);

  const open = useCallback(async (event: SavedEvent) => {
    setEvents(await rememberEvent(event));
    setActive(event);
  }, []);

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
      {active ? (
        <EventScreen
          api={api}
          event={active}
          t={t}
          onBack={() => setActive(null)}
        />
      ) : (
        <JoinScreen api={api} events={events} t={t} onOpen={open} />
      )}
    </View>
  );
}

// --- join --------------------------------------------------------------------

function JoinScreen({
  api,
  events,
  t,
  onOpen,
}: {
  api: Api;
  events: SavedEvent[];
  t: Theme;
  onOpen: (event: SavedEvent) => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const join = useCallback(
    async (raw: string) => {
      setBusy(true);
      setError(null);
      try {
        const token = tokenFromInput(raw);
        // A link if it looks like one, otherwise treat it as a spoken code.
        const summary = await api.join(
          token ? { linkToken: token } : { code: raw },
        );
        onOpen({
          id: summary.id,
          name: summary.name,
          linkToken: summary.linkToken,
          startsAt: summary.startsAt,
          endsAt: summary.endsAt,
        });
        setInput('');
      } catch {
        setError("Couldn't find that. Check the link or the code and try again.");
      } finally {
        setBusy(false);
        setScanning(false);
      }
    },
    [api, onOpen],
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
          onSubmitEditing={() => input.trim() && join(input)}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
        <Button
          label={busy ? 'Looking…' : 'Go'}
          onPress={() => join(input)}
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

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (!busy) void join(data);
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
}: {
  api: Api;
  event: SavedEvent;
  t: Theme;
  onBack: () => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedPhoto | null>(null);
  const [autoWindow, setAutoWindow] = useState<Window | null>(null);
  const [access, setAccess] = useState<LibraryAccess>('undetermined');
  const [offerUpgrade, setOfferUpgrade] = useState(false);

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
    async (files: { id: string; uri: string; name: string; size: number; mime: string }[]) => {
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

    await enqueue(
      picked.assets.map((asset, index) => ({
        id: `${Date.now()}-${index}`,
        uri: asset.uri,
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

  if (autoWindow) {
    return (
      <AutoSelect
        window={autoWindow}
        theme={t}
        onCancel={() => setAutoWindow(null)}
        onConfirm={async (assetIds) => {
          setAutoWindow(null);
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
  scroll: { padding: 20, paddingTop: 72, gap: 14 },
  gridContent: { padding: 12, paddingTop: 64 },
  h1: { fontSize: 26, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 16, fontWeight: '600' },
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
