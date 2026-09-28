/**
 * Moments: one photograph somebody put in front of their people.
 *
 * Three pieces, kept together because they are one feature:
 *
 * - `MomentsRow`, the strip at the top of Home — one stream of everybody's
 *   moments, one tile per moment, in the order the server sends (fresh and
 *   unseen first; see `orderStream` there). A tile is the photograph, ringed
 *   in the app icon's field until it has been opened, with its author's face
 *   as a badge on the corner. The same strip, scoped to one person, is on
 *   their page.
 * - `MomentsViewer`, which is `PhotoViewer` itself, `plain`. Pressing a moment
 *   opens exactly what pressing a photograph in a roll opens, and swiping walks
 *   the strip in its own order. Each one that comes on screen is marked seen.
 * - `AddMoment`, the screen the `+` sheet's third choice opens: one picture
 *   off the camera roll, shown, then put straight to storage.
 *
 * The strip and the sheet live on different tabs, so a posted moment is
 * announced through `momentsChanged` rather than by threading a refresh
 * callback from one tab through `App` into the other.
 */

import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ApiError, type Api, type FeedPhoto, type Moment } from './api';
import type { GroupTheme } from './Groups';
import { IconRing } from './IconField';
import { PhotoViewer } from './PhotoViewer';
import { describeFile, putToStorage, saveToCameraRoll } from './platform';

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

/**
 * The stream this person may see — or, given a handle, that person's moments —
 * re-read whenever one is posted, removed or blocked on any screen.
 *
 * `seen` is here too: the viewer marks a moment opened the moment it is on
 * screen, and the strip's ring has to change then rather than on the next
 * fetch. A local set laid over the server's answer, cleared by the refresh
 * that makes it true.
 */
