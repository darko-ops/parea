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
 * - `postMoment`, the `+` sheet's third choice: one picture off the camera
 *   roll, sent as bytes the way a profile picture is.
 *
 * The row and the sheet live on different tabs, so a posted moment is
 * announced through `onMomentsChanged` rather than by threading a refresh
 * callback from one tab through `App` into the other.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Api, FeedPhoto, MomentsResponse } from './api';
import type { GroupTheme } from './Groups';
import { PhotoViewer } from './PhotoViewer';
import { saveToCameraRoll, uploadCover } from './platform';

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
 * One picture, off the camera roll, up as a moment.
 *
 * The system picker, for the avatar's reason: choosing one image needs no
 * library permission on iOS. No crop — a moment is somebody's whole
 * photograph, and the server keeps it whole.
 */
export async function postMoment(api: Api): Promise<void> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (picked.canceled || !picked.assets[0]) return;
  try {
    const target = api.momentTarget();
    await uploadCover(target.url, target.headers, picked.assets[0].uri);
    momentsChanged();
  } catch {
    Alert.alert('Could not share that moment', 'Try again in a moment.');
  }
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
});
