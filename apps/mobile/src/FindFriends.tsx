/**
 * Find Friends — the people already here who may know you.
 *
 * Reached from the disc in the corner of Find, which is where the tray used to
 * be. Find is one box over three namespaces and it answers what you type; this
 * is the other half of the same question, and nobody can type it: *who is here
 * that I know?*
 *
 * ## Why this screen does not upload your contacts
 *
 * The obvious build is a contacts permission, an address-book upload and a
 * match. This product refuses that, and the reason is not squeamishness: an
 * uploaded address book is a list of people who never agreed to anything. Half
 * of them are not users; some of them are ex-partners and doctors and the
 * plumber. The dialog asks one person for a favour and spends everybody else's
 * privacy to grant it.
 *
 * So the suggestions come out of records this product already had a reason to
 * keep, and every one of them is a relationship the reader can already see the
 * other end of — friends in common, albums you were both in, groups you are
 * both in.
 *
 * The contacts permission it does ask for, under the suggestions, is for
 * inviting people who are not here yet — and the address book it opens stays
 * on the phone. See `InviteContacts.tsx`.
 *
 * ## Why it asks for a number instead
 *
 * The number is not what finds anybody; `recommendationsFor` never reads it. It
 * is the reciprocity. This is the one screen where somebody is handed the
 * benefit of everybody else being reachable, and the price of that is being
 * reachable themselves — so the page's first state is the ask, and the sentence
 * next to it says what adding it does rather than dressing it up as a security
 * step.
 *
 * ## The three states, in the order somebody meets them
 *
 *   **No number.** A field and a sentence. Nothing else, because a list of
 *   people under a form nobody has filled in is a page arguing with itself.
 *
 *   **A code outstanding.** The same card, with the field swapped for six
 *   digits and the two digits of the number it went to — which is the only
 *   thing somebody who mistyped needs in order to notice.
 *
 *   **A proved number.** The list, and a line saying the switch is on and where
 *   to turn it off. The line is not a boast: adding a number made somebody
 *   findable and they should be told so on the screen that did it, not
 *   discover it in Settings later.
 */

import { Image as ExpoImage } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, type Api, type Discovery, type Recommendation } from './api';
import { reasonFor } from './answers';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Glyph } from './Glyph';
import { InviteContacts } from './InviteContacts';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Back, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

/**
 * The countries a code can be texted to, as the server allows them.
 *
 * The same three as `smsCountries` defaults to on the web, which production
 * does not widen. Offering a country the server refuses would only turn a
 * choice into an error, so the list is the allowance and no longer — if
 * `SMS_COUNTRIES` grows, this grows with it.
 */
const COUNTRIES = [
  { region: 'US', name: 'United States', code: '+1' },
  { region: 'CA', name: 'Canada', code: '+1' },
  { region: 'GB', name: 'United Kingdom', code: '+44' },
] as const;
type Country = (typeof COUNTRIES)[number];

/**
 * The phone's own region, from `Intl` rather than `expo-localization` — a
 * native module, and this ships without a new build. Anywhere not on the list
 * starts on the first entry; the picker is one tap away.
 */
function deviceCountry(): Country {
  let region = '';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    region = (locale.split('-').find((part) => /^[A-Z]{2}$/.test(part)) ?? '').toUpperCase();
  } catch {}
  return COUNTRIES.find((c) => c.region === region) ?? COUNTRIES[0];
}

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

/** Suggestions drawn at a time. */
const SUGGESTION_PAGE = 10;

/** The dot on the status card while a number finds somebody: the mark's mint. */
const FINDABLE = '#66E7C6';

/** Why somebody is suggested, strongest first — the order `reasonFor` speaks in. */
type Kind = 'friends' | 'rolls' | 'groups';

function kindOf(person: Recommendation): Kind {
  return (person.mutuals ?? 0) > 0 ? 'friends' : (person.albums ?? 0) > 0 ? 'rolls' : 'groups';
}

