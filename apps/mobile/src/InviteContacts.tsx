/**
 * Your contacts, with an Invite beside each — under the suggestions on Find
 * Friends.
 *
 * ## Who is already here, and nothing kept
 *
 * An uploaded address book is a list of people who never agreed to anything,
 * which is why this list used to stay on the phone and could not tell who was
 * already on Parea. It can now, on these terms: the numbers go once, in one
 * request (`onParea.find`), are matched against the people who proved a
 * number and chose to be found by it, and are dropped — the server keeps
 * none of them, and the people who matched nothing are simply not here.
 *
 * Only on a build whose permission dialog says so. Build 7 asked for contacts
 * in the words "never uploaded", and an update cannot change a dialog, so
 * there `onParea` is not passed and this is the invite list it always was.
 * This file still does not import the API client: the one way out is the
 * callback, and a test holds it to that.
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
import { Image as ExpoImage } from 'expo-image';
import * as SMS from 'expo-sms';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { GroupTheme } from './Groups';
import { inviteText, toE164, toRows, type PhoneContact } from './invite';
import { initialOf, lensFor } from './lens';

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

/** Somebody on Parea whose number is in your contacts. `ContactMatch` in the API client. */
type OnParea = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  standing?: 'friends' | 'asked' | 'asking' | 'none' | 'self';
  number: string;
};

export function InviteContacts({
  t,
  Button,
  link,
  onParea,
}: {
  t: GroupTheme;
  Button: ButtonComponent;
  /** What the text carries: your profile, so they land on somebody they know. */
  link: string;
  /**
   * Checking the contacts against Parea, on a build that may. Absent, nothing
   * leaves the phone. See the note at the top.
   */
  onParea?: {
    /** The country a local number in the contacts is read as. */
    dialCode: string;
    find: (numbers: string[]) => Promise<OnParea[]>;
    add: (actorId: string) => Promise<void>;
    open: (handle: string) => void;
  };
}) {
  const [access, setAccess] = useState<Access>('checking');
  const [rows, setRows] = useState<PhoneContact[] | null>(null);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  /** Who has been texted from here, this visit. Nothing about it is kept. */
  const [invited, setInvited] = useState<Record<string, true>>({});
  /** Contacts on Parea, by contact row id. Null until asked, or with nothing to ask. */
  const [here, setHere] = useState<Record<string, OnParea> | null>(null);
  /** Asks sent from here, this visit. */
  const [asked, setAsked] = useState<Record<string, 'asking' | 'asked'>>({});

  const find = onParea?.find;
  const dialCode = onParea?.dialCode;
  useEffect(() => {
    if (!rows || rows.length === 0 || !find || !dialCode) return;
    // One request, numbers only — no names, no labels — each sent once.
    const byNumber = new Map<string, string[]>();
    for (const row of rows) {
      const e164 = toE164(row.number, dialCode);
      if (e164) byNumber.set(e164, [...(byNumber.get(e164) ?? []), row.id]);
    }
    if (byNumber.size === 0) return;
    let live = true;
    void find([...byNumber.keys()])
      .then((people) => {
        if (!live) return;
        const next: Record<string, OnParea> = {};
        for (const person of people) {
          for (const id of byNumber.get(person.number) ?? []) next[id] = person;
        }
        setHere(next);
      })
      // Not knowing who is here is the list as it was: everybody gets Invite.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rows, find, dialCode]);

  const add = onParea?.add;
  const askToBeFriends = useCallback(
    async (person: OnParea) => {
      if (!add) return;
      setAsked((was) => ({ ...was, [person.actorId]: 'asking' }));
      try {
        await add(person.actorId);
        setAsked((was) => ({ ...was, [person.actorId]: 'asked' }));
      } catch {
        setAsked((was) => {
          const next = { ...was };
          delete next[person.actorId];
          return next;
        });
      }
    },
    [add],
  );

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

  /** On Parea, once each — two contacts can hold one person's number. */
  const onHere = useMemo(() => {
    if (!rows || !here) return [];
    const seen = new Set<string>();
    const out: { row: PhoneContact; person: OnParea }[] = [];
    for (const row of rows) {
      const person = here[row.id];
      if (!person || seen.has(person.actorId)) continue;
      seen.add(person.actorId);
      out.push({ row, person });
    }
    return out;
  }, [rows, here]);

  const matching = useMemo(() => {
    if (!rows) return [];
    const invitable = here ? rows.filter((r) => !here[r.id]) : rows;
    const q = filter.trim().toLowerCase();
    if (!q) return invitable;
    const digits = q.replace(/\D/g, '');
    return invitable.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (digits.length >= 3 && r.number.replace(/\D/g, '').includes(digits)),
    );
  }, [rows, here, filter]);

  if (access === 'checking') return null;

  return (
    <View style={styles.section}>
      {onHere.length > 0 && onParea && (
        <>
          <Text style={[styles.sectionTitle, { color: t.fg }]}>Already on Parea</Text>
          <View style={[styles.list, { backgroundColor: t.card, borderColor: t.line }]}>
            {onHere.map(({ row, person }, i) => {
              const standing = (asked[person.actorId] as OnParea['standing'] | undefined) ?? person.standing ?? 'none';
              const lens = lensFor(person.handle ?? person.actorId);
              return (
                <Pressable
                  key={person.actorId}
                  onPress={() => person.handle && onParea.open(person.handle)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name}, on Parea`}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: 1, borderTopColor: t.line },
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  {person.avatar ? (
                    <ExpoImage source={{ uri: person.avatar }} style={styles.disc} contentFit="cover" transition={120} />
                  ) : (
                    <View style={[styles.disc, { backgroundColor: lens.fill }]}>
                      <Text style={[styles.initial, { color: lens.ink }]}>{initialOf(row.name)}</Text>
                    </View>
                  )}
                  <View style={styles.rowText}>
                    {/* Your name for them first: it is your contact. */}
                    <Text style={[styles.rowName, { color: t.fg }]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                      {person.handle ? `@${person.handle}` : person.displayName ?? 'On Parea'}
                    </Text>
                  </View>
                  {standing === 'friends' ? (
                    <Text style={[styles.done, { color: t.dim }]}>Friends</Text>
                  ) : standing === 'asked' ? (
                    <Text style={[styles.done, { color: t.dim }]}>Asked</Text>
                  ) : (
                    <Pressable
                      onPress={() => void askToBeFriends(person)}
                      disabled={standing === 'asking'}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${row.name} as a friend`}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.invite,
                        {
                          backgroundColor: t.accent,
                          borderColor: t.accent,
                          opacity: standing === 'asking' ? 0.6 : pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.inviteText, { color: t.onAccent }]}>Add</Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.sectionTitle, { color: t.fg }]}>Invite your contacts</Text>
      <Text style={[styles.small, { color: t.dim }]}>
        {onParea
          ? 'Parea checks the numbers in your contacts against people who chose to be found by theirs, and keeps none of them. An invite is a text from you.'
          : 'Your contacts stay on this phone. Parea never sees them, so it cannot tell who is already here, and an invite is a text from you.'}
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