export function useMoments(api: Api, handle?: string | null) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    // A page with no handle yet has nothing to ask for.
    if (handle === null) return;
    try {
      const { moments } = await (handle ? api.momentsBy(handle) : api.moments());
      setMoments(moments);
      setOpened(new Set());
    } catch {
      // The strip is an extra. Failing to fetch it leaves it as it was.
    }
  }, [api, handle]);

  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);

  const drawn = useMemo(
    () =>
      opened.size === 0
        ? moments
        : moments.map((m) => (opened.has(m.id) ? { ...m, seen: true } : m)),
    [moments, opened],
  );

  const markSeen = useCallback((id: string) => {
    setOpened((was) => (was.has(id) ? was : new Set(was).add(id)));
  }, []);

  return { moments: drawn, refresh, markSeen };
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
  moments,
  t,
  onOpen,
  style,
}: {
  moments: Moment[];
  t: GroupTheme;
  onOpen: (momentId: string) => void;
  /** Where it sits on a page that is not Home, whose spacing it assumes. */
  style?: StyleProp<ViewStyle>;
}) {
  if (moments.length === 0) return null;
  return (
    /*
     * The row's own box, sized from its tiles, around the scroll.
     *
     * Why the rounded squares came out cut: the ring was the icon's field as a
     * square SVG, rounded only by its parent's `overflow: hidden` and radius —
     * and an SVG is its own native view, so whether that clip reached into it
     * was the renderer's decision, not the layout's. The ring is a path now
     * (`IconRing`), with the corners in its geometry. And a horizontal scroll
     * view clips to its own bounds whatever `overflow` says, so the tiles sit
     * inside padding wide enough for the ring *and* the face badge that hangs
     * off each tile's corner, rather than flush against the edge that clips.
     */
    <View style={[styles.rowOuter, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {moments.map((moment) => (
          <MomentTile key={moment.id} moment={moment} t={t} onPress={() => onOpen(moment.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * One moment in the strip: the photograph, its ring, and whose it is.
 *
 * Ringed in the icon's field until opened, then in a hairline — the ring is
 * the only thing that says "new to you", so it is colour or nothing. The same
 * geometry either way, so a tile does not change size when it is seen.
 */
function MomentTile({
  moment,
  t,
  onPress,
}: {
  moment: Moment;
  t: GroupTheme;
  onPress: () => void;
}) {
  const who = moment.mine ? 'You' : first(moment.author.name);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${moment.mine ? 'Your' : `${who}'s`} moment${moment.seen ? '' : ', new'}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.frame}>
        {moment.seen ? (
          <IconRing size={RING} radius={RING_RADIUS} thickness={SEEN_LINE} color={t.line} />
        ) : (
          <IconRing size={RING} radius={RING_RADIUS} thickness={RING_LINE} />
        )}
        <ExpoImage
          source={{ uri: moment.thumb }}
          style={[styles.shot, { backgroundColor: t.card }]}
          contentFit="cover"
          transition={120}
        />
        {/* Whose, on the corner: a face, ringed in the page's colour so it
            reads as sitting on the photograph rather than being part of it. */}
        <View style={[styles.badge, { borderColor: t.bg, backgroundColor: t.card }]}>
          {moment.author.avatar ? (
            <ExpoImage
              source={{ uri: moment.author.avatar }}
              style={styles.badgeImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <Text style={[styles.badgeLetter, { color: t.fg }]}>
              {(first(moment.author.name) || '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
      </View>
      <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
        {who}
      </Text>
    </Pressable>
  );
}

/**
 * Moments, opened from the row: the roll's own viewer, over everything.
 */
export function MomentsViewer({
  api,
  moments,
  start,
  t,
  Button,
  onClose,
  onOpenPerson,
  onSeen,
}: {
  api: Api;
  /** The strip it was opened from, in the strip's order. */
  moments: Moment[];
  /** The moment that was pressed. */
  start: string;
  t: GroupTheme;
  Button: ButtonComponent;
  onClose: () => void;
  onOpenPerson: (handle: string) => void;
  /** This one is on screen: draw it seen now. The server is told here. */
  onSeen: (id: string) => void;
}) {
  /*
   * The strip in the viewer's own photograph shape, so the viewer does not
   * learn a second one: a moment has one rendition, so every size is that one,
   * and it has none of a roll's social rows.
   */
  const photos = useMemo(
    () =>
      moments.map(
        (moment): FeedPhoto => ({
          id: moment.id,
          src: moment.thumb,
          card: moment.src,
          grid: moment.src,
          full: moment.src,
          original: moment.src,
          byteSize: 0,
          mime: 'image/jpeg',
          takenAt: moment.createdAt,
          addedAt: moment.createdAt,
          tags: [],
          mine: moment.mine,
          by: moment.author.actorId,
          reactions: [],
          favourite: false,
          unseen: false,
        }),
      ),
    [moments],
  );

  const [index, setIndex] = useState(() =>
    Math.max(0, moments.findIndex((m) => m.id === start)),
  );
  const [options, setOptions] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // A removal can shorten the list under the index.
  const at = Math.min(index, photos.length - 1);
  const photo = photos[at];
  const moment = moments[at];

  useEffect(() => {
    if (photos.length === 0) onClose();
  }, [onClose, photos.length]);

  /*
   * Seen when it is on screen — the one that was pressed, and each one swiped
   * to. Once per moment: the server keeps the first opening anyway, and a
   * request per settle of the pager would be one per swipe back and forth.
   */
  const told = useRef<Set<string>>(new Set());
  const seenId = moment && !moment.seen && !moment.mine ? moment.id : null;
  useEffect(() => {
    if (!seenId || told.current.has(seenId)) return;
    told.current.add(seenId);
    onSeen(seenId);
    api.markMomentSeen(seenId).catch(() => {
      // Nothing to say: the ring comes back on the next fetch, which is the
      // whole cost of this not landing.
    });
  }, [api, onSeen, seenId]);

  if (!photo || !moment) return null;
  const owner = moment.author;

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
        uploader={{
          name: moment.mine ? 'You' : owner.name,
          handle: owner.handle,
          avatarUrl: owner.avatar,
        }}
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
                {moment.mine ? (
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

/** The tile's outer edge, the ring's widths, and the photograph inside. */
const RING = 66;
const RING_RADIUS = 20;
const RING_LINE = 3;
const SEEN_LINE = 1.5;
/** Ring, then a page-coloured gap of 2, then the photograph. */
const SHOT_INSET = RING_LINE + 2;
/** How far the author's face hangs off the tile's corner. */
const BADGE = 24;
const BADGE_HANG = 5;
/**
 * The strip's padding: enough on every side for the badge that hangs off the
 * corner, so no part of a tile ever meets the edge the scroll view clips at.
 */
const ROW_PAD = BADGE_HANG + 3;

const styles = StyleSheet.create({
  /*
   * Pulled up against the rolls. Home's scroll spaces every child 26 apart,
   * which is right between two cards and far too much under a strip that
   * belongs to the list below it — the negative margin brings that gap to
   * about 10 without the strip learning what the page's gap is any other way.
   * The row's own padding is part of that 10, which is why it is less than 16.
   */
  rowOuter: { flexShrink: 0, marginTop: -ROW_PAD, marginBottom: -24, marginHorizontal: -ROW_PAD },
  row: { gap: 12, padding: ROW_PAD },
  tile: { width: RING + BADGE_HANG, alignItems: 'flex-start', gap: 6 },
  frame: { width: RING, height: RING },
  shot: {
    position: 'absolute',
    top: SHOT_INSET,
    left: SHOT_INSET,
    width: RING - SHOT_INSET * 2,
    height: RING - SHOT_INSET * 2,
    // The radius inside the ring's, less the inset, so the corners are
    // concentric. On the image itself, which clips its own pixels.
    borderRadius: RING_RADIUS - SHOT_INSET,
  },
  badge: {
    position: 'absolute',
    right: -BADGE_HANG,
    bottom: -BADGE_HANG,
    width: BADGE,
    height: BADGE,
    borderRadius: 8,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeImage: { width: '100%', height: '100%' },
  badgeLetter: { fontSize: 10, fontWeight: '700' },
  name: { fontSize: 12, lineHeight: 16, width: RING, textAlign: 'center' },
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
