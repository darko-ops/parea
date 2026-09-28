/**
 * Moments: one photograph somebody put in front of their people.
 *
 * Three pieces, kept together because they are one feature:
 *
 * - `MomentsRow`, the row of squares at the top of Home — one per person, each
 *   wearing that person's face, yours first. The web's people row is the shape
 *   it borrows, with corners: every picture of a person in this product is a
 *   square (see the uploader square in `PhotoViewer`), and a moment is a
 *   picture before it is a person.
 * - `MomentsViewer`, which is `PhotoViewer` itself, `plain`. Pressing a moment
 *   opens exactly what pressing a photograph in a roll opens. All the people's
 *   moments are one list, so swiping past somebody's last carries on into the
 *   next person's.
 * - `AddMoment`, the screen the `+` sheet's third choice opens: one picture
 *   off the camera roll, shown, then sent as bytes the way a profile picture
 *   is.
 *
 * The row and the sheet live on different tabs, so a posted moment is
 * announced through `onMomentsChanged` rather than by threading a refresh
 * callback from one tab through `App` into the other.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { ApiError, type Api, type FeedPhoto, type MomentsResponse } from './api';
import type { GroupTheme } from './Groups';
import { PhotoViewer } from './PhotoViewer';
import { describeFile, putToStorage, saveToCameraRoll } from './platform';

type MomentPerson = MomentsResponse['people'][number];

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

const listeners = new Set<() => void>();

/** Somebody posted or removed a moment; every row on screen re-reads. */
function momentsChanged() {
  for (const listener of listeners) listener();
}

