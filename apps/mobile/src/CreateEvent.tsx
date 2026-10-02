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
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Image as ExpoImage } from 'expo-image';

import { ContributeList } from './ContributeChoice';
import { CENTRED, CoverFramer, type CoverFraming } from './CoverFramer';
import { InviteFaces } from './InvitePeople';
import type { Api, ContributePolicy, InvitablePerson } from './api';
import type { GroupTheme } from './Groups';
import { windowOf, type LibraryPhoto } from './library';

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
   * The photographs are a second argument because this form can take them
   * away: the strip has a × on every tile, so what arrives is not always what
   * was chosen. `CreatedEvent` deliberately does not carry them — see the note
   * above it.
   *
   * `framing` is the third argument because the cover is not sent from here.
   * The album sends it once the photograph has an id.
   */
  onCreated: (event: CreatedEvent, photos: LibraryPhoto[], framing: CoverFraming) => void;
  Button: (props: {
    label: string;
    onPress: () => void;
    t: GroupTheme;
    primary?: boolean;
    disabled?: boolean;
  }) => React.ReactElement;
}) {
  const [name, setName] = useState('');
  /**
   * What is going in, which is not always what was chosen.
   *
   * The strip can take photographs out and can promote one to lead, so this
   * form owns the list rather than reading the picker's. The window is read off
   * it for the same reason: dropping the last four photographs of the night
   * moves when the album ends. Null when nothing was chosen, which the server
   * takes — an album with no date is the common case.
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
  /** The first photograph in the album leads it. That rule is not this screen's. */
  const cover = photos[0] ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Putting the field somebody is typing in above the keyboard.
   *
   * Measured rather than guessed. Each field reports its own offset inside the
   * scroll through `onLayout`, and focusing one scrolls to it less a margin.
   * `automaticallyAdjustKeyboardInsets` on the scroll is the other half: it is
   * what makes room to scroll into. Without it a field near the foot — the
   * invite card's search — has nowhere to go.
   */
  const scroller = useRef<ScrollView>(null);
  const fieldTops = useRef<Record<string, number>>({});

  const measureField = useCallback(
    (key: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
      fieldTops.current[key] = event.nativeEvent.layout.y;
    },
    [],
  );

  const bringIntoView = useCallback((key: string) => {
    const top = fieldTops.current[key];
    if (top === undefined) return;
    scroller.current?.scrollTo({ y: Math.max(top - 24, 0), animated: true });
  }, []);

  // A name, and nothing else. The page before answered when, and whether there
  // are photographs at all is not this screen's business to insist on.
  const ready = Boolean(name.trim());
  /** Public unless the creator says otherwise — a forwarded link still works. */
  const [isPrivate, setIsPrivate] = useState(false);
  /* Everyone, which is what an album is usually for. The other two are
     choices somebody makes on purpose. */
  const [contribute, setContribute] = useState<ContributePolicy>('everyone');
  /**
   * Who gets asked, held until there is an album to ask them into.
   *
   * Nothing is sent from here: backing out of this form asks nobody, where a
   * picker that sent as it went would leave a trail of invitations to an event
   * that was never made. See `InvitePeople.tsx`.
   *
   * Co-hosts are not asked for on this screen any more. "Hosts" here means the
   * creator until somebody is made one in the roll's own settings, which is
   * where that question is answered for every roll that already exists.
   */
  const [invitees, setInvitees] = useState<InvitablePerson[]>([]);

  /**
   * Asked once, on arrival, rather than waited for.
   *
   * The cover is the one thing on this screen everybody else sees, so the
   * frame comes up by itself. Cancelling is a real answer and costs nothing:
   * the first photograph leads, centred.
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
   * different photograph — keeping it would leave the cover showing something
   * nobody just chose.
   */
  const promote = useCallback((photo: LibraryPhoto) => {
    setPhotos((was) => [photo, ...was.filter((p) => p.id !== photo.id)]);
    setFraming(CENTRED);
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
        groupId,
        eventDate,
        startsAt,
        endsAt,
        accessPolicy: isPrivate ? 'private' : 'public',
        contributePolicy: contribute,
      });

      /*
       * The cover is not sent from here, and that is a bug fix: there was no
       * photograph id to name it by yet, so the server could not drop the
       * duplicate. The album sends it once the photograph has been presigned —
       * the framing travels with `onCreated`, and the picture is `photos[0]`.
       */

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
       * Straight to the album, which is where somebody who pressed the button
       * is going. This is also what sends the photographs: the caller opens the
       * event with them. The link is behind the album's own `⋯`.
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
        framing,
      );
    } catch {
      setError('Could not make the roll. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }, [api, contribute, framing, groupId, invitees, isPrivate, name, onCreated, photos, span]);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      {/*
        A modal header, and the commit action only at the foot: the screen is
        short enough now that the button is always on it.
      */}
      <View style={styles.headerRow}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.headerSide}>
          <Text style={[styles.headerSideText, { color: t.accent }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.fg }]}>
          {groupName ? `New in ${groupName}` : 'New roll'}
        </Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        ref={scroller}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        /*
         * Room under the last field for the keyboard to stand in. iOS insets
         * the scroll by the keyboard's height with this, which is what gives
         * `bringIntoView` somewhere to move to.
         */
        automaticallyAdjustKeyboardInsets
        // A tap on a pill while a field has focus should press the pill, not
        // spend itself dismissing the keyboard.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
               * goes through the same path the strip uses — which keeps "the
               * first one leads" true rather than making the cover a second,
               * separate fact that could disagree with the order.
               *
               * `promote` centres the framing, so the framing is set after it,
               * and this order is the whole of why it works.
               */
              const picked = id === cover.id ? null : photos.find((photo) => photo.id === id);
              if (picked) promote(picked);
              setFraming(next);
              setFramerOpen(false);
            }}
          />
        )}

        {/* The name, as the heading of the roll rather than a field in a box. */}
        <View style={styles.nameWrap} onLayout={measureField('name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name this roll"
            placeholderTextColor={t.dim}
            onFocus={() => bringIntoView('name')}
            maxLength={120}
            accessibilityLabel="Name this roll"
            style={[styles.name, { color: t.fg, borderBottomColor: t.line }]}
          />
        </View>

        {/*
          What is going in. Tapping one promotes it to the cover; tapping its ×
          takes it out.
        */}
        {photos.length > 0 && (
          <View style={styles.photosField}>
            <View style={styles.fieldHead}>
              <Text style={[styles.fieldLabel, { color: t.dim }]}>IN THIS ROLL</Text>
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
                    accessibilityLabel={index === 0 ? 'Cover photo' : 'Use this as the cover'}
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
                    Outside the picture's corner rather than on it: a × drawn
                    over a thumbnail is a × over somebody's face as often as not.
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

        <View style={styles.seeField}>
          <Text style={[styles.fieldLabel, { color: t.dim }]}>WHO CAN SEE IT</Text>
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
                    style={[styles.pillText, on && styles.pillTextOn, { color: on ? t.accent : t.fg }]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Said as what it costs rather than as the name of a policy. */}
          <Text style={[styles.small, { color: t.dim }]}>
            {isPrivate
              ? 'Only people you invite. A forwarded link opens nothing.'
              : 'Anyone with the link can see it, no account needed.'}
          </Text>
        </View>

        {/*
          Who can add to it — the same three answers the settings sheet offers,
          as a list here so each one's line can be read without tapping it.
        */}
        <View style={styles.addField}>
          <Text style={[styles.fieldLabel, { color: t.dim }]}>WHO CAN ADD PHOTOS</Text>
          <ContributeList
            t={t}
            value={contribute}
            /*
              The visibility chosen above, not a saved policy — there is no
              saved album yet. Tapping "Private" renames the first answer under
              the thumb rather than leaving a word that stopped being true.
            */
            accessPolicy={isPrivate ? 'private' : 'public'}
            onChange={setContribute}
          />
        </View>

        <View style={styles.inviteField} onLayout={measureField('invite')}>
          <InviteFaces
            api={api}
            t={t}
            picked={invitees}
            onChange={setInvitees}
            onSearchFocus={() => bringIntoView('invite')}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {error && <Text style={[styles.error, { color: t.dim }]}>{error}</Text>}
        {/* A name is the only thing it waits for. */}
        <Button
          label={busy ? 'Posting…' : 'Create roll'}
          onPress={create}
          disabled={busy || !ready}
          t={t}
          primary
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 64,
  },
  headerSide: { width: 60 },
  headerSideText: { fontSize: 16 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { paddingBottom: 20 },
  nameWrap: { paddingTop: 22 },
  name: { fontSize: 24, fontWeight: '700', paddingVertical: 10, borderBottomWidth: 1 },
  photosField: { paddingTop: 20, gap: 6 },
  strip: { paddingTop: 6, gap: 10 },
  /* Room above and right of each tile for the × to sit outside the picture. */
  cell: { paddingTop: 6, paddingRight: 6 },
  thumb: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden' },
  thumbShot: { width: '100%', height: '100%' },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeMark: { fontSize: 11, fontWeight: '700', lineHeight: 13 },
  seeField: { paddingTop: 24, gap: 8 },
  addField: { paddingTop: 22, gap: 10 },
  inviteField: { paddingTop: 22 },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /* All-caps and small: a section marker, not the question. */
  fieldLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  pillText: { fontSize: 15 },
  pillTextOn: { fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  footer: { paddingTop: 8, paddingBottom: 40, gap: 10 },
  error: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
