/**
 * Your contacts, with an Invite beside each — under the suggestions on Find
 * Friends.
 *
 * ## The address book never leaves the phone
 *
 * Find Friends was built to refuse the usual address-book upload, and the
 * argument at the top of `FindFriends.tsx` still stands: an uploaded address
 * book is a list of people who never agreed to anything. So this file reads
 * the contacts to draw them and for nothing else. It does not import the API
 * client, it sends nothing, and a test holds it to that.
 *
 * The cost is that the list cannot tell who is already here — that would take
 * the numbers to the server — so it says so in a line, and anybody it offers
 * an invite to may turn out to have an account.
 *
 * ## An invite is a text from you
 *
 * Invite opens the phone's own message composer, addressed and with your
 * profile link in it, and you press send. It is not sent by Parea: the
 * product's registered texting is for verification codes and nothing else, and
 * a message to somebody who never asked for one should come from the person
 * who knows them.
 */

import * as Contacts from 'expo-contacts';
import * as SMS from 'expo-sms';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { GroupTheme } from './Groups';
import { inviteText, toRows, type PhoneContact } from './invite';
import { initialOf } from './lens';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

/** How many rows are drawn before "Show more"; an address book can be thousands. */
const PAGE = 40;

type Access = 'checking' | 'ask' | 'denied' | 'granted';

export function InviteContacts({
  t,
  Button,
  link,
}: {
  t: GroupTheme;
  Button: ButtonComponent;
  /** What the text carries: your profile, so they land on somebody they know. */
  link: string;
}) {
  const [access, setAccess] = useState<Access>('checking');
  const [rows, setRows] = useState<PhoneContact[] | null>(null);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  /** Who has been texted from here, this visit. Nothing about it is kept. */
  const [invited, setInvited] = useState<Record<string, true>>({});

  const read = useCallback(async () => {
    try {
      const details = await Contacts.Contact.getAllDetails([
        Contacts.ContactField.FULL_NAME,
        Contacts.ContactField.PHONES,
      ]);
      setRows(toRows(details));
    } catch {
      setRows([]);
    }
  }, []);

  /*
   * Asked once at mount without prompting: somebody who has already said yes
   * sees their contacts straight away, and the dialog itself only ever comes
   * from the button that says what it is for.
   */
  useEffect(() => {
    void Contacts.getPermissionsAsync().then((answer) => {
      if (answer.granted) {
        setAccess('granted');
        void read();
      } else {
        setAccess(answer.canAskAgain ? 'ask' : 'denied');
      }
    });
  }, [read]);

  const ask = useCallback(async () => {
    const answer = await Contacts.requestPermissionsAsync();
    if (answer.granted) {
      setAccess('granted');
      await read();
    } else {
      setAccess('denied');
    }
  }, [read]);

  const invite = useCallback(
    async (row: PhoneContact) => {
      const body = inviteText(link);
      if (await SMS.isAvailableAsync()) {
        const { result } = await SMS.sendSMSAsync([row.number], body);
        // Android cannot tell; iOS says 'cancelled' when they backed out.
        if (result !== 'cancelled') setInvited((was) => ({ ...was, [row.id]: true }));
      } else {
        const joiner = Platform.OS === 'ios' ? '&' : '?';
        await Linking.openURL(`sms:${row.number}${joiner}body=${encodeURIComponent(body)}`);
      }
    },
    [link],
  );

  const matching = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, '');
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (digits.length >= 3 && r.number.replace(/\D/g, '').includes(digits)),
    );
  }, [rows, filter]);

  if (access === 'checking') return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.fg }]}>Invite your contacts</Text>
      <Text style={[styles.small, { color: t.dim }]}>
        Your contacts stay on this phone. Parea never sees them, so it cannot
        tell who is already here, and an invite is a text from you.
      </Text>

      {access === 'ask' && (
        <Button label="Show my contacts" t={t} onPress={() => void ask()} />
      )}

      {access === 'denied' && (
        <>
          <Text style={[styles.small, { color: t.dim }]}>
            Contacts are switched off for Parea.
          </Text>
          <Button label="Open Settings" t={t} onPress={() => void Linking.openSettings()} />
        </>
      )}

      {access === 'granted' && rows !== null && rows.length > 12 && (
        <TextInput
          value={filter}
          onChangeText={(next) => {
            setFilter(next);
            setShown(PAGE);
          }}
          placeholder="Search contacts"
          placeholderTextColor={t.dim}
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.card }]}
          accessibilityLabel="Search your contacts"
        />
      )}

      {access === 'granted' && rows !== null && rows.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>No contacts with a phone number.</Text>
      )}

      {matching.length > 0 && (
        <View style={[styles.list, { backgroundColor: t.card, borderColor: t.line }]}>
          {matching.slice(0, shown).map((row, i) => (
            <View
              key={row.id}
              style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}
            >
              {/* Quiet rather than on a lens: these are not people on Parea, and
                  a colour would make them look like they were. */}
              <View style={[styles.disc, { backgroundColor: t.bg }]}>
                <Text style={[styles.initial, { color: t.dim }]}>{initialOf(row.name)}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: t.fg }]} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                  {row.number}
                </Text>
              </View>
              {invited[row.id] ? (
                <Text style={[styles.done, { color: t.dim }]}>Invited</Text>
              ) : (
                <Pressable
                  onPress={() => void invite(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`Invite ${row.name} to Parea`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.invite,
                    { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.inviteText, { color: t.fg }]}>Invite</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {matching.length > shown && (
        <Button label="Show more" t={t} onPress={() => setShown((n) => n + PAGE)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, paddingTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 16, fontWeight: '600' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  invite: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  inviteText: { fontSize: 14, fontWeight: '600' },
  done: { fontSize: 13, fontWeight: '600' },
});