/** The mark's three circles, one to a reason. */
const KIND_COLOUR: Record<Kind, string> = {
  friends: '#ffa6ad',
  rolls: '#99b1fa',
  groups: '#9cdec5',
};

function KindGlyph({ kind }: { kind: Kind }) {
  return (
    <Svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0d0f12"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === 'friends' && (
        <>
          <Circle cx="9.5" cy="8.5" r="3.5" />
          <Path d="M3 19.5c0-3.4 2.9-5 6.5-5s6.5 1.6 6.5 5" />
          <Path d="M16 5.4a3.5 3.5 0 0 1 0 6.2" />
          <Path d="M17.5 14.9c2.2.5 3.5 1.9 3.5 4.6" />
        </>
      )}
      {kind === 'rolls' && (
        <>
          <Rect x="8" y="4" width="12.5" height="12.5" rx="2" />
          <Path d="M16 20H5.5a2 2 0 0 1-2-2V8" />
        </>
      )}
      {kind === 'groups' && (
        <>
          <Path d="M9 2.5h10A2.5 2.5 0 0 1 21.5 5v5A2.5 2.5 0 0 1 19 12.5" />
          <Path d="M4 8h10a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 18H8l-4 3.5 1-3.5H4a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 4 8z" />
        </>
      )}
    </Svg>
  );
}

