/**
 * Making an event — design §3 screen 1, and §7.3's window.
 *
 * The window is the field that matters, and this screen no longer asks for it.
 * It used to: a radio list of Tonight / Last night / Today / Yesterday, turned
 * into a window by `when.ts`. That put the question to the wrong party. The
 * phone holds the answer already and holds it exactly — a night out is a run
 * of photos with hours of nothing either side — so `DetectedEvents` reads the
 * last few days and offers the runs it finds. Tap one and the window comes
 * from the actual first and last shutter press, accurate to the minute rather
 * than to the nearest six hours.
 *
 * The picker survives as the fallback, because detection has two honest ways
 * to come up empty: no library permission, and an event that has not been
 * photographed yet — someone creating the event as the party starts. Both end
 * with the same question, now asked second and only when needed.
 *
 * After creating, the screen becomes the share step rather than dumping the
 * host back into an empty grid. The event is worth nothing until the link
 * reaches the group chat, and the moment the host is most likely to send it is
 * the second after they made it.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { CENTRED, CoverFrame, type CoverFraming } from './FrameCover';
import { InvitePicker } from './InvitePeople';
import type { Api, InvitablePerson } from './api';
import type { GroupTheme } from './Groups';
import { uploadCover } from './platform';
import { sandboxCopy, windowOf, type LibraryPhoto } from './library';

/**
 * The day an album happened, as `YYYY-MM-DD`.
 *
 * Local parts, never `toISOString().slice(0, 10)`. A photograph taken at eleven
 * at night is dated tomorrow in UTC, and "the evening of the 14th" is exactly
 * what this field is for — the same construction `eventDateFor` used before the
 * question went away.
 */
