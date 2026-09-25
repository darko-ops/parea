/**
 * Where you are signed in, and what can sign you in — design §3.
 *
 * The app's half of the web's Devices screen, and deliberately the same two
 * lists in the same order, because they answer the same question: *what can get
 * into this account?* A session is a device that is already in; a passkey is a
 * device that can let itself in whenever it likes.
 *
 * A card rather than a screen with a route. It is reached from one button on the
 * profile tab and left by one button on itself — a destination in the navigator
 * would be a fourth place the app can be, for something somebody visits twice a
 * year.
 */

import { ago } from '@parea/cards';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import type { Api, DeviceListing, PasskeyListing } from './api';
import type { TabTheme } from './Events';
import { addPasskey } from './signin';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: TabTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

/**
 * How somebody got in, in words.
 *
 * `guest` is the awkward one and it is said rather than hidden: a device that
 * was contributing before it signed in, folded into the account by a later
 * sign-in elsewhere. It can delete this person's photographs, so it belongs on
 * the list, and the honest description is that no sign-in was recorded for it.
 */
function howIn(method: DeviceListing['method']): string {
  if (method === 'passkey') return 'signed in with a passkey';
  if (method === 'code') return 'signed in with a code';
  return 'added photos before signing in';
}

export function DevicesCard({
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
  const [devices, setDevices] = useState<DeviceListing[] | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyListing[] | null>(null);
  const [manageable, setManageable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /*
   * One clock for every "2 hours ago" on this card.
   *
   * `ago` is handed the time rather than reading it, so a list of six rows is
   * six comparisons against one instant instead of six slightly different ones.
   */
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const [sessions, keys] = await Promise.all([
      api.devices().catch(() => ({ devices: [], manageable: true })),
      api.passkeys().catch(() => ({ passkeys: [] })),
    ]);
    setDevices(sessions.devices);
    setManageable(sessions.manageable !== false);
    setPasskeys(keys.passkeys);
    setNow(new Date());
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const endOne = useCallback(
    (device: DeviceListing) => {
      /*
       * This phone is a different question from any other row.
       *
       * Ending somebody else's session is a revoke and nothing local changes.
       * Ending this one is signing out, and the keychain has to go with it —
       * otherwise the app keeps a token that is valid in shape and refused in
       * fact, and every screen shows a loading state that never resolves. So
       * this row is handed back to the caller's Sign out, which already does
       * the three stores properly.
       */
      if (device.current) {
        setNote('Use Sign out to leave this phone — it has more to clear than a row.');
        return;
      }

      Alert.alert(
        'Sign out this device?',
        `${device.label} will need to sign in again. Nothing is deleted.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign out',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await api.endDevice(device.id).catch(() => {});
                await load();
                setNote(`${device.label} was signed out.`);
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

  const endOthers = useCallback(() => {
    Alert.alert(
      'Sign out everywhere else?',
      'Every other browser and phone will need to sign in again. This one stays signed in, and nothing is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out others',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await api.endOtherDevices().catch(() => ({ ended: 0 }));
              await load();
              setNote(
                result.ended === 0
                  ? 'Nothing else was signed in.'
                  : `${result.ended} ${result.ended === 1 ? 'device' : 'devices'} signed out.`,
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [api, load]);

  const add = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const outcome = await addPasskey(api);
      if (!outcome.ok) {
        // A null note is a cancellation, and says nothing.
        if (outcome.note) setNote(outcome.note);
        return;
      }
      await load();
      setNote('Passkey added. This phone can sign you in now.');
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  const removeKey = useCallback(
    (passkey: PasskeyListing) => {
      Alert.alert(
        'Remove this passkey?',
        // Said every time, because it is the thing that makes removing one safe
        // to do: a code to the inbox is never taken away.
        `${passkey.label ?? 'This passkey'} will stop signing you in. A code to your email still works.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await api.removePasskey(passkey.id).catch(() => {});
                await load();
                setNote('Passkey removed.');
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

  const others = (devices ?? []).filter((device) => !device.current).length;

  return (
    <View style={{ gap: 16 }}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Where you are signed in</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          Every browser and phone holding your account. Sign one out if you do
          not recognise it, or if you have lent it to somebody.
        </Text>

        {devices?.map((device) => (
          <View key={device.id} style={[styles.row, { borderTopColor: t.line }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowName, { color: t.fg }]}>
                {device.label}
                {device.current ? ' · this phone' : ''}
              </Text>
              <Text style={[styles.small, { color: t.dim }]}>
                {howIn(device.method)} · last used {ago(new Date(device.lastSeenAt), now)}
              </Text>
            </View>
            {!device.current && (
              <Button label="Sign out" onPress={() => endOne(device)} t={t} disabled={busy} />
            )}
          </View>
        ))}

        {!manageable && (
          /*
           * A token from before sessions existed, which cannot be listed. The
           * app's next `startSession` on a cold launch mints one, so this is a
           * sentence about now rather than a permanent state.
           */
          <Text style={[styles.small, { color: t.dim }]}>
            This phone signed in before this screen existed, so it is not listed
            yet. Signing out and back in adds it.
          </Text>
        )}

        {others > 0 && (
          <Button
            label="Sign out everywhere else"
            onPress={endOthers}
            t={t}
            disabled={busy}
          />
        )}
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Passkeys</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          A passkey lets this phone sign you in with Face ID instead of a code
          from your inbox. A code always works too — removing every passkey does
          not lock you out.
        </Text>

        {passkeys?.map((passkey) => (
          <View key={passkey.id} style={[styles.row, { borderTopColor: t.line }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowName, { color: t.fg }]}>
                {passkey.label ?? 'A passkey'}
              </Text>
              <Text style={[styles.small, { color: t.dim }]}>
                {/* Whether it is synced decides whether losing the device loses
                    the key, which is the only thing about it worth printing. */}
                {passkey.backedUp ? 'Saved to your keychain' : 'On one device only'}
                {' · '}
                {passkey.lastUsedAt
                  ? `last used ${ago(new Date(passkey.lastUsedAt), now)}`
                  : 'never used'}
              </Text>
            </View>
            <Button label="Remove" onPress={() => removeKey(passkey)} t={t} disabled={busy} />
          </View>
        ))}

        {passkeys?.length === 0 && (
          <Text style={[styles.small, { color: t.dim }]}>No passkeys yet.</Text>
        )}

        <Button
          label={busy ? 'Working…' : 'Add a passkey'}
          onPress={add}
          t={t}
          disabled={busy}
        />
      </View>

      {note && <Text style={[styles.small, { color: t.dim }]}>{note}</Text>}

      <Button label="Done" onPress={onDone} t={t} primary />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  /*
   * A rule above each row rather than between them, and none above the first.
   *
   * `gap` on the card already separates the blocks; what the rows need is a
   * line saying they are a list rather than three paragraphs.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  /* `flex: 1` so a long label wraps instead of pushing the button off the
     edge — "A browser on Windows" plus a date is wider than a phone. */
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
});
