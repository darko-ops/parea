/**
 * Find Friends — the people already here who may know you.
 *
 * Reached from the disc in the corner of Find, which is where the tray used to
 * be. Find is one box over three namespaces and it answers what you type; this
 * is the other half of the same question, and nobody can type it: *who is here
 * that I know?*
 *
 * ## Why this screen does not ask for your contacts
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
 * both in. There is no permission prompt on this screen because there is
 * nothing to ask for.
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
import { Glyph } from './Glyph';
import type { GroupTheme } from './Groups';
import { initialOf, lensFor } from './lens';
import { Back, RoundButton } from './RoundButton';
import { Waiting } from './Waiting';

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: GroupTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

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
  onBack,
  onOpenPerson,
}: {
  api: Api;
  t: GroupTheme;
  Button: ButtonComponent;
  onBack: () => void;
  onOpenPerson: (handle: string) => void;
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

  const [phone, setPhone] = useState('');
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

  /**
   * Who has been asked from here, locally.
   *
   * Not a reload. The server answers a request with the standing it produced,
   * and re-fetching the list to make one row disappear would take the whole
   * thing out from under a finger mid-scroll — the same call `SearchTab` makes
   * about its own suggestions, for the same reason.
   */
  const [asked, setAsked] = useState<Record<string, 'asking' | 'asked'>>({});

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
      const answer = await api.startPhone(phone);
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
  }, [api, phone]);

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
          contentContainerStyle={[styles.scroll, state === null && styles.filling]}
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
              {!verified && (
                /*
                  The ask, and it is the whole page until it is answered.

                  A list of people underneath an unanswered form is a page
                  arguing with itself: one half saying "we need something from
                  you", the other already doing the thing.
                */
                <View style={[styles.card, { backgroundColor: t.card, borderColor: t.accent }]}>
                  <Text style={[styles.cardTitle, { color: t.fg }]}>
                    Add your phone number
                  </Text>
                  <Text style={[styles.small, { color: t.dim }]}>
                    So the people who already have your number can find you here.
                    That is the whole of it — we do not read your contacts, and
                    the number itself is never stored or shown to anybody.
                  </Text>

                  {sentTo === null ? (
                    <>
                      <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        placeholder="+44 7700 900123"
                        placeholderTextColor={t.dim}
                        keyboardType="phone-pad"
                        autoComplete="tel"
                        textContentType="telephoneNumber"
                        style={[styles.input, { color: t.fg, borderColor: t.line }]}
                        accessibilityLabel="Your phone number, with its country code"
                      />
                      <Text style={[styles.hint, { color: t.dim }]}>
                        Start with the country code. We cannot guess which
                        country a local number belongs to, so a wrong guess
                        would quietly find nobody.
                      </Text>
                      <Button
                        label="Send me a code"
                        t={t}
                        primary
                        disabled={busy || phone.trim().length < 7}
                        onPress={() => void sendCode()}
                      />
                      {/*
                        What pressing the button does, under the button.

                        Five things have to be here and each is a sentence rather
                        than a clause of boilerplate: who texts you, what
                        arrives, how often, who pays, and where the rules are. It
                        reads as ordinary honesty and it is also, precisely, what
                        US carriers check when they ask for proof of consent — a
                        verification campaign is approved or refused on whether
                        the screen asking for the number tells somebody they are
                        about to be texted.

                        Under the control rather than over it, which is where the
                        eye already is when reaching for it — and the same place
                        the web's card puts it. Two clients wording one consent
                        two ways is bad enough; two clients *placing* it
                        differently is a screenshot of one that does not evidence
                        the other, and one campaign covers both.

                        It *asks* rather than describes, which is a correction a
                        carrier made for us. "Tapping this sends you one text…"
                        states a fact about the button; consent has to be somebody
                        agreeing to receive messages, not being told some will
                        arrive. Naming the button inside the sentence is what ties
                        the agreement to the act.

                        The two links open a browser, the way Settings opens the
                        safety page: these are the product's own published
                        documents and there is no version of them in the app.
                      */}
                      <Text style={[styles.hint, { color: t.dim }]}>
                        By tapping “Send me a code” you agree to receive one text
                        message from Parea containing a verification code. One
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
                    </>
                  ) : (
                    <>
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
                    </>
                  )}

                  {busy && <Waiting size={20} />}
                </View>
              )}

              {error && <Text style={[styles.error, { color: t.fg }]}>{error}</Text>}

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
                  <Text style={[styles.standing, { color: t.dim }]}>
                    {state.discoverable
                      ? `Your number ends ${state.phone.last2 ?? '••'}. People who have it can find you — turn that off in Settings whenever you like.`
                      : `Your number ends ${state.phone.last2 ?? '••'}. People who have it cannot find you: that is switched off in Settings.`}
                  </Text>

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
                      <Text style={[styles.sectionTitle, { color: t.fg }]}>
                        People you may know
                      </Text>

                      {state.people.map((person) => {
                        const name = person.displayName?.trim() || person.handle || 'Someone';
                        const standing = asked[person.actorId];
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
                              {
                                backgroundColor: t.card,
                                borderColor: t.line,
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}
                          >
                            <Face person={person} size={44} />
                            <View style={styles.rowText}>
                              <Text
                                style={[styles.rowName, { color: t.fg }]}
                                numberOfLines={1}
                              >
                                {name}
                              </Text>
                              <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
                                {reasonFor(person)}
                              </Text>
                            </View>

                            {standing === 'asked' ? (
                              /*
                                A word rather than a disabled button.

                                Asking is done and there is nothing to press;
                                a greyed-out "Add friend" invites a second tap
                                and answers it with nothing.
                              */
                              <Text style={[styles.done, { color: t.dim }]}>Asked</Text>
                            ) : (
                              <Button
                                label="Add friend"
                                t={t}
                                primary
                                disabled={standing === 'asking'}
                                onPress={() => void ask(person)}
                              />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
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
  /* Underlined as well as coloured: colour alone is not a link to somebody who
     cannot see the difference, and these two are the only pressable words in a
     paragraph rather than a row of their own. */
  link: { textDecorationLine: 'underline' },
  small: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 13, lineHeight: 19 },
  standing: { fontSize: 12.5, lineHeight: 18 },

  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.01 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  /* `flex: 1` and `minWidth: 0` so a long name wraps or truncates instead of
     pushing the button off the edge. */
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 15.5, fontWeight: '600' },
  done: { fontSize: 13, fontWeight: '600' },

  nothing: { paddingTop: 40, alignItems: 'center', gap: 12 },
  nothingText: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 320 },
});