function dayOf(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export type CreatedEvent = {
  id: string;
  name: string;
  linkToken: string;
  startsAt: string | null;
  endsAt: string | null;
};

/*
 * The picked run is deliberately *not* carried on CreatedEvent.
 *
 * It was, briefly, so the event screen could open the grid on photos already
 * read and narrowed. It did not need to: the run's window is stored on the
 * event, and the event screen's `resolveWindow` already prefers a stored
 * window over anything it could infer. Threading the bundle through bought a
 * skipped rescan and cost a field on a shared type that one screen set and
 * nothing read — which is how the other rotted lists in this repository
 * started.
 */

export function CreateEvent({
  api,
  groupId,
  groupName,
  recentPlaces = [],
  chosen = [],
  framing = null,
  t,
  onCancel,
  onCreated,
  Button,
}: {
  api: Api;
  /** Where links live, for the message that gets shared. */
  groupId?: string;
  groupName?: string;
  /**
   * Places this person has used before, newest first.
   *
   * Their own, from their own events. There is no directory of places and
   * there should not be: suggesting somewhere they have never been would be
   * inventing a fact about them, and a place here is free text a host typed,
   * never anything derived from a photo.
   */
  recentPlaces?: string[];
  /**
   * What was chosen on the page before, in the order it was chosen.
   *
   * The first one leads the album — which is what the cover chooser used to ask
   * for separately — and the span they cover is the album's window. Empty is a
   * real answer: an album can be made before the evening it is for.
   */
  chosen?: LibraryPhoto[];
  /**
   * How the cover sits in the card, from the screen before.
   *
   * Null for a caller that had nothing to frame. Carried rather than recomputed
   * because it is somebody's decision, not a property of the picture.
   */
  framing?: CoverFraming | null;
  t: GroupTheme;
  onCancel: () => void;
  onCreated: (event: CreatedEvent) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  /*
   * The window, read off the photographs rather than asked for.
   *
   * `chosen` arrives from the picker, so first shutter to last is already known
   * — see `windowOf`. Null when nothing was chosen, which the server takes: an
   * album with no date is the common case, and a card dates itself by its
   * earliest photograph.
   */
  const span = useMemo(() => windowOf(chosen), [chosen]);
  /*
   * The cover is the first photograph chosen, and there is no second question.
   *
   * This used to be its own trip through `ImagePicker`: somebody picked the
   * album's photographs, then picked one of them again out of the whole camera
   * roll to lead it. The order of the selection on the page before already says
   * which one leads, which is what the numbered badges on those tiles mean.
   */
  const cover = chosen[0] ?? null;
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A name, and nothing else. The page before answered when, and whether there
  // are photographs at all is not this screen's business to insist on.
  const ready = Boolean(name.trim());
  /** Public unless the creator says otherwise — a forwarded link still works. */
  const [isPrivate, setIsPrivate] = useState(false);
  /**
   * Who gets asked, held until there is an album to ask them into.
   *
   * Nothing is sent from here: backing out of this form asks nobody, where a
   * picker that sent as it went would leave a trail of invitations to an event
   * that was never made. See `InvitePeople.tsx`.
   */
  const [invitees, setInvitees] = useState<InvitablePerson[]>([]);

  /**
   * One photograph, from the system picker.
   *
   * The system picker rather than the library reader that detection uses, and
   * deliberately: picking one image needs no permission at all on iOS, and
   * asking for the whole library to choose a cover would be the app requesting
   * everything in order to take one thing. Detection asks for that access when
   * it is what detection is for, and offers it after a contribution rather
   * than in front of one — design §7.4.
   */
  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * First shutter to last, from the photographs themselves.
       *
       * No padding and no rounding: this is not a phrase being resolved, it is
       * the span the chosen pictures actually cover. The date is the day the
       * first of them was taken, which is the evening somebody means.
       */
      const startsAt = span ? new Date(span.start).toISOString() : null;
      const endsAt = span ? new Date(span.end).toISOString() : null;
      const eventDate = span ? dayOf(new Date(span.start)) : undefined;

      const created = await api.createEvent({
        name: trimmed,
        place: place.trim() || undefined,
        groupId,
        eventDate,
        startsAt,
        endsAt,
        accessPolicy: isPrivate ? 'private' : 'public',
      });
      /*
       * Sent, not waited for.
       *
       * The share step is the most important moment in this product and the
       * one thing that must not be behind a progress bar — so the cover goes
       * up while the sheet is being read, on a background session that
       * survives the app being left. A failure leaves the event exactly as it
       * would have looked without a cover, which is why nothing here surfaces
       * one.
       */
      if (cover) {
        /*
         * Copied into our own sandbox first, like the photographs.
         *
         * `cover.uri` is the asset's own path inside the Photos container, and
         * the cover goes up on a background session exactly as a photograph
         * does — so it hit the same wall and for a while it was the half of this
         * I had missed:
         *
         *   Failed to issue sandbox extension for file
         *   file:///var/mobile/Media/DCIM/100APPLE/IMG_0891.PNG
         *
         * The profile's avatar upload needs none of this: it comes from the
         * system picker, which already hands back a copy in our own sandbox.
         */
        const target = api.coverTarget(created.id, framing);
        void sandboxCopy(cover.id)
          .then((local) => uploadCover(target.url, target.headers, local.uri))
          .catch(() => {});
      }

      /*
       * The invitations, sent and not waited for.
       *
       * Going to the album is the next thing that happens and it must not wait
       * on a round trip that is about somebody else's Events tab. A failure
       * costs the event nothing — it is made, and asking again is in its own
       * `⋯` sheet — which is why nothing here surfaces one.
       */
      if (invitees.length > 0) {
        void api
          .invite(
            created.id,
            invitees.map((person) => person.actorId),
          )
          .catch(() => {});
      }

      /*
       * Straight to the album, which is where somebody who pressed Post is
       * going. This is also what sends the photographs: the caller opens the
       * event with them, and it used to be reachable only by tapping through a
       * sheet about the link.
       */
      onCreated({
        id: created.id,
        name: created.name,
        linkToken: created.linkToken,
        startsAt,
        endsAt,
      });
    } catch {
      setError('Could not make the album. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, cover, framing, groupId, invitees, isPrivate, name, onCreated, place, span]);

  /*
   * No share sheet between posting and the album.
   *
   * Posting used to land on a page about the link — "Send it to everyone who
   * was there", the URL, a Copy button — with the album dimmed behind it, and
   * only a "Open it and add yours" link through to the thing just made. The
   * argument for it was that sending the link is the most important moment in
   * the product, which is true, and it was still the wrong place: somebody who
   * has just chosen photographs and pressed Post is going to the album.
   *
   * It was also the bug. `onCreated` fired from that link and nowhere else, so
   * the photographs chosen two screens earlier were not sent until somebody
   * tapped through the sheet — and anybody who swiped it away or pressed Copy
   * and went back got an album with nothing in it.
   *
   * The link has not gone anywhere: it is behind the album's own `⋯`, which is
   * where it lives for every other event and where somebody looks for it a day
   * later.
   */

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/*
        A modal header rather than a back chevron, and the commit action is in
        it as well as at the foot. Not duplication for its own sake: the
        detected runs make this screen long enough to scroll, and a button
        below the fold is a button someone has to go looking for.
      */}
      <View style={styles.headerRow}>
        <Pressable onPress={onCancel} accessibilityRole="button">
          <Text style={[styles.headerSide, { color: t.accent }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.fg }]}>
          {groupName ? `New in ${groupName}` : 'New album'}
        </Text>
        <Pressable
          onPress={create}
          disabled={ready === false || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: ready === false || busy }}
        >
          <Text
            style={[
              styles.headerSide,
              { color: ready ? t.accent : t.dim, opacity: ready ? 1 : 0.45 },
            ]}
          >
            Share
          </Text>
        </Pressable>
      </View>

      {/*
        First, because it is an answer rather than a question, and because the
        thing someone most often wants is the one that just happened. Renders
        nothing at all when there is no permission to ask about or the library
        has already been refused.
      */}
      {/*
        No detected-run card here any more.

        It offered "last night, 34 photos" as a shortcut to the thing the page
        before this one now does properly and by eye. Two ways to choose the
        same photographs on two consecutive screens is one way too many, and the
        one that shows you the pictures wins. `DetectedEvents` still exists and
        is still reached from the album itself, which is where somebody adds to
        an evening after the fact.
      */}

      {/*
        The album, before anything is said about it.

        Framed on the screen before and drawn here with the same two numbers, so
        this is the card — not a preview of one. It sits above the caption for
        the reason a caption sits under a photograph: the picture is the subject
        and the words are about it.
      */}
      {cover && (
        <View style={styles.coverRow}>
          <CoverFrame
            uri={cover.uri}
            framing={framing ?? CENTRED}
            width={width - 40}
          />
        </View>
      )}

      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: t.dim }]}>CAPTION</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sarah's birthday"
          placeholderTextColor={t.dim}
          // Deliberately not autoFocus. It was, when this screen opened on a
          // name field; now the detected runs are above it and a keyboard
          // covering them on arrival hides the one thing worth looking at.
          maxLength={120}
          style={[
            styles.input,
            styles.inputBig,
            { color: t.fg, borderColor: t.line, backgroundColor: t.card },
          ]}
        />
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={[styles.fieldLabel, { color: t.dim }]}>WHERE</Text>
          <Text style={[styles.small, { color: t.dim }]}>Optional</Text>
        </View>
        <TextInput
          value={place}
          onChangeText={setPlace}
          placeholder="Add a place"
          placeholderTextColor={t.dim}
          maxLength={80}
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.card }]}
        />
        {/*
          Places this person has used before, as one tap each. Drawn from
          their own events — there is no directory of places, and suggesting
          somewhere they have never been would be inventing a fact about them.
        */}
        {recentPlaces.length > 0 && (
          <View style={styles.pills}>
            {recentPlaces.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => setPlace(suggestion)}
                style={[styles.pill, { borderColor: t.line, backgroundColor: t.card }]}
              >
                <Text style={[styles.pillText, { color: t.fg }]}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={[styles.small, { color: t.dim }]}>
          Shows up under Find, by place. Never on the photos.
        </Text>
      </View>

      {/*
        No cover chooser here any more.

        It asked somebody to pick a leading photograph out of a library they had
        just picked photographs out of — the same act, twice, on two screens. The
        first one chosen on the page before is the cover, which is what the order
        of that selection is for.
      */}

      {/*
        No "when was it?" either.

        It existed so that everybody else's photographs from the right hours
        could be found for them later, and it was the wrong party to ask: a
        phrase like "last night" resolved to a six-hour box. The photographs
        chosen on the page before answer it exactly — first shutter to last — so
        the question is asked of the pictures instead of the person.

        An album made with nothing chosen has no window, which is an album with
        no date rather than an error: most have none, and a card dates itself by
        its earliest photograph.
      */}

      <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: t.dim, marginTop: 20 }]}>
            WHO IS IN IT
          </Text>
          {/*
            Above "who can see it" and not below it, because it is the answer
            for most private albums: the link is the other way in, and this is
            the one that does not depend on somebody forwarding anything.
          */}
          <InvitePicker api={api} t={t} picked={invitees} onChange={setInvitees} />

          <Text style={[styles.fieldLabel, { color: t.dim, marginTop: 20 }]}>
            WHO CAN SEE IT
          </Text>
          <View style={styles.pills}>
            {(
              [
                [false, 'Public'],
                [true, 'Private'],
              ] as [boolean, string][]
            ).map(([value, label]) => {
              const on = isPrivate === value;
              return (
                <Pressable
                  key={label}
                  onPress={() => setIsPrivate(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.pill,
                    on
                      ? { borderColor: t.accent, borderWidth: 1.5, backgroundColor: t.bg }
                      : { borderColor: t.line, backgroundColor: t.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      on && styles.pillTextOn,
                      { color: on ? t.accent : t.fg },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/*
            Said as what it costs rather than as the name of a policy. Nobody
            picking between two pills at a party is going to reason about an
            access policy — and there are two of them now, which is the whole
            reason this reads as a plain sentence either way.
          */}
          <Text style={[styles.small, { color: t.dim }]}>
            {isPrivate
              ? 'Only the people you add, and anyone you let in after they ask. A forwarded link opens nothing.'
              : 'Anyone can see it, no account needed. Adding photos always needs one.'}
          </Text>
      </View>

      {error && <Text style={[styles.body, { color: t.dim }]}>{error}</Text>}

      {/*
        "Post", and it says how many are going up with it.

        It was "Get a link", which described the sheet that follows rather than
        the act — and the sheet is still there, because sending the link is the
        moment that matters. But by the time somebody reaches this button they
        have chosen the photographs and named the evening, and what they are
        doing is posting it.

        A name is the only thing it waits for. An album with no photographs is a
        real thing — made before the evening, to hand the link out at it.
      */}
      <Button
        label={
          busy
            ? 'Posting…'
            : chosen.length > 0
              ? `Post ${chosen.length} ${chosen.length === 1 ? 'photo' : 'photos'}`
              : 'Post'
        }
        onPress={create}
        disabled={busy || !ready}
        t={t}
        primary
      />
      {busy && <ActivityIndicator color={t.accent} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingTop: 64, paddingBottom: 40, gap: 18 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerSide: { fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  /* Inset by the page's own 20, unlike the full-bleed window on the screen
     before: this one is inside a form, and a picture running to the glass in
     the middle of a column of fields reads as a different screen starting. */
  coverRow: { borderRadius: 14, overflow: 'hidden', marginBottom: 6 },
  field: { gap: 8 },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /* All-caps and small: a section marker, not the question. The question is
     the input under it, which is large enough to be the thing you read. */
  fieldLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  inputBig: { fontSize: 22, fontWeight: '700', borderRadius: 14, paddingVertical: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
});