/** The moments this person may see, re-read whenever one is posted or removed. */
export function useMoments(api: Api) {
  const [people, setPeople] = useState<MomentPerson[]>([]);

  const refresh = useCallback(async () => {
    try {
      const { people } = await api.moments();
      setPeople(people.filter((p) => p.moments.length > 0));
    } catch {
      // The row is an extra. Failing to fetch it leaves it as it was.
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);

  return { people, refresh };
}

/**
 * One picture off the camera roll, or null if they backed out.
 *
 * The system picker, for the avatar's reason: choosing one image needs no
 * library permission on iOS. No crop — a moment is somebody's whole
 * photograph, and the server keeps it whole.
 */
async function pickOne(): Promise<{ uri: string; mimeType: string } | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    /*
     * A JPEG, not the HEIC the camera wrote.
     *
     * Without this the picker hands back the original file, which on an
     * iPhone is HEIC — and the server's decoder cannot read HEIC, so every
     * moment came back "not an image". The avatar never met this because its
     * crop re-encodes as JPEG on the way out. `Compatible` asks the system for
     * its most compatible representation, which is the same photograph
     * transcoded before it leaves the phone.
     */
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = picked.assets?.[0];
  if (picked.canceled || !asset) return null;
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
}

/**
 * Adding a moment: its own screen, the way a roll's first step is.
 *
 * The `+` sheet's Moment used to launch the picker straight from the sheet,
 * and on iOS that is a picker asked to present while the sheet it came from is
 * still sliding away — which the system refuses without saying so. So the
 * choice opens this instead: a screen that is fully on the glass before the
 * picker is asked for, a frame showing what is about to go up, and a Share
 * that is the only thing that sends it. Picking the wrong photo is a tap on
 * the frame, not a moment somebody has to go and delete.
 */
export function AddMoment({
  api,
  onCancel,
  onShared,
}: {
  api: Api;
  onCancel: () => void;
  onShared: () => void;
}) {
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<{ uri: string; mimeType: string } | null>(null);
  const uri = picked?.uri ?? null;
  const [sharing, setSharing] = useState(false);

  const choose = useCallback(async () => {
    const next = await pickOne();
    if (next) setPicked(next);
  }, []);

  /*
   * To storage, then the key to the server.
   *
   * It was one POST of the file to the server, the avatar's way, and that
   * cannot work for a photograph: the server refuses a request body over about
   * 4.5MB and a picture off this phone is larger, so every Share came back 413.
   * The bytes go phone → storage now, like a roll's photographs.
   */
  const share = useCallback(async () => {
    if (!picked || sharing) return;
    setSharing(true);
    try {
      const { exists, byteSize } = describeFile(picked.uri);
      if (!exists || byteSize === 0) throw new Error('unreadable');
      const slot = await api.momentUpload(byteSize, picked.mimeType);
      await putToStorage(slot.url, slot.headers, picked.uri);
      await api.finishMoment(slot.key);
      momentsChanged();
      onShared();
    } catch (err) {
      setSharing(false);
      Alert.alert('Could not share that moment', shareFailure(err));
    }
  }, [api, onShared, picked, sharing]);

  return (
    <View style={[styles.addRoot, { backgroundColor: '#000' }]}>
      <View style={styles.addBar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" disabled={sharing}>
          <Text style={styles.addCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.addTitle}>New moment</Text>
        <Pressable
          onPress={() => void share()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Share this moment"
          disabled={!uri || sharing}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.addShare, { opacity: uri ? 1 : 0.4 }]}>Share</Text>
          )}
        </Pressable>
      </View>

      {/* `contain`, as in the roll's picker: this frame is for judging a
          photograph, and it is shared whole. */}
      <Pressable
        onPress={() => void choose()}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel={uri ? 'Choose a different photo' : 'Choose a photo'}
        style={[styles.addFrame, { height: width * 1.25 }]}
      >
        {uri ? (
          <ExpoImage
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
          />
        ) : (
          <View style={styles.addEmpty}>
            <View style={[styles.addPlus, { borderColor: 'rgba(255,255,255,0.35)' }]}>
              <Text style={styles.addPlusGlyph}>+</Text>
            </View>
            <Text style={styles.addWhy}>Choose a photo</Text>
            <Text style={styles.addWhySmall}>
              One photo, front and center for your people.
            </Text>
          </View>
        )}
      </Pressable>

      {uri && !sharing && (
        <Pressable onPress={() => void choose()} hitSlop={10} accessibilityRole="button">
          <Text style={styles.addAgain}>
            Choose a different photo
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** What went wrong, in a sentence somebody can act on. */
function shareFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'That photo is too large to share.';
    if (err.status === 415) return 'That photo is in a format we cannot read.';
    if (err.status === 429) return 'You have shared a lot just now. Try again later.';
  }
  return 'Try again in a moment.';
}

/** The first word of a name. The rows under the squares are narrow. */
function first(name: string): string {
  return name.replace('@', '').trim().split(/\s+/)[0] || name;
}

export function MomentsRow({
  people,
  t,
  onOpen,
}: {
  people: MomentPerson[];
  t: GroupTheme;
  onOpen: (actorId: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.rowOuter}
    >
      {people.map((person) => (
        <Pressable
          key={person.actorId}
          onPress={() => onOpen(person.actorId)}
          accessibilityRole="button"
          accessibilityLabel={
            person.mine ? 'Your moments' : `${first(person.name)}'s moments`
          }
          style={({ pressed }) => [styles.person, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={[styles.face, { borderColor: t.accent, backgroundColor: t.card }]}>
            {person.avatar ? (
              <ExpoImage
                source={{ uri: person.avatar }}
                style={styles.faceImage}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <Text style={[styles.initial, { color: t.fg }]}>
                {(first(person.name) || '?').slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
            {person.mine ? 'You' : first(person.name)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * Moments, opened from the row: the roll's own viewer, over everything.
 */
export function MomentsViewer({
  api,
  people,
  start,
  t,
  Button,
  onClose,
  onOpenPerson,
}: {
  api: Api;
  people: MomentPerson[];
  /** Whose square was pressed. The viewer opens on their newest. */
  start: string;
  t: GroupTheme;
  Button: ButtonComponent;
  onClose: () => void;
  onOpenPerson: (handle: string) => void;
}) {
  /*
   * Every moment in the row as one list, in the row's order, and who each
   * belongs to. Flattened into the viewer's own photograph shape so the viewer
   * does not learn a second one: a moment has one rendition, so every size is
   * that one, and it has none of a roll's social rows.
   */
  const { photos, owners } = useMemo(() => {
    const photos: FeedPhoto[] = [];
    const owners: MomentPerson[] = [];
    for (const person of people) {
      for (const moment of person.moments) {
        photos.push({
          id: moment.id,
          src: moment.src,
          card: moment.src,
          grid: moment.src,
          full: moment.src,
          original: moment.src,
          byteSize: 0,
          mime: 'image/jpeg',
          takenAt: moment.createdAt,
          addedAt: moment.createdAt,
          tags: [],
          mine: person.mine,
          by: person.actorId,
          reactions: [],
          favourite: false,
          unseen: false,
        });
        owners.push(person);
      }
    }
    return { photos, owners };
  }, [people]);

  const [index, setIndex] = useState(() =>
    Math.max(0, owners.findIndex((p) => p.actorId === start)),
  );
  const [options, setOptions] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // A removal can shorten the list under the index.
  const at = Math.min(index, photos.length - 1);
  const photo = photos[at];
  const owner = owners[at];

  useEffect(() => {
    if (photos.length === 0) onClose();
  }, [onClose, photos.length]);

  if (!photo || !owner) return null;

  const closeOptions = () => {
    setOptions(false);
    setConfirming(false);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <PhotoViewer
        plain
        api={api}
        eventId=""
        comments={[]}
        t={t}
        canReact={false}
        canPost={false}
        onClose={onClose}
        onChanged={async () => momentsChanged()}
        onOptions={() => setOptions(true)}
        onDownload={async () => {
          setSaving(photo.id);
          try {
            const { saved } = await saveToCameraRoll(
              [{ id: photo.id, url: photo.original, mime: photo.mime }],
              () => {},
            );
            if (saved === 0) throw new Error('not saved');
          } catch (err) {
            Alert.alert(
              'Could not save it',
              err instanceof Error && err.message.includes('Permission')
                ? err.message
                : 'Try again in a moment.',
            );
          } finally {
            setSaving(null);
          }
        }}
        downloading={saving === photo.id}
        uploader={{ name: owner.name, handle: owner.handle, avatarUrl: owner.avatar }}
        onOpenPerson={(handle) => {
          onClose();
          onOpenPerson(handle);
        }}
        onFavourite={async () => {}}
        photos={photos}
        index={at}
        onIndex={setIndex}
      />

      {/*
        Inside the viewer's modal, for the reason the roll's sheet is: a sheet
        beside a full-screen modal presents underneath it on iOS.
      */}
      {options && (
        <Modal visible animationType="slide" transparent onRequestClose={closeOptions}>
          <Pressable style={styles.backdrop} onPress={closeOptions}>
            <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
              <View style={styles.inner}>
                {owner.mine ? (
                  <Button
                    t={t}
                    label="Remove my moment"
                    onPress={async () => {
                      closeOptions();
                      try {
                        await api.deleteMoment(photo.id);
                        momentsChanged();
                      } catch {
                        Alert.alert('Could not remove it', 'Try again in a moment.');
                      }
                    }}
                  />
                ) : confirming ? (
                  /* The second press says what it does rather than asking
                     "are you sure" about a word — the roll's rule. */
                  <Button
                    t={t}
                    primary
                    label="Block — hide everything of theirs"
                    onPress={async () => {
                      closeOptions();
                      try {
                        await api.blockMomentAuthor(photo.id);
                        momentsChanged();
                      } catch {
                        Alert.alert('Could not block', 'Try again in a moment.');
                      }
                    }}
                  />
                ) : (
                  <Button t={t} label="Block this person" onPress={() => setConfirming(true)} />
                )}
                <Button t={t} label="Cancel" onPress={closeOptions} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  rowOuter: { flexGrow: 0, marginBottom: 12 },
  row: { gap: 12, paddingHorizontal: 2, paddingVertical: 4 },
  person: { width: 64, alignItems: 'center', gap: 6 },
  /* A rounded square, not a disc — see the note at the top. */
  face: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceImage: { width: '100%', height: '100%' },
  initial: { fontSize: 20, fontWeight: '600' },
  name: { fontSize: 12, maxWidth: 64 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  inner: { padding: 16, paddingBottom: 40, gap: 12 },
  addRoot: { flex: 1 },
  /* The same status-bar allowance as the roll's picker. */
  addBar: {
    paddingTop: 60,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addCancel: { color: '#fff', fontSize: 15.5 },
  addTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  addShare: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  addFrame: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  addEmpty: { alignItems: 'center', gap: 10, padding: 32 },
  addPlus: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  addPlusGlyph: { color: '#fff', fontSize: 28, fontWeight: '300' },
  addWhy: { color: '#fff', fontSize: 17, fontWeight: '600' },
  addWhySmall: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  /* The glass blue the photo viewer uses: the accent that reads on white is a
     navy on black. */
  addAgain: { color: '#6ea8fe', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 18 },
});