function Tick({ color }: { color: string }) {
  return (
    <Svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** Their picture, or the letter on their own lens when there is none. */
function Face({ person, size }: { person: Recommendation; size: number }) {
  const name = person.displayName?.trim() || person.handle || 'Someone';
  const lens = lensFor(person.handle ?? person.actorId);
  if (person.avatar) {
    return (
      <ExpoImage
        source={{ uri: person.avatar }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={[
        styles.centre,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: lens.fill },
      ]}
    >
      <Text style={{ fontSize: size * 0.38, fontWeight: '600', color: lens.ink }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

export function FindFriends({
  api,
  t,
  Button,
  webBase,
  onBack,
  onOpenPerson,
  onOpenSettings,
  onSearchHandle,
}: {
  api: Api;
  t: GroupTheme;
  Button: ButtonComponent;
  /** Where profiles live on the web, for the link an invite carries. */
  webBase: string;
  onBack: () => void;
  onOpenPerson: (handle: string) => void;
  /** The Settings sheet, where the findable switch is. */
  onOpenSettings: () => void;
  /** "Know their handle?": back to Find, on people, with the field focused. */
  onSearchHandle: () => void;
}) {
  /*
   * Nothing is handed back to the caller when a number is proved, and that is a
   * decision rather than an omission.
   *
   * The two digits and the switch are drawn in one other place — the Settings
   * sheet on the profile tab — and that tab reloads its account every time it
   * becomes the tab on screen. Since this screen is pushed over the tabs, there
   * is no route from here to that sheet that does not pass through the reload,
   * so a callback would be a prop whose only job is to duplicate it.
   */
  /** Null until the first answer: the difference between asking and nobody. */
  const [state, setState] = useState<Discovery | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The national number; the country code is `country`, its own control. */
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>(deviceCountry);
  const [code, setCode] = useState('');
  /**
   * The number a code has just gone to, as its last two digits.
   *
   * Local rather than from the server, and it is what puts the card in its
   * middle state. The pending row is deliberately invisible to every read in
   * the product — nothing about a claim nobody has proved belongs in an
   * `Account` — so "a code is outstanding" is knowledge this screen has and the
   * server will not hand back. Losing it by backing out is correct: the code
   * still works, and the way to use it is to ask again from the field, which
   * supersedes rather than accumulating.
   */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The consent box under the number. Unticked on every visit; see below. */
  const [smsAgreed, setSmsAgreed] = useState(false);

  /**
   * Who has been asked from here, locally.
   *
   * Not a reload. The server answers a request with the standing it produced,
   * and re-fetching the list to make one row disappear would take the whole
   * thing out from under a finger mid-scroll — the same call `SearchTab` makes
   * about its own suggestions, for the same reason.
   */
  const [asked, setAsked] = useState<Record<string, 'asking' | 'asked'>>({});
  /** How many suggestions are drawn: ten, and ten more each "Show more". */
  const [shown, setShown] = useState(SUGGESTION_PAGE);
  /** Your handle, for the profile link an invite carries; null until known or without one. */
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    void api
      .account()
      .then((account) => setHandle(account?.handle ?? null))
      .catch(() => {});
  }, [api]);

  const load = useCallback(async () => {
    try {
      setState(await api.discovery());
      setError(null);
    } catch {
      /*
       * Kept apart from an empty list, which is a real and common answer.
       * "Nobody new right now" and "we could not find out" are different
       * sentences and only one of them is worth a retry underneath.
       */
      setState({ phone: { last2: null, verified: false }, discoverable: false, people: [] });
      setError('Could not load this. Pull to try again.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.startPhone(fullNumber(country, phone));
      setSentTo(answer.last2 ?? null);
      setCode('');
    } catch (err) {
      /*
       * The one refusal worth its own sentence, and the server names it: a
       * number without a country code. "Invalid" would send somebody to retype
       * the same digits, because the thing that is wrong is not in them.
       */
      setError(
        err instanceof ApiError && err.body.error === 'needs_country_code'
          ? 'Start with the country code, like +44 or +1.'
          : err instanceof ApiError && err.body.error === 'country_not_supported'
            ? 'Numbers from that country are not supported yet.'
          : err instanceof ApiError && err.body.error === 'try_later'
            ? 'Confirming numbers is paused for today. Try again tomorrow.'
          : err instanceof ApiError && err.body.error === 'too_many_requests'
            ? 'That is a lot of codes for one hour. Try again later.'
            : err instanceof ApiError && err.body.error === 'not_configured'
              // The one failure about the deployment rather than the number,
              // and waiting will not fix it — so the sentence does not suggest
              // trying again.
              ? 'Confirming a number is not set up on this deployment yet.'
              : 'Could not send a code just now. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }, [api, country, phone]);

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.verifyPhone(code);
      setSentTo(null);
      setPhone('');
      setCode('');
      await load();
    } catch (err) {
      // The route knows which of five things went wrong — expired, mistyped,
      // spent, too many tries, already somebody else's — and says so. Inventing
      // a sentence here would eventually say the wrong one.
      setError(
        err instanceof ApiError && typeof err.body.message === 'string'
          ? err.body.message
          : 'That code did not work. Ask for another.',
      );
    } finally {
      setBusy(false);
    }
  }, [api, code, load]);

  const ask = useCallback(
    async (person: Recommendation) => {
      setAsked((was) => ({ ...was, [person.actorId]: 'asking' }));
      try {
        await api.askFriend(person.actorId);
        setAsked((was) => ({ ...was, [person.actorId]: 'asked' }));
      } catch {
        // Back to a button that can be pressed again, rather than a row stuck
        // saying it is doing something it has stopped doing.
        setAsked((was) => {
          const next = { ...was };
          delete next[person.actorId];
          return next;
        });
      }
    },
    [api],
  );

  const verified = state?.phone.verified === true;
  /** The first state: nothing added and no code outstanding — the whole page is the ask. */
  const asking = state !== null && !verified && sentTo === null;
  const nationalDigits = phone.replace(/\D/g, '').length;

  /*
   * A pasted international number, split back into its two controls: a code
   * the picker knows moves into the picker, and the rest stays. One it does
   * not know is left whole, and sent as typed — the server says whether it
   * can text there, in the same words as before.
   */
  const typeNumber = (next: string) => {
    const compact = next.replace(/[\s()-]/g, '');
    if (compact.startsWith('+')) {
      const match = [...COUNTRIES]
        .sort((a, b) => b.code.length - a.code.length)
        .find((c) => compact.startsWith(c.code));
      if (match) {
        setCountry(match.code === country.code ? country : match);
        setPhone(next.trim().slice(next.trim().indexOf(match.code) + match.code.length).trim());
        return;
      }
    }
    setPhone(next);
  };

  const pickCountry = () => {
    const labels = COUNTRIES.map((c) => `${c.name}  ${c.code}`);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, 'Cancel'], cancelButtonIndex: labels.length, title: 'Country code' },
        (index) => {
          if (index < COUNTRIES.length) setCountry(COUNTRIES[index]!);
        },
      );
    } else {
      Alert.alert('Country code', undefined, [
        ...COUNTRIES.map((c, i) => ({ text: labels[i]!, onPress: () => setCountry(c) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {/* The same disc, in the same corner, at the same height as every other
          way back in the app. */}
      <RoundButton t={t} onPress={onBack} accessibilityLabel="Back" style={styles.back}>
        <Back color={t.fg} />
      </RoundButton>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, (state === null || asking) && styles.filling]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={t.dim}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          <Text style={[styles.h1, { color: t.fg }]}>Find friends</Text>

          {state === null ? (
            <View style={styles.centreFill}>
              <Waiting size={36} />
            </View>
          ) : (
            <>
              {asking && (
                /*
                  The ask, and it is the whole page until it is answered.

                  A list of people underneath an unanswered form is a page
                  arguing with itself: one half saying "we need something from
                  you", the other already doing the thing. So there is no card
                  around it any more — the page is the card: one promise, the
                  number in two parts, the button and what pressing it agrees
                  to, and a quiet way out for somebody who only wanted a handle.
                */
                <>
                  <View style={styles.hero}>
                    <View style={[styles.disc, { backgroundColor: t.card, borderColor: t.line }]}>
                      <Glyph name="add-person" size={34} color={t.fg} />
                    </View>
                    <Text style={[styles.headline, { color: t.fg }]}>
                      Find contacts
                    </Text>
                    <Text style={[styles.body, { color: t.dim }]}>
                      Add your number so people who already have it can find you
                      here. Your contacts never leave your phone, and the number
                      is never shown to anybody.
                    </Text>
                  </View>

                  {/*
                    The country code as its own control, so a local number can
                    be typed the way people know it. It is what the old hint
                    under the field was asking for in words — we cannot guess
                    which country a local number belongs to, and a wrong guess
                    would quietly find nobody — answered by asking instead.
                  */}
                  <View style={styles.fieldRow}>
                    <Pressable
                      onPress={pickCountry}
                      accessibilityRole="button"
                      accessibilityLabel={`Country code ${country.code}, ${country.name}. Change`}
                      style={({ pressed }) => [
                        styles.countryBox,
                        { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={[styles.countryCode, { color: t.fg }]}>{country.code}</Text>
                      <Text style={[styles.countryCaret, { color: t.dim }]}>▾</Text>
                    </Pressable>
                    <TextInput
                      value={phone}
                      onChangeText={typeNumber}
                      placeholder={country.code === '+44' ? '7700 900123' : '201 555 0123'}
                      placeholderTextColor={t.dim}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      textContentType="telephoneNumber"
                      style={[
                        styles.input,
                        styles.numberField,
                        { color: t.fg, borderColor: t.line, backgroundColor: t.card },
                      ]}
                      accessibilityLabel="Your phone number"
                    />
                  </View>

                  {/*
                    Consent, as a box somebody ticks, between the number and
                    the button that sends to it — the same sentence, in the
                    same place, as the web's. See the note there: a carrier
                    refused the campaign until there was something to tick, so
                    the button stays off until it is.

                    The two links open a browser, the way Settings opens the
                    safety page: these are the product's own published
                    documents and there is no version of them in the app.
                  */}
                  <Pressable
                    onPress={() => setSmsAgreed(!smsAgreed)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: smsAgreed }}
                    style={styles.agreeRow}
                  >
                    <View
                      style={[
                        styles.agreeBox,
                        {
                          borderColor: smsAgreed ? t.accent : t.line,
                          backgroundColor: smsAgreed ? t.accent : 'transparent',
                        },
                      ]}
                    >
                      {smsAgreed && <Text style={[styles.agreeTick, { color: t.bg }]}>✓</Text>}
                    </View>
                    <Text style={[styles.hint, { color: t.dim, flex: 1 }]}>
                      I agree to receive one text message from Parea containing
                      a verification code each time I tap “Send me a code”. One
                      message per request, not a subscription. Message and data
                      rates may apply. See our{' '}
                      <Text
                        style={[styles.link, { color: t.accent }]}
                        onPress={() => void Linking.openURL('https://parea.photos/terms')}
                      >
                        Terms
                      </Text>
                      {' '}and{' '}
                      <Text
                        style={[styles.link, { color: t.accent }]}
                        onPress={() => void Linking.openURL('https://parea.photos/privacy')}
                      >
                        Privacy
                      </Text>
                      .
                    </Text>
                  </Pressable>

                  <Button
                    label="Send me a code"
                    t={t}
                    primary
                    disabled={busy || !smsAgreed || nationalDigits < 6}
                    onPress={() => void sendCode()}
                  />
                  {busy && <Waiting size={20} />}
                  {error && <Text style={[styles.error, { color: t.fg }]}>{error}</Text>}

                  <Text style={[styles.handleLine, { color: t.dim }]}>
                    Know their handle?{' '}
                    <Text
                      style={[styles.handleLink, { color: t.fg }]}
                      onPress={onSearchHandle}
                      accessibilityRole="link"
                    >
                      Search on Find
                    </Text>
                  </Text>
                </>
              )}

              {!verified && !asking && (
                /*
                  A code outstanding: the card it has always been, with the
                  six digits and the two of the number it went to.
                */
                <View style={[styles.card, { backgroundColor: t.card, borderColor: t.accent }]}>
                  <Text style={[styles.cardTitle, { color: t.fg }]}>
                    Add your phone number
                  </Text>
                  <Text style={[styles.small, { color: t.dim }]}>
                    So the people who already have your number can find you here.
                    That is the whole of it — your contacts never leave your
                    phone, and the number itself is never stored or shown to
                    anybody.
                  </Text>

                  <Text style={[styles.small, { color: t.fg }]}>
                    We sent a code to the number ending {sentTo}.
                  </Text>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="123456"
                    placeholderTextColor={t.dim}
                    keyboardType="number-pad"
                    // Lets the keyboard fill it straight from the text,
                    // which is the same hand-off the sign-in field takes.
                    autoComplete="sms-otp"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    style={[styles.input, styles.code, { color: t.fg, borderColor: t.line }]}
                    accessibilityLabel="The six-digit code we texted you"
                  />
                  <Button
                    label="Confirm"
                    t={t}
                    primary
                    disabled={busy || code.trim().length < 6}
                    onPress={() => void confirm()}
                  />
                  {/* Asking again supersedes rather than accumulating —
                      only the newest code can be presented — so this is
                      "start over" without saying so. */}
                  <Button
                    label="Use a different number"
                    t={t}
                    disabled={busy}
                    onPress={() => {
                      setSentTo(null);
                      setCode('');
                      setError(null);
                    }}
                  />

                  {busy && <Waiting size={20} />}
                </View>
              )}

              {error && !asking && <Text style={[styles.error, { color: t.fg }]}>{error}</Text>}

              {verified && (
                <>
                  {/*
                    What the number did, said on the screen that asked for it.

                    Not a boast and not fine print. Adding a number made
                    somebody findable by anybody who has it, and the honest place
                    to say so is here rather than leaving them to discover it in
                    Settings — which is also where the sentence points, because a
                    statement about a switch with no route to the switch is worse
                    than silence.
                  */}
                  <View style={[styles.status, { backgroundColor: t.card, borderColor: t.line }]}>
                    <View
                      style={[
                        styles.dot,
                        state.discoverable
                          ? { backgroundColor: FINDABLE, boxShadow: '0 0 0 4px rgba(102,231,198,0.14)' }
                          : { backgroundColor: t.dim },
                      ]}
                    />
                    <View style={styles.rowText}>
                      <Text style={[styles.statusTitle, { color: t.fg }]}>
                        {state.discoverable ? 'Findable' : 'Not findable'} by your number ··
                        {state.phone.last2 ?? '••'}
                      </Text>
                      <Text style={[styles.statusSub, { color: t.dim }]}>
                        {state.discoverable
                          ? 'People who have it can find you.'
                          : 'Switched off in Settings.'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={onOpenSettings}
                      accessibilityRole="button"
                      accessibilityLabel="Open Settings"
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.pill,
                        { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={[styles.pillText, { color: t.fg }]}>Settings</Text>
                    </Pressable>
                  </View>

                  {state.people.length === 0 ? (
                    /*
                      The empty state, and it has to be a sentence rather than a
                      shrug.

                      This list is built from albums, groups and friends in
                      common, so empty means something specific and cheerful: the
                      product has nothing to go on yet. Saying that is the
                      difference between a page that looks broken and one that
                      tells somebody what would fill it.
                    */
                    <View style={styles.nothing}>
                      <Glyph name="add-person" size={34} color={t.dim} />
                      <Text style={[styles.nothingText, { color: t.dim }]}>
                        Nobody new to suggest right now.
                      </Text>
                      <Text style={[styles.nothingText, { color: t.dim }]}>
                        Suggestions come from rolls you have both been in,
                        groups you are both in, and friends you have in common —
                        so this fills up as you share evenings with people. You
                        can also find anybody by their handle on Find.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.section}>
                      <View style={styles.sectionHead}>
                        <Text style={[styles.sectionTitle, { color: t.fg }]}>
                          People you may know
                        </Text>
                        <Text style={[styles.count, { color: t.dim }]}>{state.people.length}</Text>
                      </View>

                      {/* One card of rows rather than a card per row: a list
                          reads as a list. */}
                      <View style={[styles.list, { backgroundColor: t.card, borderColor: t.line }]}>
                        {state.people.slice(0, shown).map((person, i) => {
                          const name = person.displayName?.trim() || person.handle || 'Someone';
                          const standing = asked[person.actorId];
                          const kind = kindOf(person);
                          return (
                            <Pressable
                              key={person.actorId}
                              // The row opens the person; the button asks. A row
                              // whose only action is the ask would make deciding
                              // whether you know somebody impossible from here.
                              onPress={() => person.handle && onOpenPerson(person.handle)}
                              accessibilityRole="button"
                              accessibilityLabel={`${name}, ${reasonFor(person)}`}
                              style={({ pressed }) => [
                                styles.row,
                                i > 0 && { borderTopWidth: 1, borderTopColor: t.line },
                                { opacity: pressed ? 0.85 : 1 },
                              ]}
                            >
                              <View>
                                <Face person={person} size={48} />
                                {/* Why they are here, as a colour on the corner of
                                    their face: friends, rolls, groups. */}
                                <View
                                  style={[
                                    styles.kind,
                                    { backgroundColor: KIND_COLOUR[kind], borderColor: t.card },
                                  ]}
                                >
                                  <KindGlyph kind={kind} />
                                </View>
                              </View>
                              <View style={styles.rowText}>
                                <Text style={[styles.rowName, { color: t.fg }]} numberOfLines={1}>
                                  {name}
                                </Text>
                                <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                                  {reasonFor(person)}
                                </Text>
                              </View>

                              {standing === 'asked' ? (
                                /*
                                  A word in an outline rather than a disabled
                                  button. Asking is done and there is nothing to
                                  press; a greyed-out Add invites a second tap and
                                  answers it with nothing.
                                */
                                <View style={[styles.asked, { borderColor: t.line }]}>
                                  <Tick color={t.dim} />
                                  <Text style={[styles.askText, { color: t.dim }]}>Asked</Text>
                                </View>
                              ) : (
                                <Pressable
                                  onPress={() => void ask(person)}
                                  disabled={standing === 'asking'}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Add ${name} as a friend`}
                                  hitSlop={6}
                                  style={({ pressed }) => [
                                    styles.add,
                                    {
                                      backgroundColor: t.accent,
                                      opacity: standing === 'asking' ? 0.6 : pressed ? 0.8 : 1,
                                    },
                                  ]}
                                >
                                  <Glyph name="add-person" size={16} color={t.onAccent} />
                                  <Text style={[styles.askText, { color: t.onAccent }]}>Add</Text>
                                </Pressable>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                      {state.people.length > shown && (
                        <Button
                          label="Show more"
                          t={t}
                          onPress={() => setShown((n) => n + SUGGESTION_PAGE)}
                        />
                      )}
                    </View>
                  )}

                  {/* Without a handle there is no profile to land on, so the
                      invite carries the front door instead. */}
                  <InviteContacts
                    t={t}
                    Button={Button}
                    link={handle ? `${webBase}/u/${handle}` : webBase}
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * What `startPhone` is sent: the picker's code and the digits, spaces gone —
 * `+447700900123`. A number typed with its own `+` that the picker did not
 * claim is sent as typed, so the server can say what it says about it.
 */
function fullNumber(country: Country, phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[\s()-]/g, '');
  return `${country.code}${trimmed.replace(/\D/g, '').replace(/^0+/, '')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  /* The album's own back button, at the album's own inset — one way back,
     wherever you are. */
  back: { position: 'absolute', top: 52, left: 16, zIndex: 3 },
  scroll: { paddingTop: 100, paddingHorizontal: 20, paddingBottom: 48, gap: 16 },
  /* Paired with `flexGrow: 1` so the spinner centres in the scroll view rather
     than sitting under the title. */
  filling: { flexGrow: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  centreFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },

  /* Ringed in the accent rather than the line colour: this is the one card on
     the screen that is asking for something. */
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  /* Six digits read as digits: spaced out and centred, so a mistyped one is
     visible without counting. */
  code: { textAlign: 'center', letterSpacing: 6, fontSize: 20, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12.5, lineHeight: 18 },

  /* The first state, with no card: the promise centred under the title. */
  hero: { alignItems: 'center', gap: 14, paddingTop: 44, paddingHorizontal: 8, paddingBottom: 8 },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 28,
    textAlign: 'center',
    maxWidth: 300,
  },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 310 },
  fieldRow: { flexDirection: 'row', gap: 8 },
  countryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  countryCode: { fontSize: 16 },
  countryCaret: { fontSize: 12 },
  numberField: { flex: 1 },
  /* At the foot of the page, which `filling` makes the foot of the screen. */
  handleLine: { marginTop: 'auto', paddingTop: 56, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  handleLink: { fontWeight: '600' },
  /* Underlined as well as coloured: colour alone is not a link to somebody who
     cannot see the difference, and these two are the only pressable words in a
     paragraph rather than a row of their own. */
  link: { textDecorationLine: 'underline' },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  agreeBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreeTick: { fontSize: 14, fontWeight: '700', lineHeight: 16 },
  small: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 13, lineHeight: 19 },

  /* Where the number stands: a dot, two lines, and the way to the switch. */
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 2 },
  statusTitle: { fontSize: 14, fontWeight: '600' },
  statusSub: { fontSize: 12.5, lineHeight: 17 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  pillText: { fontSize: 13, fontWeight: '600' },

  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  count: { fontSize: 13 },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  kind: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 11,
    paddingRight: 14,
    borderRadius: 999,
  },
  asked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingLeft: 10,
    paddingRight: 13,
    borderRadius: 999,
    borderWidth: 1,
  },
  askText: { fontSize: 14, fontWeight: '600' },
  /* `flex: 1` and `minWidth: 0` so a long name wraps or truncates instead of
     pushing the button off the edge. */
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 15.5, fontWeight: '600' },

  nothing: { paddingTop: 40, alignItems: 'center', gap: 12 },
  nothingText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 320 },
});
