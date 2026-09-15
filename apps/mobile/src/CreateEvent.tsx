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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { Image as ExpoImage } from 'expo-image';

import { CENTRED, CoverFramer, coverAspect, type CoverFraming } from './CoverFramer';
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
  t: GroupTheme;
  onCancel: () => void;
  /**
   * The album, and what is actually going into it.
   *
   * The photographs are a second argument because this form can now take them
   * away: the row under the cover has a ⊗ on every tile, so what arrives is not
   * always what was chosen. `CreatedEvent` deliberately does not carry them —
   * see the note above it.
   */
  onCreated: (event: CreatedEvent, photos: LibraryPhoto[]) => void;
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
  /**
   * What is going in, which is not always what was chosen.
   *
   * The row under the cover can take photographs out and can promote one to
   * lead, so this form owns the list rather than reading the picker's. The
   * window is read off it for the same reason: dropping the last four
   * photographs of the night moves when the album ends.
   */
  const [photos, setPhotos] = useState<LibraryPhoto[]>(chosen);
  const span = useMemo(() => windowOf(photos), [photos]);
  /**
   * How the cover sits in the card.
   *
   * Two percentages rather than a cropped file: the original goes up untouched
   * and this is a fact about it, which is what lets somebody reframe later
   * without the picture having been through a lossy round trip in between.
   */
  const [framing, setFraming] = useState<CoverFraming>(CENTRED);
  const [framerOpen, setFramerOpen] = useState(false);
  /**
   * The cover's shape, measured off the picture as it draws.
   *
   * A cover takes its photograph's own shape now rather than a fixed letterbox,
   * and this screen has no way to know it until the image has decoded. Null
   * means "not yet", which draws the widest a cover may be — the shape every
   * cover used to be — and settles a moment later.
   */
  const [shape, setShape] = useState<{ w: number; h: number } | null>(null);
  /** The first photograph in the album leads it. That rule is not this screen's. */
  const cover = photos[0] ?? null;
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
   * Asked once, on arrival, rather than waited for.
   *
   * Framing behind a control is framing most people never find, and the cover
   * is the one thing on this screen everybody else sees — it is the album's
   * face on a home screen before anybody has read a word of it. So the frame
   * comes up by itself, the same way the album's photographs were asked for by
   * opening a picker rather than by offering a button.
   *
   * Cancelling is a real answer and costs nothing: the first photograph leads,
   * centred, which is exactly what the window below would have shown anyway.
   * The pill on the picture is how somebody comes back to it.
   *
   * The ref is set before the state change and never released, so React's pair
   * of development invocations opens one framer rather than two. `useUploads`
   * has the cautionary version of this — a flag cleared in the cleanup, which
   * made the two runs cancel each other out perfectly.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || chosen.length === 0) return;
    asked.current = true;
    setFramerOpen(true);
  }, [chosen.length]);

  /** Out of the album, and out of the window if it was leading it. */
  const drop = useCallback((photo: LibraryPhoto) => {
    setPhotos((was) => was.filter((p) => p.id !== photo.id));
  }, []);

  /**
   * This one leads, from now on.
   *
   * It clears an explicit framing, because that framing was a decision about a
   * different photograph — keeping it would leave the window showing something
   * nobody just chose.
   */
  const promote = useCallback((photo: LibraryPhoto) => {
    setPhotos((was) => [photo, ...was.filter((p) => p.id !== photo.id)]);
    setFraming(CENTRED);
    // Another picture, another shape — and the old framing was a decision about
    // the one being replaced.
    setShape(null);
  }, []);

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
         * The framing goes with it, and is never left to the server.
         *
         * The route's own default is `attention`, which crops towards whatever
         * sharp thinks the subject is. That is the better picture more often
         * than not and it is the wrong one here: this screen has shown somebody
         * a window and they accepted it. A preview that is not what gets stored
         * is worse than a slightly worse crop.
         */
        const target = api.coverTarget(created.id, framing);
        /*
         * Copied into our own sandbox first, like the photographs.
         *
         * A library asset's `uri` is its own path inside the Photos container,
         * and the cover goes up on a background session exactly as a photograph
         * does — so it hit the same wall, and for a while it was the half of
         * this I had missed:
         *
         *   Failed to issue sandbox extension for file
         *   file:///var/mobile/Media/DCIM/100APPLE/IMG_0891.PNG
         */
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
      onCreated(
        {
          id: created.id,
          name: created.name,
          linkToken: created.linkToken,
          startsAt,
          endsAt,
        },
        photos,
      );
    } catch {
      setError('Could not make the album. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [
    api,
    cover,
    framing,
    groupId,
    invitees,
    isPrivate,
    name,
    onCreated,
    photos,
    place,
    span,
  ]);

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

        The card's own shape, so this is the card rather than a preview of one,
        and it sits above the caption for the reason a caption sits under a
        photograph: the picture is the subject and the words are about it.

        Pressing it opens the system cropper — see `frameCover`. There was a
        page between the picker and this form that did the same job with a drag,
        and it was a whole step for something the operating system already does
        better.
      */}
      {cover && (
        <Pressable
          onPress={() => setFramerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change how the cover is framed"
          style={({ pressed }) => [styles.coverRow, { opacity: pressed ? 0.85 : 1 }]}
        >
          <ExpoImage
            source={{ uri: cover.uri }}
            style={{ width: width - 40, height: (width - 40) / coverAspect(shape) }}
            contentFit="cover"
            contentPosition={{ left: `${framing.x}%`, top: `${framing.y}%` }}
            transition={120}
            onLoad={(event) =>
              setShape({ w: event.source.width, h: event.source.height })
            }
          />
          <View style={[styles.coverDo, { backgroundColor: t.card }]}>
            <Text style={[styles.coverDoText, { color: t.fg }]}>Reframe</Text>
          </View>
        </Pressable>
      )}

      {framerOpen && cover && (
        <CoverFramer
          photos={photos}
          coverId={cover.id}
          initial={framing}
          t={t}
          onCancel={() => setFramerOpen(false)}
          onConfirm={(id, next) => {
            /*
             * A photograph tried in the frame and kept is a promotion, so it
             * goes through the same path the row below uses — which is what
             * keeps "the first one leads" true rather than making the cover a
             * second, separate fact that could disagree with the order.
             *
             * `promote` centres the framing, because it is about to be given a
             * picture it has no framing for. So the framing is set after it,
             * and this order is the whole of why it works.
             *
             * Skipped when the cover did not change, which is the common case:
             * it would reorder an array to the same order and re-measure a
             * shape that has not moved, for one visible flicker of the
             * preview.
             */
            const picked = id === cover.id ? null : photos.find((photo) => photo.id === id);
            if (picked) promote(picked);
            setFraming(next);
            setFramerOpen(false);
          }}
        />
      )}

      {/*
        What is going in, and the two things somebody wants to do to it here.

        Above the caption because it is about the photographs, and the caption
        is about the album they make. Tapping one promotes it to the front;
        tapping its ⊗ takes it out. Both used to live on a page of their own.
      */}
      {photos.length > 0 && (
        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={[styles.fieldLabel, { color: t.dim }]}>IN THIS ALBUM</Text>
            <Text style={[styles.small, { color: t.dim }]}>
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {photos.map((photo, index) => (
              <View key={photo.id} style={styles.cell}>
                <Pressable
                  onPress={() => promote(photo)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    index === 0 ? 'Cover photo' : 'Use this as the cover'
                  }
                  accessibilityState={{ selected: index === 0 }}
                  style={[
                    styles.thumb,
                    {
                      borderColor: index === 0 ? t.accent : 'transparent',
                      borderWidth: index === 0 ? 2 : 0,
                    },
                  ]}
                >
                  <ExpoImage
                    source={{ uri: photo.uri }}
                    style={styles.thumbShot}
                    contentFit="cover"
                    transition={100}
                  />
                </Pressable>
                {/*
                  Outside the picture's corner rather than on it: a ⊗ drawn over
                  a thumbnail is a ⊗ over somebody's face as often as not, and
                  the two controls have to be tellable apart by thumb.
                */}
                <Pressable
                  onPress={() => drop(photo)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                  style={[styles.remove, { backgroundColor: t.fg }]}
                >
                  <Text style={[styles.removeMark, { color: t.bg }]}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
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
  /* On the picture, bottom right, so the control is where the thing it acts on
     is — and small, because the picture is what this block is for. */
  coverDo: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  coverDoText: { fontSize: 13, fontWeight: '600' },
  strip: { paddingTop: 8, paddingRight: 28, gap: 14 },
  /* Room above and right of each tile for the ⊗ to sit outside the picture. */
  cell: { paddingTop: 8, paddingRight: 8 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  thumbShot: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeMark: { fontSize: 14, fontWeight: '700', lineHeight: 16 },
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

