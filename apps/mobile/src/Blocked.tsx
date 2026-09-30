/**
 * Who you have blocked, and undoing it — design §13.
 *
 * The only place a block can be seen at all. Making one happens on a
 * photograph or a moment, where the problem is; this is where somebody comes
 * back later, calmer, to check the list or change their mind. The other side
 * is never told either way, and the card says so, because "will they know?" is
 * the question anybody opening it is asking.
 *
 * Its own sheet, like `DevicesCard`, for the same reason: a list with no
 * length limit needs a scroll view that owns its height, and a destination in
 * the navigator would be a fourth place the app can be for something somebody
 * visits twice a year.
 */

import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Api, BlockedPerson } from './api';
import type { TabTheme } from './Events';
import { initialOf } from './lens';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: TabTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

export function BlockedCard({
  api,
  t,
  Button,
  onDone,
}: {
  api: Api;
  t: TabTheme;
  Button: ButtonComponent;
  onDone: () => void;
}) {
  // `null` until the first answer, so "nobody" is never said before it is known.
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { blocked } = await api.blocked().catch(() => ({ blocked: [] as BlockedPerson[] }));
    setPeople(blocked);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = useCallback(
    (person: BlockedPerson) => {
      Alert.alert(
        `Unblock ${person.name}?`,
        // What comes back, said before it does: everything the block hid, both ways.
        'You will see each other’s photos, messages, comments and moments again wherever you share an album or a group. They are not told.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                let failed = false;
                await api.unblock(person.actorId).catch(() => {
                  failed = true;
                });
                await load();
                setNote(
                  failed
                    ? `${person.name} could not be unblocked. Try again in a moment.`
                    : `${person.name} is unblocked.`,
                );
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    },
    [api, load],
  );

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDone}>
      {/* Tapping away closes, and the inner press stops that reaching the
          backdrop. The same pattern the Settings and Devices sheets use. */}
      <Pressable style={styles.backdrop} onPress={onDone}>
        <Pressable style={[styles.panel, { backgroundColor: t.bg }]} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.panelScroll}>
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.label, { color: t.fg }]}>Blocked</Text>
              <Text style={[styles.small, { color: t.dim }]}>
                You and the people here do not see each other's photos, messages,
                comments or moments — even in albums and groups you share. They
                are not told.
              </Text>

              {people?.map((person) => (
                <View key={person.actorId} style={[styles.row, { borderTopColor: t.line }]}>
                  {person.avatarUrl ? (
                    <Image
                      source={{ uri: person.avatarUrl }}
                      style={[styles.face, { backgroundColor: t.line }]}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View style={[styles.face, styles.centred, { backgroundColor: t.line }]}>
                      <Text style={[styles.letter, { color: t.dim }]}>
                        {initialOf(person.name)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: t.fg }]} numberOfLines={1}>
                      {person.name}
                    </Text>
                    {person.handle && (
                      <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                        @{person.handle}
                      </Text>
                    )}
                  </View>
                  <Button label="Unblock" onPress={() => unblock(person)} t={t} disabled={busy} />
                </View>
              ))}

              {people?.length === 0 && (
                <Text style={[styles.small, { color: t.dim }]}>You have not blocked anyone.</Text>
              )}
            </View>

            {note && <Text style={[styles.small, { color: t.dim }]}>{note}</Text>}

            <Button label="Done" onPress={onDone} t={t} primary />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /* Devices' sheet, measure for measure, so the two read as siblings. */
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000b' },
  panel: { maxHeight: '90%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  panelScroll: { padding: 16, paddingBottom: 40, gap: 16 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  face: { width: 36, height: 36, borderRadius: 18 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
});
