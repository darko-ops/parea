/**
 * Sending a photograph or a moment into one of your chats.
 *
 * Reached from the paper plane in the photo viewer. Every chat you are in —
 * one-to-one and groups, most recently active first — with an optional line to
 * go with it. One tap on a chat sends and says where it went; nothing is sent
 * until a chat is chosen.
 *
 * The server decides whether it may go: a photograph from a private roll only
 * by the person who took it, somebody else's moment only to a chat whose
 * every member could already see it. Its refusal is said here in words.
 */

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, type Api, type MyGroupDetail } from './api';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';

export type Sending = { photoId: string } | { momentId: string };

export function ChatPicker({
  api,
  t,
  sending,
  onClose,
}: {
  api: Api;
  t: GroupTheme;
  /** What is being sent; null keeps the sheet closed. */
  sending: Sending | null;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<MyGroupDetail[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    if (!sending) return;
    setNote('');
    setSaid(null);
    setFailed(false);
    let live = true;
    api
      .myGroupsDetailed()
      .then((list) => {
        if (!live) return;
        setChats(
          [...list].sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '')),
        );
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api, sending]);

  const send = async (chat: MyGroupDetail) => {
    if (!sending || busy) return;
    setBusy(chat.id);
    setSaid(null);
    try {
      await api.postGroupMessage(chat.id, note.trim(), sending);
      setSaid({ text: `Sent to ${chat.title}`, bad: false });
      setTimeout(onClose, 900);
    } catch (err) {
      setSaid({ text: refusal(err, 'photoId' in sending), bad: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={sending !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: t.fg }]}>
            {sending && 'momentId' in sending ? 'Send this moment' : 'Send this photo'}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[styles.close, { color: t.accent }]}>Done</Text>
          </Pressable>
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a message (optional)"
          placeholderTextColor={t.dim}
          maxLength={2000}
          style={[styles.note, { color: t.fg, borderColor: t.line, backgroundColor: t.card }]}
        />

        {said && (
          <Text style={[styles.said, { color: said.bad ? '#e8481c' : t.dim }]} accessibilityLiveRegion="polite">
            {said.text}
          </Text>
        )}

        {failed ? (
          <Text style={[styles.empty, { color: t.dim }]}>Your chats could not be loaded. Try again in a moment.</Text>
        ) : chats === null ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={t.dim} />
        ) : chats.length === 0 ? (
          <Text style={[styles.empty, { color: t.dim }]}>You are not in any chats yet.</Text>
        ) : (
          <FlatList
            data={chats}
            keyExtractor={(chat) => chat.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const face = item.photoUrl ?? item.deck[0]?.avatarUrl ?? null;
              const lens = lensFor(item.id);
              return (
                <Pressable
                  onPress={() => void send(item)}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Send to ${item.title}`}
                  style={({ pressed }) => [styles.row, { borderBottomColor: t.line, opacity: pressed ? 0.6 : 1 }]}
                >
                  {face ? (
                    <Image source={{ uri: face }} style={[styles.face, { backgroundColor: t.line }]} contentFit="cover" />
                  ) : (
                    <View style={[styles.face, styles.letter, { backgroundColor: lens.fill }]}>
                      <Text style={{ color: lens.ink, fontWeight: '700' }}>{initialOf(item.title)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.name, { color: t.fg }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[styles.kind, { color: t.dim }]}>
                      {item.kind === 'direct' ? 'Chat' : `Group · ${item.memberCount} people`}
                    </Text>
                  </View>
                  {busy === item.id ? (
                    <ActivityIndicator color={t.dim} />
                  ) : (
                    <Text style={[styles.send, { color: t.accent }]}>Send</Text>
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

/** The server's refusal, in a sentence. */
function refusal(err: unknown, photo: boolean): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'private_roll':
        return 'This photo is in a private roll. Only the person who took it can send it on.';
      case 'not_shareable':
        return 'Not everyone in that chat can see this moment, so it can’t go there.';
      case 'photo_not_found':
        return 'This photo isn’t available to send any more.';
      case 'moment_not_found':
        return 'This moment has ended.';
    }
  }
  return `Couldn’t send the ${photo ? 'photo' : 'moment'}. Try again in a moment.`;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 20, paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  close: { fontSize: 16, fontWeight: '600' },
  note: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  said: { marginTop: 12, fontSize: 14 },
  empty: { marginTop: 32, fontSize: 15, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  face: { width: 40, height: 40, borderRadius: 20 },
  letter: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '600' },
  kind: { fontSize: 13, marginTop: 2 },
  send: { fontSize: 15, fontWeight: '600' },
});
