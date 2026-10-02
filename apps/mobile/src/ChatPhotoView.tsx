/**
 * A photograph somebody sent into a chat, opened full.
 *
 * The roll's own viewer in its `bare` shape: the same frame, zoom and chrome,
 * with whose it is at the top — but no reacting, no comments and no options
 * sheet, because those belong to the roll and this is a chat. What stays is
 * what you can do with the picture itself: keep it (when its roll is open to
 * you), send it on to another chat, make it a moment, save it.
 */

import { useState } from 'react';
import { Alert, Modal, StyleSheet, View } from 'react-native';

import type { Api, FeedPhoto, Message } from './api';
import { ChatPicker } from './ChatPicker';
import type { GroupTheme } from './Groups';
import { AddMoment } from './Moments';
import { PhotoViewer } from './PhotoViewer';
import { saveToCameraRoll } from './platform';

export type SentPhoto = NonNullable<Message['photo']>;

export function ChatPhotoView({
  api,
  t,
  photo,
  onClose,
}: {
  api: Api;
  t: GroupTheme;
  /** The photograph to show; null keeps it closed. Only one still there to see. */
  photo: SentPhoto | null;
  onClose: () => void;
}) {
  const [kept, setKept] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [rippling, setRippling] = useState(false);

  if (!photo || !photo.full) return null;
  const full = photo.full;
  const original = photo.original ?? full;
  const mime = photo.original ? (photo.mime ?? 'image/jpeg') : 'image/jpeg';

  // The roll viewer draws a list of a roll's photographs; this is one, from a chat.
  const asFeed = {
    id: photo.id,
    src: photo.thumb ?? full,
    card: null,
    grid: photo.thumb,
    full,
    original,
    byteSize: photo.byteSize ?? 0,
    mime,
    takenAt: '',
    addedAt: '',
    tags: [],
    mine: false,
    by: null,
    reactions: [],
    favourite: kept ?? photo.favourite,
    unseen: false,
  } as unknown as FeedPhoto;

  const close = () => {
    setKept(null);
    setSending(false);
    setRippling(false);
    onClose();
  };

  return (
    <Modal visible animationType="fade" onRequestClose={() => (rippling ? setRippling(false) : close())}>
      <PhotoViewer
        bare
        canKeep={photo.canKeep}
        api={api}
        eventId=""
        comments={[]}
        t={t}
        canReact={false}
        canPost={false}
        onClose={close}
        onChanged={async () => {}}
        onOptions={() => {}}
        photos={[asFeed]}
        index={0}
        onIndex={() => {}}
        /* Who took it, as a label: there is no profile to open from a chat. */
        uploader={photo.by ? { name: photo.by.name, handle: null, avatarUrl: photo.by.avatarUrl } : null}
        onOpenPerson={() => {}}
        onFavourite={async (photoId, on) => {
          try {
            const { favourite } = await api.setFavourite(photoId, on);
            setKept(favourite);
          } catch {
            Alert.alert('Could not change that', 'Try again in a moment.');
          }
        }}
        onSendToChat={() => setSending(true)}
        onRipple={() => setRippling(true)}
        onDownload={async () => {
          setSaving(true);
          try {
            const { saved } = await saveToCameraRoll([{ id: photo.id, url: original, mime }], () => {});
            if (saved === 0) throw new Error('not saved');
            Alert.alert('Saved', 'The photo is in your camera roll.');
          } catch (err) {
            Alert.alert(
              'Could not save it',
              err instanceof Error && err.message.includes('Permission') ? err.message : 'Try again in a moment.',
            );
          } finally {
            setSaving(false);
          }
        }}
        downloading={saving}
      />

      {/* Sending it on, and making it a moment — inside this modal so they draw on top. */}
      <ChatPicker api={api} t={t} sending={sending ? { photoId: photo.id } : null} onClose={() => setSending(false)} />
      {rippling && (
        <View style={StyleSheet.absoluteFill}>
          <AddMoment
            api={api}
            seed={{ id: photo.id, url: full, mime: 'image/jpeg' }}
            onCancel={() => setRippling(false)}
            onShared={() => setRippling(false)}
          />
        </View>
      )}
    </Modal>
  );
}
