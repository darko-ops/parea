/**
 * Three of the four tabs' contents: home, groups and find. You is its own file.
 *
 * ## One word for one thing, and the word is "album"
 *
 * It was "event", and the rule was that the product should say whatever the
 * schema says — because a second word costs a paragraph of explanation in every
 * file that touches it, and buys nothing.
 *
 * The rule holds; the word was wrong. "Event" is what the row is called and
 * what somebody making this thinks about. "Album" is what the row *is* to
 * everybody else: a set of photographs from one evening. Nobody outside this
 * repository has ever called it an event, and the interface was quietly asking
 * people to learn the database's vocabulary.
 *
 * So the split is deliberate and it is the only one: the schema, the routes and
 * the types say `event`, top to bottom, and every word a person reads says
 * album. Renaming the tables and the URLs to match would be a migration, a set
 * of dead links in everybody's messages, and no improvement to anything anybody
 * sees.
 *
 * All three read from `GET /api/events`, which lists what this actor can
 * actually reach: albums they have presented a credential to, plus every album
 * in a group they belong to. Not "everything a link would still open" — a link
 * is something you were sent, not somewhere you live, and an album opened once
 * a year ago does not belong on a home screen.
 */

import { ago, dateLabel, CARD_FACES, isLive } from '@parea/cards';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';

import { ApiError } from './api';
import type {
  Api,
  Cluster,
  ClusterPerson,
  EventListing,
  GroupKind,
  InvitablePerson,
  SuggestedPerson,
  MyGroupDetail,
  ThreadLine,
} from './api';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ClusterCard } from './CreateGroup';
import { Glyph } from './Glyph';
import { Notifications, PageHead } from './PageHead';
import { ROUND, RoundButton } from './RoundButton';
import { StartSomething } from './StartSomething';
import { Wordmark } from './Wordmark';
import type { GroupTheme } from './Groups';
import { BELOW_TABS } from './chrome';
import { initialOf, lensFor } from './lens';
import {
  forgetSearches,
  loadQueue,
  loadSearches,
  rememberSearch,
  saveActorToken,
  signOutDevice,
} from './platform';
import { DevicesCard } from './Devices';
import { passkeysSupported } from './passkeys';
import { addPasskey, signInWithPasskey } from './signin';
import { Waiting } from './Waiting';

export type TabTheme = GroupTheme;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One event, led by the photograph it was given.
 *
 * The same card the web draws, and it took the same route to get here: a
 * mosaic of the four most recent photos over a strip whose background was
 * those same photos again, mirrored and blurred, under a scrim. Handsome, and
 * it made a wall of evenings look like a wall of listings — four thumbnails
 * too small to recognise anybody in, plus a panel of chrome around them.
 *
 * What replaced them is one picture and the people. A tall cover, the faces of
 * whoever was there overlapping its bottom edge. No border, no card: the
 * photograph *is* the card.
 *
 * The faces overlap on purpose. A row of circles floating below a picture
 * reads as metadata; the same row half over it reads as who was there, which
 * is how somebody actually recognises an evening.
 *
 * ## What sits above the photograph, and what sits below it
 *
 * The words moved. They were two lines under the cover — the host's name run
 * into the album's title, then the date — which made a column of cards you had
 * to scroll past to find out what any of them were. Above the picture now, and
 * in the order somebody reads them:
 *
 *   1. A rule line. The date and the photograph count, monospaced and
 *      upper-cased, with a hairline running from where the words stop to the
 *      edge of the column. The label on the outside of the box; it is what
 *      gives every card the same top edge whatever its date's length.
 *   2. The title, at 24 points. The name of an evening is how somebody
 *      recognises it, and on a screen of covers from four different holidays
 *      it is the only thing that tells them apart at a glance.
 *   3. The byline: the creator's face and handle, pressable, and — only while
 *      somebody is still adding to it — how long ago the last picture landed.
 *      No count of people: the circles over the cover are the people, drawn as
 *      their faces, which is the version of that fact somebody reads.
 *
 * The name spent a while in the bottom-right corner of the cover instead, on
 * the reasoning that a name belongs on the thing it names. What that cost was
 * the card's reading order: a name in the corner of a photograph is found
 * after the photograph, and the point of a name on a wall of evenings is to be
 * read on the way past. The cover is a photograph with nothing over it again.
 *
 * Under the photograph, after the faces, is the sheet: the next three
 * photographs inside, in a row, ending in a tile saying how many more there
 * are. It answers "is this worth opening" without a request. Three because the
 * row does not scroll — it sits inside the vertical scroll that is the home
 * page, and two scrollers competing for one drag means the page sometimes does
 * not move when somebody flicks it — and a row rather than a block, because a
 * block of thumbnails under a cover is the mosaic this card was rewritten to
 * get away from.
 *
 * Each of the three opens the photograph it is a picture of; the count tile
 * and the rest of the card open the album itself.
 *
 * There is no live chip. A coloured dot and the word beside it is the loudest
 * thing on a card whose subject is somebody else's photograph, and the byline
 * says the same thing in words the reader was going to read anyway.
 *
 * `ago`, `dateLabel`, `isLive` and `CARD_FACES` come from `@parea/cards`. The
 * words around them are this file's, and what is shared is the part that could
 * ever disagree: two clients rounding "2 days ago" separately drift, and
 * nothing fails when they do.
 */
/**
 * The shapes a cover may be drawn at, as width over height.
 *
 * The same two bounds the encoder applies — `COVER_WIDEST` and `COVER_TALLEST`
 * in `apps/web/src/cover.ts` — restated here rather than shared, because the
 * only package both clients and the server can import is `@parea/cards` and
 * this is a fact about storage rather than about a card. Clamped again on this
 * side on purpose: the number comes off the wire, and one bad row should cost
 * a card its shape rather than cost the screen its layout.
 */
const WIDEST = 3 / 2;
const TALLEST = 4 / 5;

/**
 * The strip under a cover: how many tiles wide, and the hairline between them.
 *
 * Four slots — three photographs and the count — and the gap is the album's
 * own `PHOTO_GAP`. Restated here rather than imported from `App.tsx`, which
 * imports this file: the number is 3 in both places because a strip of an
 * album's contents should be spaced like the album it opens.
 */
const SHEET_TILES = 4;
const SHEET_GAP = 3;

/**
 * How large one of those tiles is, on a screen this wide.
 *
 * Measured rather than left to `flex: 1`, which was the first attempt and is
 * wrong for a row whose length varies: an album with four photographs in it
 * has two tiles and no count, and equal flex would draw those two half a
 * screen tall each. A card's strip has to be the same height on every card or
 * a column of them stops scanning.
 */
const sheetTile = (width: number) => (width - SHEET_GAP * (SHEET_TILES - 1)) / SHEET_TILES;

/**
 * The wash behind the "+N" on the end of a card's strip: the app icon's field.
 *
 * It was `card` over `line` — white on a white page, and in the dark scheme a
 * dark grey square, which is what a photograph looks like when it has failed
 * to load. The one tile in the row that is not a photograph was reading as the
 * one that had broken. What replaced that was the mark's three pastels poured
 * into the square, and pastels are what this is not any more: mint under pink
 * under pale blue reads as a washed-out photograph rather than as the product,
 * which is the same failure one step along. A tile that is deliberately not a
 * picture has to be unmistakably not a picture.
 *
 * So it is the icon's own background instead — the field `build-icon.mjs`
 * paints behind the mark, which is the one surface in the product that is pure
 * brand and is already on the reader's home screen. Deep blue through violet
 * to teal, saturated rather than tinted. Somebody who has the app installed
 * has seen this square every day; the count now sits on the thing they tapped
 * to get here.
 *
 * The six blooms are the icon's stop for stop — every colour, every offset and
 * every opacity as `GRADIENTS` in that script has them, pinned by the test.
 * What is restated rather than copied is where they sit: centres and radii are
 * the icon's rescaled to a unit square and then pushed outward, because the
 * icon has the white mark in the middle and this has a number there. Verbatim,
 * the teal reaches in from the lower right far enough to put white at 2.3:1
 * over part of the digits. Pushing each bloom toward its own edge and pulling
 * the radii in leaves the same six lights in the same six places — pink above,
 * violet upper left, blue down the left, aqua at the foot, teal to the right —
 * while the middle stays the deep blue the base already is: 5.9:1 across the
 * band the digits actually occupy, and the corners as bright as the icon's.
 *
 * Alpha on the stops here, unlike the mark. The mark's regions are flat
 * colours that must not blend; a field is the opposite — these are lights on
 * a wall, and each one fading to nothing over its own colour is what makes
 * them read as one surface rather than six discs.
 */
const GLASS_BASE = '#173EA8';

type Bloom = {
  id: string;
  cx: number;
  cy: number;
  r: number;
  /** offset, colour, opacity — four stops, the icon's own. */
  stops: [number, string, number][];
};

const GLASS_BLOOMS: Bloom[] = [
  {
    id: 'pink',
    cx: 0.74,
    cy: 0.02,
    r: 0.62,
    stops: [
      [0, '#F79AB6', 1],
      [0.34, '#EB78A0', 0.92],
      [0.68, '#D86196', 0.42],
      [1, '#D86196', 0],
    ],
  },
  {
    id: 'violet',
    cx: 0.08,
    cy: 0.12,
    r: 0.5,
    stops: [
      [0, '#8F46DA', 0.78],
      [0.36, '#7B39C8', 0.5],
      [0.72, '#6E35BE', 0.12],
      [1, '#6E35BE', 0],
    ],
  },
  {
    id: 'blue',
    cx: 0.04,
    cy: 0.82,
    r: 0.66,
    stops: [
      [0, '#1337B7', 1],
      [0.36, '#1945C6', 0.96],
      [0.7, '#1D49C9', 0.42],
      [1, '#1D49C9', 0],
    ],
  },
  {
    id: 'aqua',
    cx: 0.52,
    cy: 1.06,
    r: 0.44,
    stops: [
      [0, '#25BCE6', 0.92],
      [0.38, '#21AEDD', 0.68],
      [0.72, '#1E9FD5', 0.18],
      [1, '#1E9FD5', 0],
    ],
  },
  /*
   * The seam, where the pink hands over to the teal, and it is a second
   * placement of a colour already in the set rather than a new one: pink and
   * teal are 170° apart, so alpha compositing averages them toward grey. The
   * violet's own second stop sits between the two on the wheel, which takes
   * the handover the short way round instead of straight across the middle.
   * The icon's reasoning, and the reason it is not simply dropped here.
   */
  {
    id: 'seam',
    cx: 1.02,
    cy: 0.28,
    r: 0.5,
    stops: [
      [0, '#7D37CC', 0.62],
      [0.45, '#7D37CC', 0.5],
      /* Three, where the others have four: a gradient holds its last stop out
         to the edge, so the fade is already over by 86%. The icon's own. */
      [0.86, '#7D37CC', 0],
    ],
  },
  {
    id: 'teal',
    cx: 1.06,
    cy: 0.78,
    r: 0.56,
    stops: [
      [0, '#66E7C6', 0.95],
      [0.34, '#46D8C1', 0.84],
      [0.7, '#39CDBD', 0.34],
      [1, '#39CDBD', 0],
    ],
  },
];

function SheetGlass() {
  /*
   * Ids unique to this instance, for exactly the reason `Mark` does the same:
   * `react-native-svg` resolves paint references against a registry that is
   * not per-`Svg` on every platform, so several of these mounted at once — one
   * per card, on a scrolling list — can end up painting with each other's
   * gradients.
   */
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        {GLASS_BLOOMS.map((bloom) => (
          <RadialGradient
            key={bloom.id}
            id={`${id}${bloom.id}`}
            cx={`${bloom.cx * 100}%`}
            cy={`${bloom.cy * 100}%`}
            r={`${bloom.r * 100}%`}
          >
            {bloom.stops.map(([offset, colour, opacity]) => (
              <Stop
                key={offset}
                offset={`${offset * 100}%`}
                stopColor={colour}
                stopOpacity={opacity}
              />
            ))}
          </RadialGradient>
        ))}
      </Defs>
      {/* The base is the ground rather than a seventh bloom, exactly as the
          icon has it: six fades over nothing leave the corners empty, and an
          empty corner on a tile in a row of photographs is the broken-image
          look this replaced. */}
      <Rect width="100%" height="100%" fill={GLASS_BASE} />
      {GLASS_BLOOMS.map((bloom) => (
        <Rect key={bloom.id} width="100%" height="100%" fill={`url(#${id}${bloom.id})`} />
      ))}
    </Svg>
  );
}

/** How tall to draw a full-bleed cover of this shape. */
function coverHeight(event: { coverAspect?: number | null }, width: number): number {
  const aspect = event.coverAspect;
  // Null is a cover from before the shape was recorded, or a photograph
  // standing in for one. Both are the old letterbox, which is what 3:2 is.
  if (!aspect || !Number.isFinite(aspect)) return width / WIDEST;
  return width / Math.min(WIDEST, Math.max(TALLEST, aspect));
}

function EventCard({
  event,
  now,
  t,
  onOpen,
  onOpenPerson,
}: {
  event: EventListing;
  /** One clock for every card on screen, so none disagree about the minute. */
  now: Date;
  t: TabTheme;
  /**
   * Open the album, at a photograph or at the top of it.
   *
   * One callback rather than two, because the card has three things that open
   * it and only one of them is about a particular picture: the card itself and
   * the "+N" tile land on the grid, and a tile in the strip lands on the
   * photograph it is a picture of.
   */
  /**
   * Open the album — at a photograph, or on one of its panes.
   *
   * The third argument is what the line under the strip needs: a comment on
   * the card is a pointer at a conversation, and pressing it should land in
   * the conversation rather than at the top of the album with the reader left
   * to find the tab.
   */
  onOpen: (photo?: string, pane?: 'photos' | 'talk' | 'people') => void;
  /**
   * The byline, which is a person and should behave like one.
   *
   * Null for somebody with no handle — a guest who arrived by link has a name
   * and a face here and no profile to open, so the row stays a label rather
   * than becoming a control that does nothing.
   */
  onOpenPerson: (handle: string) => void;
}) {
  const label = `${event.name}, ${plural(event.photoCount, 'photo')}`;

  /*
   * Nothing in it is a different card, not this card with the picture missing.
   *
   * What it has to do is get the first photograph out of somebody, so it is
   * mostly a button, and the lens cluster is the argument for pressing it: two
   * circles filled and the third one dashed and empty, the empty one being
   * you.
   *
   * On the photograph count rather than on the cover. An event can have a
   * cover and nothing in it yet — the host chose a picture before anybody
   * added one — and leading with it would replace the only card in the product
   * whose job is to ask with a card that says nothing.
   */
  /*
   * Above the empty-album return below, because a card that gains its first
   * photograph re-renders in place — and a hook that only runs on the second
   * of those two renders is one React refuses outright.
   */
  const { width } = useWindowDimensions();
  /*
   * For the press wash at the foot of the card, which is the one colour here
   * the theme does not carry: `t` has the six it paints with, and this is a
   * translucent film over whatever it lands on rather than one of them.
   */
  const dark = useColorScheme() === 'dark';

  if (event.photoCount === 0) {
    return (
      <Pressable
        onPress={() => onOpen()}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.empty, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eventName, { color: t.fg }]} numberOfLines={1}>
            {event.name}
          </Text>
          {event.caption && (
            <Text style={[styles.small, { color: t.dim }]} numberOfLines={1}>
              {event.caption}
            </Text>
          )}
          <Text style={[styles.body, { color: t.dim }]}>{emptyLine(event.memberCount)}</Text>
        </View>

        <View style={styles.emptyLenses} pointerEvents="none">
          <View style={[styles.emptyLens, { backgroundColor: EMPTY_LENSES[0] }]} />
          <View style={[styles.emptyLens, { backgroundColor: EMPTY_LENSES[1] }]} />
          <View style={[styles.emptyLens, styles.emptySlot, { borderColor: t.accent }]}>
            <Text style={[styles.emptySlotMark, { color: t.accent }]}>＋</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const live = isLive(event.lastActiveAt, now);
  /*
   * The circles are everybody the host shared it with, and no longer the host.
   *
   * They are named and pictured in the byline directly above, so the first
   * circle was the same person twice on one card — and on your own evenings it
   * was your own face, over a photograph you took, on a wall of your own
   * events.
   *
   * Filtered rather than sliced off the front. The server orders the host
   * first, so dropping `[0]` would look identical right up until an event
   * whose creator never turned up to it — at which point the card would
   * quietly stop showing a real guest.
   */
  const others = event.faces.filter((face) => !face.isCreator);
  const faces = others.slice(0, CARD_FACES);
  /*
   * Everybody no circle shows — and not the host either, who has the byline.
   *
   * `memberCount` counts the host when they are in their own event, which is
   * usually but not always. Rather than assume, subtract them only when the
   * face rows actually held one.
   */
  const hostCounted = event.faces.length > others.length ? 1 : 0;
  const moreFaces = Math.max(0, event.memberCount - hostCounted - faces.length);
  /*
   * When it was posted, not when the photographs were taken.
   *
   * This read `eventDate ?? startsAt ?? firstPhotoAt`, and the last of those
   * is `min(captured_at)` — so a card for an album posted yesterday out of a
   * roll from 2019 was dated 2019. On a screen ordered by recent activity,
   * where the album above it says yesterday, that is not a subtle error: it
   * reads as the list being out of order.
   *
   * The evening's own date has not gone anywhere — it is on the album, and
   * the profile still shelves albums by it. It is the wrong answer *here*,
   * because this card is a thing in a feed and a feed is dated by when things
   * arrived in it.
   */
  const date = dateLabel(event.createdAt);

  /*
   * The rule line's left end: when it was, and how much of it there is.
   *
   * Both facts are the same *kind* of fact — measurements of the album rather
   * than things about the people in it — which is why they share a line and
   * why that line is set in a monospaced face. It reads as a caption on an
   * archive box, and the eye skips it until it wants it, which is the correct
   * priority for a date on a wall of photographs.
   */
  const measured = [date, plural(event.photoCount, 'photo')].filter(Boolean).join(' · ');

  /*
   * When something last arrived — the one thing nothing else on the card says.
   *
   * Drawn in the corner of the cover rather than beside the handle, and the
   * words shrank when it moved. "added to 41 min ago" was a sentence because
   * it sat in a column of sentences and had to say which album it was about; a
   * mark on a photograph is about that photograph, so what is left is the
   * time.
   *
   * Only while it is true. An evening from March does not need telling you it
   * has stopped, so on most cards there is no mark at all and the cover is a
   * cover — which is the reason this can sit on the picture without becoming
   * furniture. The byline is a handle on its own again, which is what a byline
   * is.
   *
   * The old objection to a chip stands and this answers it: a coloured dot and
   * the word "live" beside it is the loudest thing on a card whose subject is
   * somebody else's photograph. This is the photograph's own colours behind
   * two words of its own size — see `coverMark`.
   */
  const about = live ? ago(new Date(event.lastActiveAt), now) : '';

  /*
   * The sheet: a strip of what is actually inside, under the cover.
   *
   * The card led with one photograph and stopped, which asks somebody to open
   * an album to find out whether it is worth opening. Four thumbnails answer
   * that without a request — not as a mosaic, which is the arrangement this
   * card was built to get away from, but as a strip below the cover that reads
   * as contents rather than as a second, smaller cover.
   *
   * `slice(1, 4)` because the first entry of `mosaic` is always the picture the
   * card is already leading with — the server prepends a chosen cover to it,
   * and where there is none the lead is `mosaic[0]` drawn larger — and because
   * three is as many as the row holds.
   *
   * Three and not four. The row does not scroll (see below), so its width is
   * the screen's and every tile it adds makes all of them smaller; four
   * photographs plus the count tile is five things across a phone, at which
   * point none of them is large enough to recognise anybody in and the strip
   * stops doing the one job it has.
   */
  /*
   * And nothing at all under an album of one photograph.
   *
   * `slice(1, …)` skips the entry the card is leading with, which is enough
   * when that entry is a photograph. It is not enough when it is a chosen
   * cover: the cover is its own object, so the photograph it was cropped out
   * of is still in the list behind it, and an album of one showed that one
   * picture as the cover and again as the only thumbnail.
   *
   * The server drops that photograph now, where it knows which one it was —
   * see the mosaic in `api/events/route.ts`. It does not always know. Covers
   * set before `coverPhotoId` existed have none recorded, and a cover uploaded
   * on its own never had a photograph behind it to record. So this is the
   * floor: one photograph is a card with one picture on it, whatever the cover
   * bookkeeping says.
   */
  const sheet = event.photoCount <= 1 ? [] : event.mosaic.slice(1, 4);
  /*
   * And how many photographs are not on the card at all.
   *
   * Four are: the cover and the three in the strip. Counting only the strip
   * would say "+4 more" about an album of seven while showing four of them,
   * which is the sort of arithmetic a reader does by eye and catches.
   *
   * The cover counts even when it is a chosen one — a separate object with no
   * photograph row behind it, so strictly it is not one of the `photoCount`.
   * In practice a host crops a cover out of a picture that is also in the
   * album, so the reader sees it twice and counts it once, and being right
   * about the object model here would read as an off-by-one.
   */
  const rest = Math.max(0, event.photoCount - 1 - sheet.length);

  /**
   * The counts at the foot of the card, or an empty string.
   *
   * A measurement of the album, in the same words and the same face as the
   * date and the photograph count at its head — so a card opens and closes on
   * a line of the same kind, and what is between them is the evening.
   *
   * The total, the shown comment included. It used to be "and the rest": the
   * one comment on screen was subtracted and the line read `+ 3 comments`,
   * which is a remark about the quote above it rather than about the album.
   * "4 COMMENTS" is not about the quote at all — it is how much conversation
   * this album has, the way "48 PHOTOS" is how many photographs, and a reader
   * who counts the one they can see and gets four is reading it correctly.
   *
   * Empty rather than null when there is nothing to count, because the reply
   * row above it can still be there — see the block below for the three
   * states this makes.
   *
   * Not a hook, deliberately. The empty-album return is above this, and a
   * hook below an early return is one React refuses outright — see the note
   * on `useWindowDimensions`.
   */
  const comments = event.messageCount;
  const reactions = event.reactionCount;
  const counted = [
    comments === 0 ? null : plural(comments, 'comment'),
    reactions === 0 ? null : plural(reactions, 'reaction'),
  ]
    .filter(Boolean)
    .join(' · ');
  /*
   * The colour of the person who said the last thing, for the days they have
   * no picture. Keyed on what the server sends rather than on their name —
   * see `authorKey` on the listing.
   */
  const saidLens = lensFor(event.lastMessage?.authorKey ?? event.id);
  const tile = sheetTile(width);

  /*
   * Whose evening this is, above the photograph rather than under it.
   *
   * The handle rather than the display name: it is the half of somebody that
   * is unique and the half they can be found by, and a wall of evenings is
   * exactly where two people called Ana need telling apart. The name still
   * appears in the line under the title — this row is the byline, that line is
   * the sentence.
   *
   * Written without the `@`. The sigil is what tells a handle from a name when
   * the two sit together in a sentence, and nothing here is a sentence: it is
   * a face and the word beside it, which is a byline, and a byline reads as a
   * name whether or not it is punctuated like one.
   *
   * Never a silhouette where there is no picture, which is the rule every
   * other face in this product follows: a letter on the person's own lens
   * colour, hashed from their handle so it is theirs and stays theirs.
   */
  const by = event.creator.handle ?? event.creator.name ?? 'Someone';
  const byLens = lensFor(event.creator.handle ?? event.creator.name ?? event.id);

  return (
    <Pressable onPress={() => onOpen()} accessibilityRole="button" accessibilityLabel={label}>
      {/*
        The measurements, and a rule running off to the edge of the column.

        A hairline that starts where the words stop is what makes a stack of
        these read as entries in a ledger rather than as a feed: it gives every
        card the same top edge whatever length its date happens to be, and it
        does it without drawing a box round anything.

        `aria-hidden` in spirit — the same two facts are in the card's own
        accessible name, and a screen reader that stops on this line reads the
        photograph count twice on the way past.
      */}
      <View style={styles.measured} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.measuredText, { color: t.dim }]} numberOfLines={1}>
          {measured}
        </Text>
        <View style={[styles.rule, { backgroundColor: t.line }]} />
      </View>

      {/*
        The album's name, above the byline and below the rule.

        It has now been in three places, and this is the second time in this
        one. Under the cover at 18 points made a wall of pictures you had to
        scroll past to find out what any of them were. On the cover at 24 put
        the name where the thing it names is — and cost the card its reading
        order, because a name in the corner of a photograph is found after the
        photograph rather than before it, and the point of a name on a wall of
        evenings is to be read on the way past.

        So it is a headline in the column again: the measurements, the name,
        then whose evening it was.

        Two lines rather than one. "Sunday lunch at the Kostas'" is a real name
        people give albums, and truncating at the first line loses exactly the
        end that distinguishes it.
      */}
      <Text style={[styles.cardTitle, { color: t.fg }]} numberOfLines={2}>
        {event.name}
      </Text>

      {/*
        The byline goes to the person, not to the album.

        A face and a name at the top of a card is the one thing on this screen
        that is about somebody rather than about an evening, and it was the only
        such thing in the product that could not be pressed. Nested inside the
        card's own `Pressable`, which is what makes it work: the inner one takes
        the touch when it is on the byline and the outer one takes everything
        else, so the whole card still opens the album.

        Only when there is a handle to open. A guest who arrived by link has a
        name and a face and no profile, and a control that does nothing is worse
        than a label that never promised to.
      */}
      <View style={styles.byline}>
        {/*
          Only the face and the name open the person.

          The row carries a sentence about the album beside them now — how many
          people, and whether anything is still arriving — and a control that
          stretches under that sentence sends somebody to a profile they were
          not reaching for. So the touch target is the two things that are
          actually about a person, and the rest of the row belongs to the card.
        */}
        <Pressable
          onPress={
            event.creator.handle
              ? () => onOpenPerson(event.creator.handle!)
              : undefined
          }
          disabled={!event.creator.handle}
          accessibilityRole={event.creator.handle ? 'button' : 'text'}
          accessibilityLabel={event.creator.handle ? `${by}, see their profile` : by}
          style={styles.bylineWho}
        >
          {event.creator.avatarUrl ? (
            <Image
              source={{ uri: event.creator.avatarUrl }}
              style={[styles.bylineFace, { backgroundColor: t.line }]}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={[styles.bylineFace, styles.bylineBlank, { backgroundColor: byLens.fill }]}>
              <Text style={[styles.bylineLetter, { color: byLens.ink }]}>
                {initialOf(event.creator.name ?? event.creator.handle)}
              </Text>
            </View>
          )}
          <Text style={[styles.bylineName, { color: t.fg }]} numberOfLines={1}>
            {by}
          </Text>
        </Pressable>

      </View>

      {/*
        As tall as the picture is, within bounds.

        Every cover used to be drawn 260 high whatever it was, which is a
        landscape crop of a portrait photograph on a screen whose whole width
        was going spare — a shelf of short wide crops of tall narrow evenings.
        The shape comes down with the listing rather than being measured here,
        because a list that lays itself out again as each cover loads is a list
        that jumps under a thumb.
      */}
      <View style={[styles.cover, { height: coverHeight(event, width) }]}>
        {event.cover && (
          <Image
            source={{ uri: event.cover.src }}
            style={styles.coverShot}
            contentFit="cover"
            transition={120}
          />
        )}

        {/*
          The mark, in the corner of the thing it is about.

          Top right rather than bottom: the circles come over the picture's
          bottom edge and the cover's own bottom half is where a photograph
          usually has its subject, a table or a face. The top right corner of a
          snapshot is sky, wall or ceiling about as often as not, and it is the
          corner nothing else on this card uses.

          Behind glass, for the reason the album header is — see the note at
          the top of `CoverGlass.tsx`. A flat dark chip is the cheap version
          and it puts the same grey lozenge on every card; this takes the
          photograph behind it and blurs it, so the mark is made of that
          picture. `systemUltraThinMaterialDark` is the thinnest material that
          darkens: `dark` washes what is behind it grey, which is the one thing
          this must not do.

          The tint underneath is not a fallback for the blur — it is what the
          white text is legible against on a cover that is a bright sky, and it
          also carries the whole job on an Android build where the blur does
          not land.

          `pointerEvents="none"` because the card is one press. A view over the
          cover that ate touches would make a small dead patch in the corner of
          the one control on the row.
        */}
        {about !== '' && (
          <View style={styles.coverMark} pointerEvents="none">
            <BlurView
              intensity={26}
              tint="systemUltraThinMaterialDark"
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.coverMarkText}>{about}</Text>
          </View>
        )}
      </View>

      {faces.length > 0 && (
        <View style={styles.faces}>
          {faces.map((face, i) => (
            <View
              key={`${face.actorId}-${i}`}
              style={[styles.face, { borderColor: t.bg, backgroundColor: t.line }]}
            >
              {face.avatarUrl ? (
                <Image
                  source={{ uri: face.avatarUrl }}
                  style={styles.faceShot}
                  contentFit="cover"
                />
              ) : (
                <Text style={[styles.faceLetter, { color: t.dim }]}>
                  {(face.name || '?').replace(/^@/, '').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
          ))}
          {moreFaces > 0 && (
            <View style={[styles.face, styles.faceMore, { borderColor: t.bg, backgroundColor: t.line }]}>
              <Text style={[styles.faceLetter, { color: t.dim }]}>+{moreFaces}</Text>
            </View>
          )}
        </View>
      )}

      {sheet.length > 0 && (
        /*
          What is inside, as a row of three under the cover.

          A fixed row and not a scroller. It was a horizontal `ScrollView`,
          which is wrong on this screen for a reason that has nothing to do
          with how it looks: it sits inside the vertical scroll that is the
          home page, and a horizontal gesture that starts on a photograph is
          within a few degrees of the vertical one that moves the page. Two
          scrollers competing for the same drag means the page sometimes does
          not move when somebody flicks it, which is the least forgivable
          failure a feed can have.

          So the row shows what fits and says the rest as a number. Each tile
          takes an equal quarter and is square, which lets the strip meet the
          screen's edges the way the cover above it does rather than stopping
          short at a fixed 76 points.

          Not a grid. A block of thumbnails under a cover is the mosaic this
          card was rewritten to get away from — it turns a photograph into a
          listing, and it claims the same height whether or not there is
          anything worth claiming it for.
        */
        <View style={styles.sheet}>
          {sheet.map((photo) => (
            /*
              Straight to that photograph, not to the top of the album.

              The tile is a picture of a specific thing and pressing a picture
              of a specific thing should arrive at it — landing on the grid
              instead asks somebody to find again what they had already found
              and pointed at. `id` is never null here: only `mosaic[0]` can be
              a chosen cover, and the strip starts at the second.
            */
            <Pressable
              key={photo.id}
              style={{ width: tile, height: tile }}
              onPress={() => onOpen(photo.id!)}
              accessibilityRole="button"
              accessibilityLabel={`A photograph in ${event.name}`}
            >
              <Image
                source={{ uri: photo.src }}
                style={[styles.sheetShot, { backgroundColor: t.line }]}
                contentFit="cover"
                transition={120}
              />
            </Pressable>
          ))}
          {rest > 0 && (
            /*
              And the tile on the end opens the album itself, which is the
              grid: it is the one control on the card that is about the
              photographs it is *not* showing, so it goes where they all are.
            */
            <Pressable
              style={{ width: tile, height: tile }}
              onPress={() => onOpen()}
              accessibilityRole="button"
              accessibilityLabel={`${plural(rest, 'more photo')} in ${event.name}`}
            >
              <View style={styles.sheetRest}>
                <SheetGlass />
                <Text style={styles.sheetRestText}>+{rest}</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      {/*
        What has been said, under the photographs it was said about.

        The card showed what an album holds and nothing about what happened in
        it, so an evening five people had talked over read exactly like one
        nobody had opened. One line of somebody's words does more to say an
        album is alive than any count of them.

        Two things, and they come and go independently: the newest reply, and
        a line of counts that closes the card. A reply with nobody's reactions
        under it is the first alone; an album somebody has only reacted in is
        the second alone; an album nobody has touched draws neither and ends
        on the photographs, which is most of them and is the point — a count
        of zero under every quiet album is a column of nothing, and it makes
        the albums people *have* talked in harder to pick out.

        One `Pressable` around both, because both are the same errand. It is
        nested inside the card's own, which is what makes the pair work: the
        inner one takes the touch when it lands here and the outer one takes
        everything else. The card still opens the album; this opens the album
        at its conversation.
      */}
      {(event.lastMessage || counted !== '') && (
        <Pressable
          onPress={() => onOpen(undefined, 'talk')}
          accessibilityRole="button"
          accessibilityLabel={[
            event.lastMessage && `${event.lastMessage.author} said ${event.lastMessage.body}.`,
            counted !== '' && `${counted}.`,
            'Open the conversation',
          ]
            .filter(Boolean)
            .join(' ')}
          /*
            A wash rather than a fade.

            `opacity` on press takes the whole block down, the face included,
            which reads as the card dimming rather than as something being
            pressed. A panel of colour behind it is what the tab bar does for
            the tab you are on, and it is the one press feedback in this
            product that does not touch what it is giving feedback about.
          */
          style={({ pressed }) => [
            styles.reply,
            pressed && { backgroundColor: dark ? '#ffffff14' : 'rgba(20,23,28,0.06)' },
          ]}
        >
          {event.lastMessage && (
            /*
              A face, a name and the words — the shape of a reply everywhere.

              It was a bordered box, which said "somebody is talking" by being
              a speech shape. A person's own face says it without a container,
              and it says *which* person, which the box never did: the reply
              on a card is somebody else's voice inside somebody else's
              evening, and the two are worth telling apart.

              The words in `dim` and the name in `fg`, which is the whole of
              how a reply is set apart from the album's own title and byline
              above it. Not italic: a sentence somebody typed is not an aside.
            */
            <View style={styles.replyRow}>
              {event.lastMessage.avatarUrl ? (
                <Image
                  source={{ uri: event.lastMessage.avatarUrl }}
                  style={[styles.sayerFace, styles.replyFace, { backgroundColor: t.line }]}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View
                  style={[styles.sayerFace, styles.replyFace, { backgroundColor: saidLens.fill }]}
                >
                  <Text style={[styles.sayerInitial, { color: saidLens.ink }]}>
                    {initialOf(event.lastMessage.author)}
                  </Text>
                </View>
              )}
              <Text style={[styles.replyLine, { color: t.dim }]} numberOfLines={2}>
                <Text style={[styles.replyWho, { color: t.fg }]}>{event.lastMessage.author}</Text>
                {'  '}
                {event.lastMessage.body}
              </Text>
            </View>
          )}

          {counted !== '' && (
            /*
              The line that closes the card, and the one at its head are the
              same line: numerals in the ledger's own monospace, then a
              hairline to the edge of the column. `measured` at the top says
              when the evening was and how many photographs; this says how
              much was said about them. A stack of cards reads as entries in a
              ledger because each one opens and closes on a rule.

              What the two do not share is the words. The head line is a
              sentence about the album — a date and a count of what is in it —
              and it has to be read. This one is a tally of two things that
              never change and never take a third: comments, and reactions. A
              label that is the same on every card is a label nobody reads
              twice, and "4 COMMENTS · 12 REACTIONS" spent two thirds of the
              line saying what the reader already knew, in the one place a
              card has left to be quiet in.

              So the nouns are glyphs and the numbers stay. Not a new pair of
              drawings: the bubble is what this product already draws for an
              album's comments, and the face is the button that opens the
              emoji picker — the two pictures somebody has already met on the
              screen this line opens. Sized to the type rather than to the
              family — 13 against 10.5pt numerals, so the row reads as a line
              of text with two marks in it rather than as a toolbar — and at
              the family's own weight of 2 rather than the chevron's 2.2. The
              chevron is a single stroke and needs the extra; the face has
              four inside an 8.5-unit circle, and at 2.2 its eyes and mouth
              close up into the ring at this size.

              Hidden from a screen reader, like the head line and for the same
              reason: `counted` is in the card's accessible name as words, and
              a glyph beside a digit reads there as "4 12".

              The chevron is what keeps it from being a label. A rule running
              off the edge is a boundary; a rule that ends in an arrow is a
              way through, which is what this one is.
            */
            <View
              style={styles.ledger}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {comments > 0 && (
                <View style={styles.tally}>
                  <Glyph name="bubble" size={13} weight={2} color={t.dim} />
                  <Text style={[styles.tallyText, { color: t.dim }]}>{comments}</Text>
                </View>
              )}
              {reactions > 0 && (
                <View style={styles.tally}>
                  <Glyph name="face" size={13} weight={2} color={t.dim} />
                  <Text style={[styles.tallyText, { color: t.dim }]}>{reactions}</Text>
                </View>
              )}
              <View style={[styles.rule, { backgroundColor: t.line }]} />
              <Glyph name="chevron" size={14} weight={2.2} color={t.dim} />
            </View>
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

/**
 * Who is in an event nobody has added to.
 *
 * Counted from the other side — "you and one other" rather than "2 people" —
 * because this card is asking the person reading it to do something, and the
 * sentence that asks is the one they are in. Same words as the web's.
 */
function emptyLine(memberCount: number): string {
  const others = Math.max(0, memberCount - 1);
  if (others === 0) return 'Just you so far. Nothing in it yet.';
  if (others === 1) return 'You and one other. Nothing in it yet.';
  return `You and ${others} others. Nothing in it yet.`;
}

/** Two of the mark's lenses, for the cluster on the card that has no photos. */
const EMPTY_LENSES = ['#ffb3b8', '#9db2f0'] as const;

/**
 * A clock that ticks once a minute, for the "20 min ago" on each card.
 *
 * A phone left on this screen should not still claim the top event was added
 * to twenty minutes ago an hour later. Once a minute is the coarsest interval
 * that keeps every string it renders true, and the interval is cleared on
 * unmount so a backgrounded app is not waking to re-render a list nobody is
 * looking at.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Page 1 — what is happening, most recently active first. */
export function HomeTab({
  api,
  events,
  loading,
  t,
  waiting,
  onOpen,
  onRefresh,
  onOpenLately,
  onCreate,
  onCreateGroup,
  onOpenPerson,
  Button,
}: {
  api: Api;
  events: EventListing[];
  loading: boolean;
  t: TabTheme;
  /**
   * Open an album: at a photograph, at a pane, or at the top of it.
   *
   * The second argument is what the strip under a cover needs: a tile there is
   * a picture of one photograph, and pressing it should arrive at that
   * photograph rather than at the grid it is somewhere inside.
   *
   * The third is what the bubble needs, and this signature is the reason it
   * did not work: the card asked for `'talk'`, this type had no room for it,
   * and the handler below dropped it — so pressing somebody's words landed on
   * the grid and left the reader to find the tab. `App` has taken a pane
   * since panes existed; only the two lines between here and there had not.
   */
  onOpen: (event: EventListing, photo?: string, pane?: 'photos' | 'talk' | 'people') => void;
  onRefresh: () => Promise<void>;
  /** How many things are waiting on an answer, for the badge on the envelope. */
  waiting: number;
  /** Into Lately, from the corner every tab now keeps it in. */
  onOpenLately: () => void;
  onCreate: () => void;
  /** A byline on a card is a person; pressing one opens them. */
  onOpenPerson: (handle: string) => void;
  /**
   * The group half of the `+`.
   *
   * Goes to the Groups tab with its form open, exactly as the profile's does —
   * the form there arrives with the people this person keeps ending up in
   * events with, and a bare name-and-nobody form is the empty-group problem
   * that tab was written to avoid.
   */
  onCreateGroup: () => void;
  Button: ButtonComponent;
}) {
  const [refreshing, setRefreshing] = useState(false);
  // One gesture refreshes both: pulling the list down and finding the count
  // above it stale would make the count the thing nobody trusts.
  const [pulled, setPulled] = useState(0);
  /** The `+`'s two choices. Nothing is made until one of them is picked. */
  const [starting, setStarting] = useState(false);
  const now = useNow();

  /*
   * Albums with nothing in them are not on this page.
   *
   * An empty album is a card that asks to be opened and then has nothing to
   * show — and most of them were never this person's doing: somebody made an
   * evening, added people, and the evening has not happened yet. A column of
   * those is the first thing the product's main screen said, on the tab whose
   * whole subject is photographs.
   *
   * `arrivingCount` counts too, so an album stays put between the upload
   * finishing and the deriver getting to it. Without that, adding the first
   * photograph to an album would make it disappear for the minute or so the
   * derivatives take and then come back, which is worse than either state.
   *
   * This hides your own empty albums as well. Making one still lands you
   * inside it — `onCreated` opens the event rather than returning to this
   * list — so the way in is the link, the group it belongs to, or adding the
   * photograph that puts it back here.
   */
  const filled = events.filter(
    (event) => event.photoCount > 0 || event.arrivingCount > 0,
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.dim}
          onRefresh={async () => {
            setRefreshing(true);
            setPulled((n) => n + 1);
            await onRefresh();
            setRefreshing(false);
          }}
        />
      }
    >
      {/*
        A title and the one thing you can make from here.

        `Start one` was a word on the title's baseline and is a `+` now — the
        same 36pt bordered circle the Groups tab makes a group with and the
        album screen adds photographs with. Three tabs, one shape for "make
        something here", and it stops the heading row being two things to read
        on the way to the evenings underneath it.

        It opens the same two choices the profile's `+` does. One glyph meaning
        two things in one place and one thing in another is the sort of
        difference nobody can learn: either `+` makes what you ask it for.
      */}
      {/*
        Make something on the left, answer something on the right.

        The `+` was on the right and the envelope was on the Groups tab only,
        which put the two in the same corner on one screen and neither in a
        predictable place. They are opposite each other on all three now:
        making is the thing you came to do, answering is the thing that came to
        you, and one corner each is what stops either from being hunted for.

        The `+` opens the same two choices the profile's does. One glyph
        meaning two things in one place and one thing in another is the sort of
        difference nobody can learn: either `+` makes what you ask it for.
      */}
      <PageHead
        color={t.fg}
        left={
          <RoundButton
            t={t}
            onPress={() => setStarting(true)}
            accessibilityLabel="New album or group"
          >
            <Glyph name="plus" size={20} color={t.fg} />
          </RoundButton>
        }
        right={<Notifications t={t} count={waiting} onPress={onOpenLately} />}
      />

      {starting && (
        <StartSomething
          t={t}
          Button={Button}
          onClose={() => setStarting(false)}
          onAlbum={onCreate}
          onGroup={onCreateGroup}
        />
      )}

      {/*
        The invitations used to sit here, above the list, on the argument that
        they are the one thing on this screen somebody has to *do* something
        about. That was true while there was nowhere else for them.

        Lately is that somewhere else, and it holds the same four asks with the
        same two buttons — so keeping this meant the same request in two places
        at once, answered in one and still sitting in the other, which reads as
        the answer not having taken. `activity.ts` names that failure directly;
        it is the reason an answered friend request leaves the queue.

        What replaces it is the badge on the envelope, which is a smaller claim
        made in a place that is always there.
      */}

      {loading && filled.length === 0 && <Waiting fill />}

      {/*
        A line and the one stroke that answers it — the shape the profile's
        empty shelf uses, and the same words, because it is the same absence.

        It was a bordered card holding two sentences and a filled button: a
        panel, on a page whose every other row is a photograph, drawing more
        attention empty than the cards draw full. The sentence it lost said
        that albums you are sent open when you tap the link, which is true and
        is not something somebody needs told while looking at an empty screen
        — it describes what happens elsewhere, later, without them doing
        anything.
      */}
      {!loading && filled.length === 0 && (
        <View style={styles.blank}>
          <Text style={[styles.blankNote, { color: t.dim }]}>
            No Albums Yet. Create One Now.
          </Text>
          <RoundButton t={t} onPress={onCreate} accessibilityLabel="Create an album">
            <Glyph name="plus" size={20} color={t.fg} />
          </RoundButton>
        </View>
      )}

      {filled.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          // One clock, handed down: a card that read the time itself would let
          // two cards rendered a tick apart disagree about where the minute
          // boundary was. Every card shows the evening it happened on, and
          // recency only while it is being added to — so there is no longer a
          // "newest" case, which used to be the only row showing a time.
          now={now}
          onOpenPerson={onOpenPerson}
          t={t}
          onOpen={(photo, pane) => onOpen(event, photo, pane)}
        />
      ))}

      {/* Deliberately not repeated at the foot: "Start one" is on the title
          row above, and two buttons for one action on a scrolling list is
          furniture rather than affordance. */}
    </ScrollView>
  );
}

/**
 * Page 2 — finding things.
 *
 * Three parts, and they differ in kind rather than in subject. Group search
 * and handle search both reach past what this person already has, and both are
 * deliberately narrow: a findable group comes back as a name and a member
 * count, never what is inside, and a person comes back as a handle and
 * whatever name they chose to show, by prefix, so somebody is findable enough
 * to be *asked* and no further. §3's rule holds — groups can be findable,
 * photos never are — so there is no event search here, and adding one would
 * make people's photographs discoverable by strangers.
 *
 * The map part is the opposite: it reaches only events this person is already
 * in, arranged by where they were. Nothing is discovered, and nothing is
 * exposed that they could not already see.
 */
/**
 * The lens a group's tile is drawn in, and the letter on it.
 *
 * By a stable hash of the id so a group keeps its colour between launches — a
 * list whose colours reshuffle every time it loads is decoration rather than a
 * way of telling two rooms apart. The same four-lens palette the mark is drawn
 * from, and the same rule the web's Groups page follows.
 *
 * Never a photograph. A group has no cover of its own, and the only pictures
 * available are inside events that belong to it — putting one on the door
 * shows something from a room on the screen that is merely the way in.
 */
/*
 * The lens palette lives in `lens.ts` now.
 *
 * Four screens draw one of these — the group tiles here, the faces over an
 * event's cover, the avatars in a thread and the tiles in a search result —
 * and a second copy of the five colours is how the same group comes to be pink
 * in one list and green in another.
 */

/**
 * The group chats, and nothing else.
 *
 * This tab used to be two things at once: the rooms you are in, drawn as
 * blocks of covers, *and* the talk going on in them. The rooms have moved to
 * Find — see `SearchTab` — and what is left is the thing the tab was always
 * being used as.
 *
 * The split is not tidiness. A group block was a name, a strip of three covers
 * and one line of conversation, about a hundred points each, so three groups
 * filled the screen and the album chats began below the fold. The talk was
 * underneath the furniture. And a group's own thread appeared only as the last
 * line of its block, which is why the section heading beneath could say GROUP
 * CHATS over a list that contained none of them.
 *
 * ## Why the album comments are not here
 *
 * They were, under a second heading, and then behind a second tab. Both kept
 * the same problem alive: this product looked like it had three places to talk
 * — a group's chat, an album's comments, and the remarks under a photograph —
 * when it has two, and one of those two was being listed twice.
 *
 * A comment belongs to the photograph it is about. It stays there. What was
 * genuinely lost by taking the list off this tab is the way *back* to a
 * conversation you are part of but did not start, and that belongs in Lately
 * with everything else that has happened to you — see `activity.ts`, which now
 * carries a reply as well as a comment on your own photograph.
 *
 * So: one list, of rooms. Every group is listed, spoken in or not. There are a
 * handful of them and a silent one is a room you might be the first to say
 * something in.
 */
export function ChatsTab({
  api,
  events,
  t,
  active,
  onOpenGroupThread,
  onCreateChat,
  Button,
}: {
  api: Api;
  events: EventListing[];
  t: TabTheme;
  /** The `+`. A chat, made out of people — see `NewGroup.tsx`. */
  onCreateChat: () => void;
  Button: ButtonComponent;
  active: boolean;
  onOpenGroupThread: (group: MyGroupDetail) => void;
}) {
  const [groups, setGroups] = useState<MyGroupDetail[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** What is being looked for on this tab, if anything. */
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setGroups(await api.myGroupsDetailed().catch(() => []));
  }, [api]);

  // On arrival, and on every return to the tab. Not on the switches away.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    if (!active) {
      // A search is something somebody is in the middle of, not a setting.
      // Leaving the tab and coming back should be this tab, not the last thing
      // typed into it — a stale query hides most of the screen on arrival with
      // the reason for it scrolled off the top.
      setQuery('');
    }
  }, [active]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /*
   * Searching this tab, over what it already holds.
   *
   * Local rather than a round trip: every conversation on this screen is in
   * memory by the time it draws, and asking the server would cost the one
   * thing that makes a search field feel like one — that the list narrows
   * while you type rather than a moment after you stop.
   *
   * It reads what was last *said* as well as the names. Somebody looking for a
   * conversation, on the tab that is only conversations, is as likely to
   * remember a word out of it as the name of the room it happened in; a search
   * that matches titles alone refuses the more useful half of the question.
   */
  const looking = query.trim().toLowerCase();
  const matches = useCallback(
    (...fields: (string | null | undefined)[]) =>
      !looking || fields.some((field) => field?.toLowerCase().includes(looking)),
    [looking],
  );

  /*
   * The standing conversations, by when something was last said in them.
   *
   * A group nobody has spoken in has no message to sort by and goes last,
   * behind every group that has one — `lastActiveAt` would sort it by album
   * activity, which is the other tab's subject and not this one's.
   */
  const groupChats = useMemo(
    () =>
      (groups ?? [])
        .filter((group) =>
          // `title` and not `name`: most rooms have none, and what somebody
          // types is what the row says — which for a chat is a person's name.
          matches(group.title, group.lastMessage?.body, group.lastMessage?.author),
        )
        .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? '')),
    [groups, matches],
  );

  /*
   * Every album somebody has spoken in, newest conversation first.
   *
   * Sorted by when something was last *said*. A list of conversations ordered
   * by upload time puts a silent album full of photographs above the one
   * somebody is talking in, which is the wrong answer on a tab about talking.
   *
   * Grouped albums are here too, and not only the one-offs. An album inside a
   * group has a conversation that belongs to that evening rather than to the
   * room, and holding it back left it reachable only by remembering which
   * album it was and opening its Talk tab.
   */
  /*
   * Nothing at all until every part of this page can be drawn at once.
   *
   * The album chats are built from `events`, a prop the tabs already hold, so
   * they would be on screen a round trip before the group chats above them —
   * the minor half of the tab arriving first, with the rest dropping in on top
   * and pushing down whatever somebody had started reading.
   *
   * Only ever the first paint. `load` never puts `groups` back to null, so
   * coming back to the tab redraws the page it had and fills in behind it.
   */
  if (groups === null) {
    return (
      <View style={styles.groupsLoading}>
        <Waiting size={40} />
      </View>
    );
  }

  const nothing = groups.length === 0 && looking === '';


  return (
    <ScrollView
      contentContainerStyle={styles.groupsScroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.dim} />
      }
    >
      {/*
        The same head every tab has, with its controls in the same corners:
        making on the left of the name, answering on the right.
      */}
      {/*
        One corner, and it makes the thing this tab is made of.

        The `+` was on the left and opened the sheet that asks album or group;
        the envelope was on the right. Both are gone from here. The tray is
        reachable from every other tab and is not what somebody opens their
        conversations to find, and a tab whose subject is conversations does
        not need to ask which of two things you meant — pressing `+` here
        starts a chat, and the sheet still exists everywhere it is a real
        question.

        It said "New group" and it went to Find and opened the group form: a
        button on the conversations tab that changed tabs and then asked for a
        title. It makes a chat now, in place, and a chat is people and nothing
        else — see the note at the top of `NewGroup.tsx`.

        On the right, because that is the hand that reaches it and because the
        corner a thumb finds should hold the thing this screen is for.
      */}
      <PageHead
        color={t.fg}
        right={
          <RoundButton t={t} onPress={onCreateChat} accessibilityLabel="New chat">
            <Glyph name="plus" size={20} color={t.fg} />
          </RoundButton>
        }
      />

      {/*
        The same field Find has, because it is the same gesture.

        Hidden where there is nothing to search: on a tab with no rooms and no
        conversations it is a control that cannot succeed, sitting above the
        paragraph explaining why there is nothing here.
      */}
      {!nothing && (
        <View style={[styles.field, { backgroundColor: t.card, borderColor: t.line }]}>
          <Glyph name="search" size={17} color={t.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={t.dim}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search chats"
            style={[styles.fieldText, { color: t.fg }]}
          />
          {query !== '' && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              // A larger target than the glyph: this is the control somebody
              // reaches for one-handed, at the far edge of the screen.
              hitSlop={12}
            >
              <Text style={[styles.clear, { color: t.dim }]}>✕</Text>
            </Pressable>
          )}
        </View>
      )}

      {nothing ? (
        /*
         * Where conversations come from, rather than a control that cannot
         * work. Somebody here with none has not failed at anything — they have
         * not shared an evening yet, which is where every thread in this
         * product starts.
         */
        <View style={{ gap: 12 }}>
          <Text style={[styles.label, { color: t.fg }]}>No chats yet.</Text>
          <Text style={[styles.body, { color: t.dim }]}>
            Every group you are in has one. Comments on photographs live on the
            album they belong to, and turn up in your tray when somebody
            answers you.
          </Text>
          {/*
            The thing that makes a chat, where the chats would be.

            What stood here was a link to the albums tab — an explanation of
            where conversations come from, offered as a door out of the screen
            somebody had just opened. It was right when a group could only be
            made from an evening and nothing here could make one; a room can be
            made outright now, so the empty chats page gets the control that
            fills it rather than directions elsewhere.

            A line and a stroke rather than a filled button, which is the
            profile's shape and now the product's: the three screens that can
            be empty say so the same way. The line is short because the
            heading above has already said what is missing — repeating it over
            the button would be the screen telling somebody twice.

            Centred in the space the list will occupy, and gone the moment
            there is one: this whole branch is `nothing`, so the first chat
            takes the prompt with it.
          */}
          <View style={styles.blank}>
            <Text style={[styles.blankNote, { color: t.dim }]}>Create One Now.</Text>
            <RoundButton
              t={t}
              onPress={onCreateChat}
              accessibilityLabel="Start a chat"
            >
              <Glyph name="plus" size={20} color={t.fg} />
            </RoundButton>
          </View>
        </View>
      ) : (
        <>
          {/*
            The rooms, one row each: a letter on the group's own colour, the
            name, and the last thing said in it.

            Never a photograph on the tile. A group has no picture of its own,
            and borrowing one out of an evening inside it would put something
            from a room on the way in to it — the same rule the doors on Find
            follow.
          */}
          {groupChats.length > 0 && (
            <View style={{ gap: 2 }}>
              {groupChats.map((group, i) => {
                return (
                  <Pressable
                    key={group.id}
                    onPress={() => onOpenGroupThread(group)}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.title}, conversation`}
                    style={({ pressed }) => [
                      styles.chatRow,
                      // No rule under the last one: a divider at the foot of a
                      // list is a line under nothing.
                      i < groupChats.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: t.line,
                      },
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <RoomMark room={group} size={40} t={t} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[styles.chatName, { color: t.fg }]} numberOfLines={1}>
                        {group.title}
                      </Text>
                      {/* A count rather than a dot: a group is busy, and the
                          number is the useful part. */}
                      <ConversationLine
                        line={group}
                        fallback="Nobody has said anything yet."
                        t={t}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/*
            A search that matches nothing should say so rather than leaving a
            head, a field and an empty page — which reads as the tab having
            failed to load rather than as an answer.

            And it says where the other kind of conversation is. Comments live
            on the photographs they are about; the way back to one you are part
            of is Lately, not this tab.
          */}
          {looking !== '' && groupChats.length === 0 && (
            <Text style={[styles.body, { color: t.dim }]}>
              No chat of yours matches “{query.trim()}”. This searches your
              groups — comments on photographs are on the album they belong to.
            </Text>
          )}

        </>
      )}
    </ScrollView>
  );
}
/**
 * What a room is drawn as: a letter on a colour, or the people in it.
 *
 * ## Two icons, and the room chooses
 *
 * A **named** room keeps the letter on its lens colour, which is the shape
 * this product has meant by "a group" since the Groups tab was written.
 *
 * A room **nobody has named** has no letter to wear — its title is a sentence
 * about who is in it, and the first character of "Ana, Jack + 2 more" is a
 * fact about Ana. So it wears the people instead: one square for a chat with
 * one person, and a deck of overlapping squares for a room with more.
 *
 * ## It is not the photograph rule being broken
 *
 * "Never a photograph on a group tile" is stated in four places in this file
 * and it still holds. That rule is about the pictures *inside* the room:
 * borrowing a cover out of an evening would put something from a room onto
 * the way in to it, and it would be shown to somebody who has not been let
 * in. A member's own portrait is theirs, it is already on their profile, and
 * the server only ever builds this list for a room the reader is in — a door
 * to a group they are not in still carries a name and a count and nothing
 * about who is behind it.
 *
 * ## Squares, and overlapping
 *
 * Squares because the thing it stands in for is a square: this sits exactly
 * where the lens tile sat, in a column of them, and a circle there would make
 * the unnamed rooms read as a different kind of row rather than as the same
 * row drawn from what it has. The faces over an album's cover stay circles —
 * that is a crowd read as a row, and this is one object.
 *
 * Overlapping rather than tiled, and leading-edge first, so the deck occupies
 * the tile's own square whatever it holds: one picture fills it, three sit
 * across it, and the row's text starts at the same x either way.
 */
function RoomMark({
  room,
  size,
  t,
}: {
  room: {
    id: string;
    title: string;
    kind: GroupKind;
    /** Optional only so the render cannot die of an older server. See below. */
    deck?: { name: string; avatarUrl: string | null }[];
  };
  size: number;
  t: { bg: string; line: string; dim: string };
}) {
  const lens = lensFor(room.id);
  const radius = Math.round(size * 0.25);
  /*
   * Belt and braces over the default `titled` already applies in `api.ts`.
   *
   * Not a second policy — it is the same empty list — but this is a render,
   * and a render that reaches into a field the server might not have sent
   * takes the whole tab down rather than drawing one row badly. It did once:
   * "Cannot read property 'length' of undefined" on every chat, from a phone
   * whose build was newer than the deploy it was talking to.
   */
  const deck = room.deck ?? [];

  if (room.kind === 'named' || deck.length === 0) {
    return (
      <View
        style={[
          { width: size, height: size, borderRadius: radius, backgroundColor: lens.fill },
          styles.markCentre,
        ]}
      >
        <Text style={{ fontSize: Math.round(size * 0.42), fontWeight: '600', color: lens.ink }}>
          {initialOf(room.title)}
        </Text>
      </View>
    );
  }

  /*
   * One person fills the square; more than one is a deck across it.
   *
   * `slice(0, 3)` and not the whole membership: a fourth card at this size is
   * four points of somebody's face, which is a texture rather than a person.
   * The title beside it already says how many there are.
   */
  const cards = deck.slice(0, 3);
  const card = cards.length === 1 ? size : Math.round(size * 0.72);
  const step = cards.length === 1 ? 0 : Math.round((size - card) / (cards.length - 1));

  return (
    <View style={{ width: size, height: size }}>
      {cards.map((person, i) => (
        <View
          key={`${person.name}-${i}`}
          style={[
            styles.markCard,
            styles.markCentre,
            {
              width: card,
              height: card,
              borderRadius: Math.round(card * 0.25),
              left: i * step,
              // Later cards sit over earlier ones, and each wears a ring of
              // the page's own colour so the stack reads as three things
              // rather than one shape with bites out of it.
              top: i * step,
              zIndex: i,
              borderColor: t.bg,
              backgroundColor: t.line,
            },
          ]}
        >
          {person.avatarUrl ? (
            <Image
              source={{ uri: person.avatarUrl }}
              style={styles.markShot}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <Text
              style={{ fontSize: Math.round(card * 0.4), fontWeight: '700', color: t.dim }}
            >
              {initialOf(person.name)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * One conversation, as one line: who spoke, what they said, when, and how many
 * are waiting.
 *
 * Written once for the group rows and the event-chat rows because they are the
 * same sentence about two kinds of room, and written twice they would drift
 * the first time somebody changed how a name is emphasised. Both callers are
 * on the Chats tab now — Find's groups were the third, and they are doors
 * with no line under them, because a search page saying what was last said in
 * a room is answering the other tab's question.
 *
 * The count is a pill on a group and a dot on an event chat, which is not
 * decoration: a group is busy and the number is the useful part, where an
 * event chat is usually one or two messages and a number on it is precision
 * nobody asked for.
 */
function ConversationLine({
  line,
  fallback,
  t,
  dot = false,
  onPress,
}: {
  line: ThreadLine;
  /**
   * What a thread nobody has spoken in says.
   *
   * Optional, because the event chats no longer list a conversation that has
   * not happened — only a group row can be empty and still be worth drawing,
   * since the room exists whether or not anybody has spoken in it yet.
   */
  fallback?: string;
  t: TabTheme;
  /** A dot rather than a count. See above. */
  dot?: boolean;
  onPress?: () => void;
}) {
  const unread = line.unreadCount > 0;
  const last = line.lastMessage;

  const body = (
    <>
      {last ? (
        <>
          <View style={[styles.sayerFace, { backgroundColor: lensFor(last.author).fill }]}>
            <Text style={[styles.sayerInitial, { color: lensFor(last.author).ink }]}>
              {initialOf(last.author)}
            </Text>
          </View>
          <Text
            style={[styles.said, { color: unread ? t.fg : t.dim }]}
            numberOfLines={1}
          >
            {/* "You" rather than your own name read back at you — the same
                thing every card in this product does. */}
            <Text style={styles.sayer}>{last.mine ? 'You' : last.author}</Text>{' '}
            {last.body}
          </Text>
          <Text style={[styles.saidWhen, { color: t.dim }]}>
            {ago(new Date(last.at), new Date())}
          </Text>
        </>
      ) : fallback ? (
        <Text style={[styles.said, { color: t.dim }]} numberOfLines={1}>
          {fallback}
        </Text>
      ) : null}

      {unread &&
        (dot ? (
          <View style={[styles.unreadDot, { backgroundColor: t.accent }]} />
        ) : (
          <View style={[styles.unreadPill, { backgroundColor: t.accent }]}>
            <Text style={[styles.unreadCount, { color: t.onAccent }]}>
              {line.unreadCount > 99 ? '99+' : line.unreadCount}
            </Text>
          </View>
        ))}
    </>
  );

  if (!onPress) return <View style={styles.sayRow}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        last
          ? `Conversation, ${line.unreadCount > 0 ? `${line.unreadCount} new, ` : ''}${
              last.mine ? 'you' : last.author
            } said ${last.body}`
          : 'Conversation, nothing said yet'
      }
      style={({ pressed }) => [styles.sayRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/**
 * The shelf of doors: three across, with the gutters the album shelves use.
 *
 * Three rather than the two a shelf of albums gets, because these are not
 * photographs. An album tile has to be big enough to recognise an evening in;
 * a door is a letter on a colour, and at half the width of the screen it is a
 * field of colour with a character floating in it.
 *
 * This went to four for a day, to make the doors smaller, and came back. The
 * column is not the icon: what four bought was a smaller square, and what it
 * cost was the name under it, which is the half of a door a reader is
 * actually scanning. Three columns with a smaller square inside each gets the
 * first without paying the second — see `DOOR_TILE` below, which is where the
 * shrink lives now.
 */
const GROUP_COLUMNS = 3;
const GROUP_GAP = 10;

/**
 * How much of its column a door's square actually fills.
 *
 * The square used to be the column. At three across that is 110 points on a
 * phone — larger than any real photograph on the tab above it, for a drawing
 * that is one character, and past the point where the letter is legible every
 * extra point of edge is more of the same flat colour. 0.7 puts it near 80,
 * which is the size of a thing you tap rather than a thing you look at.
 *
 * A fraction of the column rather than a number of points, for the same
 * reason the corner and the letter are fractions of the square: one decision
 * about the shape, not the same decision made again on every screen width.
 *
 * What the column keeps is the name. It is the full 110 wide where the icon
 * is 80, so "Sunday lunch club" sets on two lines here and would have needed
 * three in a four-column shelf — the shrink happens to the part that was too
 * big and not to the part that was already working.
 */
const DOOR_TILE = 0.7;

/**
 * How many doors Find opens with.
 *
 * Two rows, which is most people's rooms, and the rest stays behind the word.
 *
 * Written as the arithmetic rather than as the answer, because it is a
 * statement about rows and the row has already changed width once: at 6
 * against four columns it drew a row of four and a row of two, a shelf with a
 * corner missing and an "All groups" button under it for the sake of two
 * rooms. The number is back at six because the shelf is back at three, and
 * nobody had to remember to put it there.
 *
 * Before that it was three, and three was a measurement of the block the
 * doors replaced: a name, a strip of covers and a line of conversation came
 * to about a hundred points each, so three of them was what fitted under the
 * search field. A door and its name is a fraction of that, so the old number
 * bought a single line of icons and a button — more chrome than list.
 */
const GROUPS_SHOWN = GROUP_COLUMNS * 2;

/**
 * Find — one field, scoped by chips.
 *
 * It was three bordered cards, each with a heading, each with a paragraph of
 * policy above it, two of them holding a text field. So a tab whose whole job
 * is a search asked somebody to pick which of two boxes to type in, and told
 * them what could not be searched three times before they had searched for
 * anything at all.
 *
 * Now: one field, three chips saying what it is searching, results as rows in
 * one list, and the policy said once at the foot — where it is read by
 * somebody who has just seen what came back, rather than as a preamble to an
 * empty screen.
 *
 * ## What has not changed
 *
 * Every rule the three cards enforced is still here, because none of them was
 * about the layout:
 *
 *   - **Two characters before anything is asked for.** The server's floor;
 *     below it there is nothing to ask for and asking per keystroke is a
 *     request per keystroke.
 *   - **A failed lookup empties the list.** A stale row here is one somebody
 *     is about to tap, and tapping it opens a page for a search they have
 *     already changed.
 *   - **Places is local.** It groups this person's own events by their place
 *     and hands the place to the maps app they already use. It queries
 *     nothing, which is why it can answer before two characters.
 *   - **Events and photographs are never searchable.** That is the sentence at
 *     the foot, and it is the product's line rather than this screen's.
 */
export function SearchTab({
  api,
  events,
  t,
  waiting,
  onOpen,
  onOpenGroup,
  onOpenPerson,
  onOpenLately,
  onCreateAlbum,
  onCreateGroup,
  onCreateGroupFrom,
  active,
  openCreate = 0,
  Button,
}: {
  api: Api;
  events: EventListing[];
  t: TabTheme;
  /** Whether this is the tab on screen. The rooms below are reloaded on arrival. */
  active: boolean;
  /** How many things are waiting on an answer, for the badge on the envelope. */
  waiting: number;
  onOpen: (event: EventListing) => void;
  onOpenGroup: (groupId: string) => void;
  onOpenPerson: (handle: string) => void;
  onOpenLately: () => void;
  /** The `+`'s two halves. Nothing is made until one of them is picked. */
  onCreateAlbum: () => void;
  onCreateGroup: () => void;
  onCreateGroupFrom: (cluster: Cluster) => void;
  /**
   * A counter, bumped when a `+` on another tab asks this one to open the
   * make-a-group page. Zero is the value nobody asked with — the tab opening
   * normally, rather than somebody arriving on it holding a press.
   */
  openCreate?: number;
  Button: ButtonComponent;
}) {
  /** The shelf of doors below is laid out from this. See `door`. */
  const { width } = useWindowDimensions();
  const [starting, setStarting] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [people, setPeople] = useState<InvitablePerson[]>([]);

  /*
   * The rooms this person is already in, which is what this page is when
   * nobody is searching it.
   *
   * They were a tab of their own, sitting above the conversations going on
   * inside them — so the talk began below the fold, and one tab carried two
   * subjects under one name. Here they are the resting state of the page whose
   * whole job is finding a room: the ones you have, and a field for the ones
   * you do not.
   *
   * Null until the first answer, which is how this tells "still asking" from
   * "none" — the difference between a spinner and a paragraph about what
   * groups are for.
   */
  const [mine, setMine] = useState<MyGroupDetail[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [allGroups, setAllGroups] = useState(false);
  /**
   * People worth asking, and who has already been asked from here.
   *
   * `sent` is local rather than a reload. The server answers a request with
   * the standing it produced, and re-fetching the suggestions to make a row
   * disappear would take the whole list out from under a finger mid-scroll —
   * which is the thing a horizontal row of faces is least able to survive.
   */
  const [suggested, setSuggested] = useState<SuggestedPerson[] | null>(null);
  const [sent, setSent] = useState<Record<string, 'asking' | 'asked'>>({});

  /**
   * The last few things typed into the box, from this phone's own store.
   *
   * Read once on mount rather than on every arrival at the tab: it changes
   * only when somebody searches, and this screen is the only thing that
   * writes it. See `rememberSearch`, and `signOutDevice`, which hands it back
   * with everything else.
   */
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    void loadSearches().then(setRecent);
  }, []);

  /*
   * Remembered when a search is *used*, not when it is typed.
   *
   * The box asks after two characters and on every keystroke after that, so a
   * list built from what was asked would be "w", "wr", "wre" — a history of
   * somebody's typing rather than of their searches. What means "this was the
   * one" is opening something it found.
   */
  const remember = useCallback((term: string) => {
    if (term.trim().length < 2) return;
    void rememberSearch(term).then(setRecent);
  }, []);

  const forgetAll = useCallback(() => {
    setRecent([]);
    void forgetSearches();
  }, []);

  const loadMine = useCallback(async () => {
    const [rooms, found, people] = await Promise.all([
      api.myGroupsDetailed().catch(() => []),
      api.clusters().catch(() => ({ clusters: [], also: [] })),
      // Empty for a guest, which the route answers with a 403 — a suggestion
      // is derived from a friendship graph and a device that has never signed
      // in has none.
      api.suggestedPeople().catch(() => []),
    ]);
    setMine(rooms);
    setClusters(found.clusters);
    setSuggested(people);
  }, [api]);

  const ask = useCallback(
    async (actorId: string) => {
      setSent((was) => ({ ...was, [actorId]: 'asking' }));
      try {
        const answer = await api.askFriend(actorId);
        // `accepted` happens when this crossed with an ask of theirs: the
        // endpoint answers the open request rather than opening a second one.
        setSent((was) => ({ ...was, [actorId]: 'asked' }));
        return answer;
      } catch {
        // Back to a button that can be pressed again, rather than a row stuck
        // saying it is doing something it has stopped doing.
        setSent((was) => {
          const next = { ...was };
          delete next[actorId];
          return next;
        });
        return null;
      }
    },
    [api],
  );

  // On arrival, and on every return to the tab. Not on the switches away.
  useEffect(() => {
    if (active) void loadMine();
  }, [active, loadMine]);

  useEffect(() => {
    if (!active) setAllGroups(false);
  }, [active]);

  useEffect(() => {
    if (openCreate > 0) onCreateGroup();
    // `onCreateGroup` is a route change and is stable; including it would fire
    // this on every render of the shell above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate]);

  /**
   * One box, and which namespace it is asking is the chip.
   *
   * Both lists are emptied on every keystroke below the floor and on every
   * failure, and the scope is what decides which of them is asked — switching
   * chips re-runs the same text against the other namespace rather than
   * clearing what somebody typed, which is the whole reason this is one field.
   */
  const search = useCallback(
    async (next: string, into: Scope) => {
      setQuery(next);
      // Two characters is the server's floor. Below it there is nothing to ask
      // for, and asking per keystroke is a request per keystroke.
      if (next.trim().length < 2) {
        setPeople([]);
        setGroups([]);
        return;
      }
      // `all` asks both, and the two lists draw under their own headings —
      // one field, two namespaces, rather than making somebody guess which
      // chip the thing they half-remember is filed under.
      if (into === 'people' || into === 'all') {
        setPeople(await api.findPeople(next).catch(() => []));
      }
      if (into === 'groups' || into === 'all') {
        setGroups(await api.searchGroups(next).catch(() => []));
      }
    },
    [api],
  );

  /** Events that know where they were, newest place first. */
  const places = useMemo(() => {
    const byPlace = new Map<string, EventListing[]>();
    for (const event of events) {
      if (!event.place) continue;
      byPlace.set(event.place, [...(byPlace.get(event.place) ?? []), event]);
    }
    return [...byPlace.entries()].filter(
      ([place]) =>
        query.trim().length < 2 || place.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }, [events, query]);

  const unplaced = events.filter((event) => !event.place).length;
  const asked = query.trim().length >= 2;

  /*
   * Which of this person's rooms are rooms.
   *
   * A conversation with one person is not one. It is a group row in the
   * database — that is how it holds a thread and a membership — but it is
   * called by that person's name, it has no door, and nothing about it is a
   * place you go. On the shelf below it would be Jack, filed beside Climbing
   * and Sunday Lunch as though the two were the same kind of thing, and a
   * phone with eleven conversations on it would show a shelf of eleven people
   * with the two actual rooms below the fold.
   *
   * So the shelf is named and unnamed rooms of three or more, and every chat
   * is on the tab that is for chats. The server decides which is which — see
   * `kind` — so the two clients cannot draw different shelves.
   *
   * Adding a third person to a chat *is* what makes it a room, and it turns
   * up here the moment somebody does. That is the whole of the promotion:
   * there is no other step, and naming it is optional afterwards.
   */
  const myRooms = useMemo(
    () => (mine ?? []).filter((group) => group.kind !== 'direct'),
    [mine],
  );

  /*
   * The most recently added to, unless somebody asked for the rest.
   *
   * `lastActiveAt` is null for a group nothing has happened in yet, and those
   * go last rather than first — an empty room is the least useful thing this
   * section can lead with.
   */
  const rooms = useMemo(() => {
    const ordered = [...myRooms].sort((a, b) =>
      (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''),
    );
    return allGroups ? ordered : ordered.slice(0, GROUPS_SHOWN);
  }, [allGroups, myRooms]);

  /**
   * A door's column, from the window rather than from a constant.
   *
   * 40 is the page's own padding; the gaps are the gutters between the three.
   * The same arithmetic the album shelves do, with a column more.
   *
   * This is the cell and no longer the square. The square is `tile` below and
   * is smaller, so the column's width is now the *name's* width — which is
   * what it should have been measuring all along.
   */
  const cell = Math.floor(
    (width - 40 - GROUP_GAP * (GROUP_COLUMNS - 1)) / GROUP_COLUMNS,
  );
  /** The square itself, centred in that column. See `DOOR_TILE`. */
  const tile = Math.round(cell * DOOR_TILE);
  /*
   * The corner and the letter, both proportions of the square — not of the
   * column, which is what they were taken from while the two were the same
   * number. Off the column they would now be a corner and a letter sized for
   * a tile 30 points bigger than the one they are drawn on.
   *
   * 0.225 is the corner an app icon wears, which is what this shape is
   * borrowing — written as a fraction rather than as a number of points so
   * that it is the same corner on a small phone as on a large one.
   *
   * And the letter is not a label on the icon, it *is* the icon: the 28pt
   * tile this replaced set it at 13, which is nearly half its edge, and the
   * same proportion at this size reads as somebody shouting. 0.4 is the
   * largest it goes before a wide letter starts crowding the corners.
   *
   * Neither number has been touched through two resizings of this shelf,
   * which is the whole reason they are fractions: a proportion is one
   * decision about what the shape looks like, and a number of points is that
   * decision made again at every size.
   */
  const doorRadius = Math.round(tile * 0.225);
  const doorLetter = Math.round(tile * 0.4);

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {/*
        The same two corners, on the tab that had neither.

        It said "Find" at 30 points above a search field, on the tab whose own
        glyph is a magnifier — a title saying what the field below it already
        says. What replaces it is the head the other tabs have, controls
        included: a `+` that is missing from one screen in three is a `+`
        somebody has to remember the whereabouts of.
      */}
      <PageHead
        color={t.fg}
        left={
          <RoundButton
            t={t}
            onPress={() => setStarting(true)}
            accessibilityLabel="New album or group"
          >
            <Glyph name="plus" size={20} color={t.fg} />
          </RoundButton>
        }
        right={<Notifications t={t} count={waiting} onPress={onOpenLately} />}
      />

      {starting && (
        <StartSomething
          t={t}
          Button={Button}
          onClose={() => setStarting(false)}
          onAlbum={onCreateAlbum}
          onGroup={onCreateGroup}
        />
      )}

      <View style={[styles.field, { backgroundColor: t.card, borderColor: t.line }]}>
        <Glyph name="search" size={17} color={t.dim} />
        <TextInput
          value={query}
          onChangeText={(next) => void search(next, scope)}
          placeholder={PLACEHOLDER[scope]}
          placeholderTextColor={t.dim}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`Find ${scope}`}
          style={[styles.fieldText, { color: t.fg }]}
        />
      </View>

      {/*
        What the box is asking, rather than which box to type in. The active
        chip is filled in the ink colour: this is the one control on the screen
        whose state changes what the rows below it mean, and an outline would
        make it the same weight as the two it is not.
      */}
      <View style={styles.chips}>
        {(
          [
            ['all', 'All'],
            ['people', 'People'],
            ['groups', 'Groups'],
            ['places', 'Places'],
          ] as [Scope, string][]
        ).map(([id, label]) => {
          const on = scope === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                setScope(id);
                void search(query, id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: t.fg, borderColor: t.fg }
                  : { backgroundColor: t.card, borderColor: t.line },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  on && styles.chipTextOn,
                  { color: on ? t.bg : t.dim },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        Your own rooms, under the box that finds other people's.

        Only while nobody is searching. A query on this page has an answer, and
        leaving an unrelated list of rooms beneath that answer would make the
        one thing on screen that did not match the tallest thing on screen —
        somebody searching "ana" wants the two people called Ana, not the two
        people and a hundred points of Fam Jam.

        So this is the page at rest: the groups you have, and a field for the
        ones you do not.
      */}
      {!asked && mine === null && (
        <View style={styles.groupsLoading}>
          <Waiting size={40} />
        </View>
      )}

      {/*
        What was typed here before, when nothing is typed now.

        Above the suggestions, because it is the only thing on the resting page
        that came from the reader — under two lists of the product's guesses it
        would read as a third one. Gone the moment somebody types: then the
        page is answering rather than offering.

        Held on this phone and nowhere else — see `rememberSearch` — and handed
        back with everything else on sign-out. "Clear" is beside the label
        because a phone passed around is the ordinary reason to want it gone.
      */}
      {!asked && recent.length > 0 && (
        <View style={{ gap: 6 }}>
          <View style={styles.headRow}>
            <Text style={[styles.sectionLabel, { color: t.dim }]}>RECENT</Text>
            <Pressable onPress={forgetAll} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.resultUnder, { color: t.dim }]}>Clear</Text>
            </Pressable>
          </View>
          <View style={styles.recentRow}>
            {recent.map((term) => (
              <Pressable
                key={term}
                onPress={() => void search(term, scope)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${term} again`}
                style={({ pressed }) => [
                  styles.recentChip,
                  { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.recentText, { color: t.fg }]} numberOfLines={1}>
                  {term}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/*
        People worth asking, above the groups and never anywhere else.

        Friends of your friends, most mutuals first — `suggestionsFor`, the
        same list the web's Find page draws. It is the only thing on this page
        that is a *recommendation* rather than something already yours, which
        is why it leads: somebody opening Find without a question in mind is
        the person it is for, and a list of rooms they are already in answers
        nothing for them.

        A row rather than a column. Twelve suggestions down the page would be
        the whole screen, and a suggestion is a glance — a face, a name, how
        many of your own people know them, and a button. Sideways is what says
        "some of these, not all of these".
      */}
      {!asked && (scope === 'all' || scope === 'people') && suggested !== null &&
        suggested.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={[styles.sectionLabel, { color: t.dim }]}>PEOPLE YOU MAY KNOW</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              /*
                The page scrolls down and this scrolls across, which is two
                gestures in one place — so the row is given its own padding and
                bleeds to both edges. A card half-off the screen is what tells
                somebody there is more of it sideways; a row that stops neatly
                at the margin reads as a row that has ended.
              */
              contentContainerStyle={styles.suggestRow}
              style={styles.suggestBleed}
            >
              {suggested.map((person) => {
                const standing = sent[person.actorId];
                /* Bare, like the row below it and like the profile it opens:
                   the `@` marks a handle as the thing you can type at a search
                   box, and in the slot where a card says who somebody is it is
                   punctuation in front of a name. */
                const name = person.displayName?.trim() || person.handle;
                return (
                  <View
                    key={person.actorId}
                    style={[styles.suggest, { backgroundColor: t.card, borderColor: t.line }]}
                  >
                    <Pressable
                      onPress={() => person.handle && onOpenPerson(person.handle)}
                      disabled={!person.handle}
                      accessibilityRole="button"
                      accessibilityLabel={`${name}, ${plural(person.mutuals, 'mutual friend')}`}
                      style={({ pressed }) => [{ alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 }]}
                    >
                      {person.avatar ? (
                        <Image
                          source={{ uri: person.avatar }}
                          style={[styles.suggestFace, { backgroundColor: t.line }]}
                          contentFit="cover"
                          transition={120}
                        />
                      ) : (
                        <View
                          style={[
                            styles.suggestFace,
                            styles.chatLetter,
                            { backgroundColor: lensFor(person.handle ?? person.actorId).fill },
                          ]}
                        >
                          <Text
                            style={[
                              styles.suggestInitial,
                              { color: lensFor(person.handle ?? person.actorId).ink },
                            ]}
                          >
                            {initialOf(name)}
                          </Text>
                        </View>
                      )}
                      <Text style={[styles.suggestName, { color: t.fg }]} numberOfLines={1}>
                        {name}
                      </Text>
                      {/*
                        The reason they are here. Without it this is a row of
                        strangers, and a row of strangers on a page about the
                        people you know is the thing nobody taps.
                      */}
                      <Text style={[styles.suggestWhy, { color: t.dim }]} numberOfLines={1}>
                        {plural(person.mutuals, 'mutual')}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void ask(person.actorId)}
                      disabled={standing != null}
                      accessibilityRole="button"
                      accessibilityLabel={
                        standing === 'asked' ? `Asked ${name}` : `Add ${name} as a friend`
                      }
                      style={({ pressed }) => [
                        styles.suggestAdd,
                        standing
                          ? { backgroundColor: t.bg, borderColor: t.line }
                          : { backgroundColor: t.accent, borderColor: t.accent },
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.suggestAddText,
                          { color: standing ? t.dim : t.onAccent },
                        ]}
                      >
                        {standing === 'asked' ? 'Asked' : standing ? '…' : 'Add'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

      {/*
        And what the People filter says with nothing to suggest.
        *
        * Suggestions are friends of your friends, so somebody with no friends
        * yet has none by arithmetic rather than by anything being wrong. The
        * box above is the way out of that, which is what this says.
        */}
      {!asked && scope === 'people' && suggested !== null && suggested.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          Nobody to suggest yet. These are friends of your friends, so they
          start appearing once you have a few — search a handle above to add the
          first.
        </Text>
      )}

      {!asked && scope !== 'places' && scope !== 'people' && mine !== null && (
        <>
          {/*
            The rooms, as a shelf of doors.

            Each was a block: the name on a row with a 28pt letter tile, a
            strip of album covers under it, and the last thing said in it at
            the foot — about a hundred points of screen for one group, three
            of them under the search field, and the rest behind a word.

            The three pieces were each answering a different question, and two
            of them are answered better elsewhere. The covers are evenings,
            and every evening this person can open is already on Home under
            its own photograph; the conversation line is the Chats tab, which
            is that and nothing else. What is left is the only thing this page
            was ever for: which rooms are yours, and a way into one.

            So a door is what it draws — the letter on the group's own colour
            where somebody named it, and the people in it where nobody has.
            `RoomMark` holds both and the note on it holds the reasoning,
            including why a deck of members' own portraits is not the
            photograph rule being broken.

            What the block did carry alone was whether anybody is waiting, so
            that comes with it as a badge on the corner rather than as a line
            of prose underneath.
          */}
          {myRooms.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.sectionLabel, { color: t.dim }]}>YOUR GROUPS</Text>
              <View style={styles.doors}>
                {rooms.map((group) => {
                  return (
                    <Pressable
                      key={group.id}
                      onPress={() => onOpenGroup(group.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${group.title}, ${plural(
                        group.memberCount,
                        'person',
                        'people',
                      )}${group.unreadCount > 0 ? `, ${plural(group.unreadCount, 'new message')}` : ''}`}
                      style={({ pressed }) => [
                        styles.doorCell,
                        { width: cell, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      {/*
                        A box the size of the square, inside a cell that is
                        wider than it.

                        It exists for the badge below and for nothing else.
                        The badge hangs off the square's corner, and while the
                        square *was* the cell it could be positioned against
                        the cell and land there. The square is 0.7 of the cell
                        now, so the same absolute corner is 15 points out into
                        the gutter — a badge floating beside a door rather than
                        on it.
                      */}
                      <View style={{ width: tile }}>
                        {/* The letter, or the people. `RoomMark` sizes both
                            off the square it is given, which is why the
                            corner and the letter it works out are the same
                            fractions this screen already uses. */}
                        <RoomMark room={group} size={tile} t={t} />

                        {/*
                          Waiting messages, on the corner of the door.

                          The same 19pt accent pill the rest of the app uses
                          for this, with a ring in the page's own colour so it
                          reads as sitting on top of the icon rather than
                          painted into it. It is the one thing the block
                          underneath said that nothing on this page would
                          otherwise say.

                          Still a sibling of the door rather than a child of
                          it: a child would be hanging outside a rounded box,
                          and Android clips that where iOS does not. What it is
                          positioned against is the wrapper above, which is the
                          square's own width — so the corner is the same
                          corner.
                        */}
                        {group.unreadCount > 0 && (
                          <View
                            style={[
                              styles.unreadPill,
                              styles.doorUnread,
                              { backgroundColor: t.accent, borderColor: t.bg },
                            ]}
                          >
                            <Text style={[styles.unreadCount, { color: t.onAccent }]}>
                              {group.unreadCount > 99 ? '99+' : group.unreadCount}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/*
                        Two lines rather than one. A door is a square with a
                        letter in it, so the name under it is the only thing
                        telling two of them apart — and "Sunday Roast Cl…" at
                        a third of the screen's width is most group names.
                      */}
                      <Text style={[styles.doorName, { color: t.fg }]} numberOfLines={2}>
                        {group.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/*
            The rest, behind a word.

            Six doors is two rows, which is most people's rooms. Somebody in
            twelve groups would otherwise scroll past eight of them to reach
            the clusters below, and expanding in place rather than on a screen
            of its own keeps one place where a door is drawn.
          */}
          {myRooms.length > rooms.length && (
            <Pressable
              onPress={() => setAllGroups(true)}
              accessibilityRole="button"
              accessibilityLabel={`All groups, ${myRooms.length}`}
              style={({ pressed }) => [
                styles.allGroups,
                { borderColor: t.line, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.allGroupsText, { color: t.fg }]}>All groups</Text>
              <Text style={[styles.allGroupsCount, { color: t.dim }]}>{myRooms.length}</Text>
            </Pressable>
          )}

          {/*
            What the product noticed, at the foot of the rooms it already knows
            about. Never more than two, and a cluster whose people are already
            gathered in one of these groups is dropped by the server — which is
            what lets this stay without needing a way to dismiss it.

            A cluster opens the same page the `+` does, holding its people and
            its suggested name.
          */}
          {clusters.map((cluster) => (
            <ClusterCard
              key={cluster.key}
              cluster={cluster}
              onMake={() => onCreateGroupFrom(cluster)}
              t={t}
            />
          ))}

          {myRooms.length === 0 && clusters.length === 0 && (
            /*
              The fact, and nothing under it.

              This was four sentences on where groups come from and what the
              box above would and would not find. All true, and all of it
              addressed to somebody who has not asked a question yet — a
              paragraph in front of an empty screen is read as an apology for
              the screen being empty. What is left is the line that says why
              there is nothing here.
            */
            <Text style={[styles.body, { color: t.dim }]}>
              You are not in any groups yet.
            </Text>
          )}
        </>
      )}

      <View style={styles.results}>
        {(scope === 'people' || scope === 'all') &&
          people.map((person, i) => {
            /*
             * Where the two of you stand, with anything done from here on top.
             *
             * `standing` is what the server said when the list came back;
             * `sent` is what this screen has done since, and it wins — a row
             * that reverts to "Add" while the next keystroke's results are in
             * flight is a row offering to do a thing that is already done.
             */
            const standing = sent[person.actorId] ? 'asked' : (person.standing ?? 'none');
            return (
            <Result
              key={person.actorId}
              first={i === 0}
              t={t}
              /* The face `/api/people` sends, and the letter on their lens when
                 somebody has none. A list of handles is a list to read; the
                 picture is what makes it one to recognise, which is the point
                 of searching for a person rather than for a word. */
              avatar={person.avatar}
              seed={person.handle ?? person.actorId}
              /*
                The name bare and the handle under it, wearing the `@`.

                A result with no name written in used to read "@wren" on the
                first line and nothing on the second, so the one line that was
                the person's name was also the only place the sigil appeared.
                Now the second line always carries the handle — which is where
                the `@` means something — and the first is what somebody is
                called, which does not start with punctuation. Same rule as the
                top of the profile this row opens.
              */
              name={person.displayName?.trim() || person.handle || 'Someone'}
              under={person.handle ? `@${person.handle}` : null}
              /*
                The ask, on the row where somebody was found.

                Being findable leads to being asked and to nothing else, and
                the ask was two screens away: open their profile, press it,
                come back. It is the same `askFriend` the profile makes and the
                same one the suggestions above this list make.

                Only for a stranger. "Requested" is a word rather than a
                control — withdrawing is somebody's own to do and is done on
                their page, where there is room to say what it means — and an
                ask pointing at *you* is answered there too, beside the Decline
                that has to sit next to it.
              */
              action={
                standing === 'none' ? (
                  <Pressable
                    onPress={() => void ask(person.actorId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${person.handle ?? 'them'} as a friend`}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.resultDo,
                      { borderColor: t.line, backgroundColor: t.card, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={[styles.resultDoText, { color: t.fg }]}>Add</Text>
                  </Pressable>
                ) : standing === 'asked' ? (
                  <Text style={[styles.resultUnder, { color: t.dim }]}>Requested</Text>
                ) : standing === 'asking' ? (
                  <Text style={[styles.resultUnder, { color: t.dim }]}>Asked you</Text>
                ) : null
              }
              disabled={!person.handle}
              onPress={() => {
                if (!person.handle) return;
                remember(query);
                onOpenPerson(person.handle);
              }}
            />
            );
          })}

        {(scope === 'groups' || scope === 'all') &&
          groups.map((group, i) => (
            <Result
              key={group.id}
              first={i === 0}
              t={t}
              avatar={null}
              seed={group.id}
              name={group.name}
              under={null}
              aside={plural(group.memberCount, 'member')}
              onPress={() => {
                // The other half of "this was the search": opening a group it
                // found means the same as opening a person it found.
                remember(query);
                onOpenGroup(group.id);
              }}
            />
          ))}

        {/*
          Places is this person's own events grouped by where they were, so it
          answers without asking anything of the server — which is also why the
          two-character floor does not apply to it. The place itself opens in
          the maps app somebody already uses: a map view is a native module
          this codebase cannot test, and handing over the name gets them
          directions as well as a pin.
        */}
        {scope === 'places' &&
          places.map(([place, inPlace], i) => (
            <View key={place}>
              <Result
                first={i === 0}
                t={t}
                avatar={null}
                seed={place}
                name={place}
                under={plural(inPlace.length, 'event')}
                aside="Map ›"
                onPress={() =>
                  void Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(place)}`)
                }
              />
              {inPlace.map((event) => (
                <Pressable
                  key={event.id}
                  style={styles.placeEvent}
                  onPress={() => onOpen(event)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.small, { color: t.accent }]}>{event.name}</Text>
                </Pressable>
              ))}
            </View>
          ))}
      </View>

      {/*
        Nothing came back, said once and only after something was asked. The
        wording is per scope because "no handle starts with that" is a fact
        about handles and would be a lie about places.
      */}
      {scope === 'people' && asked && people.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>No handle starts with that.</Text>
      )}
      {scope === 'groups' && asked && groups.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>Nothing findable by that name.</Text>
      )}
      {/*
        One sentence for both namespaces, said only when both came back empty.
        Two lines — "no handle" and "no group" — under a box that asked both
        questions at once is the page reporting its own internals.
      */}
      {scope === 'all' && asked && people.length === 0 && groups.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          No handle or findable group by that name.
        </Text>
      )}
      {scope === 'places' && places.length === 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          {events.length === 0 || unplaced === events.length
            ? 'None of your albums say where they were yet. Whoever starts one can add a place, and it shows up here.'
            : 'No place of yours matches that.'}
        </Text>
      )}
      {scope === 'places' && unplaced > 0 && places.length > 0 && (
        <Text style={[styles.small, { color: t.dim }]}>
          {plural(unplaced, 'event')} without a place.
        </Text>
      )}

    </ScrollView>
  );
}

/** Which namespace the one field is asking. */
/**
 * What the box is asking, and — before anybody types — what the page shows.
 *
 * `all` is new and is the default. The chips used to decide only which
 * namespace a query went to, so an untouched Find was a field, three chips and
 * nothing else until somebody typed: a screen that answers questions and
 * volunteers nothing, on the tab somebody opens when they do not yet know what
 * they are looking for.
 *
 * So the chips now also decide what the page rests as. All is both halves —
 * people worth asking, then the groups you are in. The other two are each half
 * on its own, which is what a filter is for.
 */
type Scope = 'all' | 'people' | 'groups' | 'places';

const PLACEHOLDER: Record<Scope, string> = {
  all: 'A handle, or a group by name',
  people: 'A handle, or the start of one',
  groups: 'A group by name',
  places: 'Somewhere you have been',
};

/**
 * One row of a result list.
 *
 * A row with a hairline above it rather than a card: three bordered boxes make
 * three results look like three decisions, and most of these are a name
 * somebody is scanning past on the way to the one they meant.
 */
function Result({
  first,
  t,
  avatar,
  seed,
  name,
  under,
  aside,
  action,
  disabled,
  onPress,
}: {
  /** The first row has no rule above it — there is nothing to divide it from. */
  first: boolean;
  t: TabTheme;
  avatar: string | null;
  /** What the lens colour is keyed on, when there is no picture. */
  seed: string;
  name: string;
  under: string | null;
  aside?: string;
  /**
   * Something to do about this row, at the end of it.
   *
   * A node rather than a label because it is a control: a search result for
   * somebody you have not asked carries the ask, which is the one thing being
   * findable leads to in this product. Nested inside the row's own `Pressable`
   * quite deliberately — the inner one takes the touch, so pressing the button
   * asks and pressing anywhere else opens the profile.
   */
  action?: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  const lens = lensFor(seed);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.result,
        !first && { borderTopWidth: 1, borderTopColor: t.line },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {avatar ? (
        <Image
          source={{ uri: avatar }}
          style={[styles.resultFace, { backgroundColor: t.line }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={[styles.resultFace, styles.resultFaceBlank, { backgroundColor: lens.fill }]}>
          <Text style={[styles.resultLetter, { color: lens.ink }]}>{initialOf(name)}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.resultName, { color: t.fg }]} numberOfLines={1}>
          {name}
        </Text>
        {under && (
          <Text style={[styles.resultUnder, { color: t.dim }]} numberOfLines={1}>
            {under}
          </Text>
        )}
      </View>
      {aside && <Text style={[styles.resultUnder, { color: t.dim }]}>{aside}</Text>}
      {action}
    </Pressable>
  );
}

/**
 * Signing in — design §3, and the only reason accounts exist here.
 *
 * "Optional, asked for only after value has been delivered." An account holds
 * an email address and grants nothing an actor does not already have: its one
 * job is that a new phone is still you, which a credential in a keychain
 * cannot manage on its own. So it lives at the bottom of the profile tab and
 * nothing anywhere prompts for it.
 *
 * A code rather than a link, because mail often opens on a different device
 * from the one signing in — and setting up a new phone is exactly when that
 * happens.
 */
/**
 * Signing in, and the account once you have.
 *
 * Exported because three places now refuse without an account — creating an
 * event, adding photos, and a spoken code — and each wants the form in front
 * of the person rather than a sentence pointing at another tab. Those callers
 * pass `gate`, which drops the signed-in half: an upload prompt is no place
 * for a delete-account button.
 */
export function AccountCard({
  api,
  t,
  Button,
  onSignedIn,
  onSignedOut,
  why,
  gate = false,
}: {
  api: Api;
  t: TabTheme;
  Button: ButtonComponent;
  onSignedIn: () => void;
  /**
   * Give the device back. Only the profile tab passes it — the gated callers
   * are standing in front of an upload, and a sign-out button there is a way
   * to lose what you came to do.
   */
  onSignedOut?: () => void;
  /** What the person was trying to do, in their words rather than the policy's. */
  why?: string;
  /** Render nothing once signed in, for callers standing in front of an action. */
  gate?: boolean;
}) {
  const [account, setAccount] = useState<{ email: string } | null | undefined>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Whether to offer Face ID at all, decided after the first paint.
   *
   * False in Expo Go, in a build older than the native module, on an OS without
   * the APIs, and on a phone with no biometrics or passcode set. All four want
   * the same thing from this card: show the code and say nothing about
   * passkeys — which is why this gates the button rather than being reported as
   * a problem.
   *
   * ## Why an effect and not a plain call
   *
   * `passkeysSupported` reaches for a native module the first time it is asked,
   * and on a build without one that attempt fails. Failing is fine and handled;
   * doing it *during render* is not. Render runs again on every state change —
   * every keystroke in the address field, every button on this card — so a
   * module load on that path is a load attempted over and over, and anything it
   * logs on the way past is logged over and over with it.
   *
   * After the commit it happens once, the answer is state, and the render body
   * goes back to being a function of its inputs.
   */
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    setCanPasskey(passkeysSupported());
  }, []);
  /**
   * Standing between a finished sign-in and telling the caller about it.
   *
   * Set only on the sign-in that created the account, and only when there is no
   * passkey on it yet. `onSignedIn` is deliberately not called while this is
   * true: the caller replaces this card when it hears, and a card that has just
   * been replaced cannot ask anybody anything.
   */
  const [offer, setOffer] = useState(false);
  /** The devices and passkeys card, in place of the signed-in one. */
  const [managing, setManaging] = useState(false);

  /*
   * Who this device already is, and — for a gate — telling the caller so.
   *
   * A gate renders nothing once there is an account, which is right when the
   * caller is standing in front of an upload and wrong when the caller put
   * the gate up because it believed there was no account. Those two disagree
   * whenever the caller's answer is staler than this one, and the screen that
   * results is empty: no card, because there is an account, and no content,
   * because the caller is still waiting to be told there is.
   *
   * That is exactly what a cold start did to the tab gate. So discovering an
   * account is reported the same way arriving at one is — a gate that finds
   * somebody already signed in says so, and the caller replaces it with the
   * thing it was standing in front of.
   *
   * Only for `gate`. The profile draws this card signed in as well as signed
   * out, and calling back on every mount there would refetch the tab each
   * time it was looked at.
   */
  /*
   * Held in a ref so the effect below can call it without listing it.
   *
   * Every caller passes an inline arrow, so the prop has a new identity on
   * each render — in the dependency array it would re-run the effect every
   * render, which is a request to `/api/account/session` per frame.
   */
  const announce = useRef(onSignedIn);
  announce.current = onSignedIn;

  useEffect(() => {
    void api
      .account()
      .then((found) => {
        setAccount(found);
        // See the note above: a gate that finds an account must say so, or
        // the caller keeps the gate up over a card that draws nothing.
        if (found && gate) announce.current();
      })
      .catch(() => setAccount(null));
  }, [api, gate]);

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestSignIn(email.trim());
      setSent(true);
    } catch (err) {
      /*
       * One exception to "the server answers the same however it went".
       *
       * A 429 describes this caller, who already knows how many times they
       * have pressed the button, and says nothing about any address — so it
       * is the one refusal that can be repeated honestly. Folding it into
       * "try again in a moment" sent people back to press it again, which is
       * the one thing that could not help.
       */
      setError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Too many codes asked for from here. Try again in an hour.'
          : 'Could not ask for a code. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }, [api, email]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.completeSignIn(email.trim(), code);
      /*
       * The keychain, not just the client in memory.
       *
       * `completeSignIn` sets the token on the `Api` instance, which is enough
       * for the rest of this launch and nothing after it: the next cold start
       * reads the keychain, finds whatever was there before signing in — on a
       * new phone, nothing — and either carries on as the old actor or mints a
       * fresh guest. Somebody who had just made an account opened the app
       * again and was nobody.
       *
       * The token is also the one the account resolves to, which may not be
       * the one this device presented: signing in folds this actor into the
       * account's, and `result.merged` says when it did. Writing it here is
       * what makes that fold outlive the session.
       */
      await saveActorToken(result.actorToken);
      setAccount({ email: result.email });
      setSent(false);
      setCode('');
      if (result.merged) {
        // Said out loud rather than swapped silently: everything they added
        // on this phone has just become part of another identity, and that is
        // the point of signing in but it should not be a surprise.
        Alert.alert(
          'Signed in',
          'This phone has joined your account. Everything you added here is now part of it.',
        );
      }

      /*
       * The one moment worth interrupting for.
       *
       * Somebody who has just created an account also just fetched a code out of
       * a mail app, so "next time, use Face ID" lands where the cost of the
       * alternative is fresh. Later it is an interruption, and buried in the
       * profile tab it is a thing nobody goes looking for.
       *
       * Three conditions, each removing a case where this would be a nuisance:
       * only on the sign-in that made the account, only when there is no passkey
       * on it already, and only where this phone could make one.
       */
      if (result.created && !result.hasPasskey && canPasskey) {
        setOffer(true);
        return;
      }

      onSignedIn();
    } catch (err) {
      /*
       * A refused code and a refused *attempt* are different sentences.
       *
       * They used to be the same one, and it was the wrong one at exactly the
       * wrong moment: somebody holding a good code was told it had not worked,
       * so they asked for another — spending the allowance again — and were
       * told the same thing about that one. Nothing in the message pointed at
       * waiting, which was the only thing that would have helped.
       */
      setError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Too many tries from here. Wait an hour, then use the code you have.'
          : 'That code did not work. Codes expire after ten minutes.',
      );
    } finally {
      setBusy(false);
    }
  }, [api, code, email, onSignedIn]);

  /**
   * Signing in with a passkey, which is one press and no inbox.
   *
   * No offer afterwards: somebody who just used one has one. The token is
   * written to the keychain for the same reason the code path writes it — the
   * actor it names may not be the one this phone presented, because signing in
   * folds this device's identity into the account's.
   */
  const withPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithPasskey(api);
      if (!outcome.ok) {
        // A null note is a cancellation. They dismissed the sheet, and a red
        // line about it reads as a fault in the thing they declined.
        if (outcome.note) setError(outcome.note);
        return;
      }

      await saveActorToken(outcome.value.actorToken);
      setAccount({ email: outcome.value.email });
      if (outcome.value.merged) {
        Alert.alert(
          'Signed in',
          'This phone has joined your account. Everything you added here is now part of it.',
        );
      }
      onSignedIn();
    } finally {
      setBusy(false);
    }
  }, [api, onSignedIn]);

  /**
   * Taking the offer, or declining it. Either way the caller is told.
   *
   * A passkey that could not be made is not a failed sign-in — they are signed
   * in and the account exists — so a failure is said and the hand-off still
   * runs. Leaving somebody on this card with an error would turn a declined
   * extra into a dead end.
   */
  const keepPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await addPasskey(api);
      if (!outcome.ok && outcome.note) Alert.alert('Not added', outcome.note);
    } finally {
      setBusy(false);
      setOffer(false);
      onSignedIn();
    }
  }, [api, onSignedIn]);

  const declinePasskey = useCallback(() => {
    setOffer(false);
    onSignedIn();
  }, [onSignedIn]);

  /**
   * Signing out, with the cost said out loud first.
   *
   * The count of waiting uploads is in the question rather than in a sentence
   * under the button, because it is the only part of this that cannot be
   * undone by signing back in — the events come back with the account, and
   * those photographs do not. They are still in the camera roll, which is why
   * this is a warning and not a refusal.
   */
  const signOut = useCallback(async () => {
    const waiting = (await loadQueue().catch(() => ({ items: [] }))).items.length;
    Alert.alert(
      'Sign out?',
      waiting > 0
        ? `This phone forgets you and the albums it is holding links to. ${waiting} ${
            waiting === 1 ? 'photo' : 'photos'
          } waiting to upload will be dropped — they stay in your camera roll. Nothing else is deleted.`
        : 'This phone forgets you and the albums it is holding links to. Nothing is deleted, and the same address signs back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOutDevice();
            // The client keeps the token in memory as well as the keychain,
            // and the next request would carry it happily.
            api.setToken(null);
            setAccount(null);
            onSignedOut?.();
          },
        },
      ],
    );
  }, [api, onSignedOut]);

  const remove = useCallback(() => {
    // Two separate things, and conflating them would take other people's
    // copies of an evening they were also at. Guideline 5.1.1(v) requires the
    // first; the second is offered beside it rather than folded into it.
    Alert.alert(
      'Delete your account?',
      'Your email address and this account are removed. The photos you added stay in their albums and stay yours to remove.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            await api.deleteAccount(false).catch(() => {});
            setAccount(null);
          },
        },
        {
          text: 'Delete account and my photos',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteAccount(true).catch(() => null);
            setAccount(null);
            if (result) {
              Alert.alert('Deleted', `${result.photos} photos removed.`);
            }
          },
        },
      ],
    );
  }, [api]);

  if (account === undefined) return null;

  /*
   * Signed in already, being asked one question before carrying on.
   *
   * Its own return rather than a branch inside either card, because none of
   * either belongs on it: there is no address to type and nothing to sign out
   * of yet. Both buttons lead out, so there is no way to get stuck here.
   */
  if (offer) {
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>
          Next time, sign in with Face ID
        </Text>
        {/*
          Two sentences, because there are two moments and only one of them is
          fast. See the note on the web's offer card: the phone asks where to
          keep the key, and that prompt lands straight after a line promising no
          further steps. Naming the cost first is what keeps the payoff from
          reading as a promise that was not kept.
        */}
        <Text style={[styles.small, { color: t.dim }]}>
          Setting one up takes a moment — your phone will ask where to keep it.
          After that, signing in is Face ID and nothing else, with no code to
          fetch from your email.
        </Text>
        {/* Said plainly, because it is the question somebody actually has. A
            passkey that replaced the code would lock you out of your own
            photographs from a borrowed laptop. */}
        <Text style={[styles.small, { color: t.dim }]}>
          A code to your email still works whenever you need it. This is an
          extra, not a replacement.
        </Text>
        <Button
          label={busy ? 'Working…' : 'Add a passkey'}
          onPress={keepPasskey}
          disabled={busy}
          t={t}
          primary
        />
        <Button label="Not now" onPress={declinePasskey} disabled={busy} t={t} />
      </View>
    );
  }

  if (account) {
    if (gate) return null;
    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.label, { color: t.fg }]}>Signed in</Text>
        <Text style={[styles.body, { color: t.dim }]}>{account.email}</Text>
        <Text style={[styles.small, { color: t.dim }]}>
          Your albums and groups follow you to a new phone. That is all an
          account does here.
        </Text>
        {/* Sign out above delete, and only one of them is permanent. Both are
            plain buttons — a filled one here would be the loudest thing on a
            tab whose point is the events. */}
        {/* Above both, because it is the one of the three that is not about
            ending something: it is where somebody checks what is signed in and
            adds a passkey. */}
        <Button label="Devices and passkeys" onPress={() => setManaging(true)} t={t} />
        {onSignedOut && <Button label="Sign out" onPress={signOut} t={t} />}
        <Button label="Delete account" onPress={remove} t={t} />
        {/*
          Beside the card rather than in place of it, because `DevicesCard` is
          its own sheet now: a modal renders over everything wherever it sits in
          the tree, and swapping this card out for one would leave the screen
          underneath empty for as long as it was open — and empty again for a
          frame when it closed.
        */}
        {managing && (
          <DevicesCard api={api} t={t} Button={Button} onDone={() => setManaging(false)} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Text style={[styles.label, { color: t.fg }]}>
        {why ?? 'Keep these on a new phone'}
      </Text>
      <Text style={[styles.small, { color: t.dim }]}>
        {why
          ? 'No password — a code goes to your inbox, and your albums follow you to another device.'
          : 'Optional. Add an email and your albums and groups follow you to another device. No password — a code goes to your inbox.'}
      </Text>

      {/*
        The passkey first, for anybody who has one — it is the whole
        interaction, and a form above it is a form to look past every time.
        Drawn only where this phone could actually use one.
      */}
      {canPasskey && !sent && (
        <>
          <Button
            label={busy ? 'Working…' : 'Sign in with Face ID'}
            onPress={withPasskey}
            disabled={busy}
            t={t}
            primary
          />
          <Text style={[styles.small, { color: t.dim, textAlign: 'center' }]}>
            or use a code
          </Text>
        </>
      )}

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={t.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Your email address"
        style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
      />

      {sent && (
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-digit code"
          placeholderTextColor={t.dim}
          keyboardType="number-pad"
          // Lets iOS offer the code straight from the notification.
          textContentType="oneTimeCode"
          autoFocus
          accessibilityLabel="The code from your email"
          style={[styles.input, { color: t.fg, borderColor: t.line, backgroundColor: t.bg }]}
        />
      )}

      {error && <Text style={[styles.small, { color: t.dim }]}>{error}</Text>}

      <Button
        label={busy ? 'Working…' : sent ? 'Sign in' : 'Send me a code'}
        onPress={sent ? verify : request}
        disabled={busy || (sent ? code.length < 6 : !email.includes('@'))}
        t={t}
        primary
      />
      {sent && (
        <Text style={[styles.small, { color: t.dim }]}>
          Sent, if that address is one we can reach. It works once and expires
          in ten minutes — check spam if it is not there. Asking over and over
          stops the mail for an hour, so use the last one that arrived.
        </Text>
      )}
    </View>
  );
}

type ButtonComponent = (props: {
  label: string;
  onPress: () => void;
  t: TabTheme;
  primary?: boolean;
  disabled?: boolean;
}) => React.ReactElement;

const styles = StyleSheet.create({
  /* Room for the tab bubble, which floats over this rather than sitting under
     it: 28pt of gap plus 64pt of bubble, and a card's own margin past that.
     It was 150 while a second pill floated above the bubble, and 40 before
     either — which was already too little, so the last card on every tab
     ended up underneath the chrome. */
  /* `flexGrow` so a page that is still loading fills the screen and the
     spinner has somewhere to be the middle of. Inert once there are cards. */
  /*
   * 26 between cards, where it was 14.
   *
   * A card is four blocks tall now — a rule, a title, a byline, a photograph
   * and a strip — and at 14 the strip of one album sat as close to the rule of
   * the next as its own title sat to its own cover. The gap between two cards
   * has to be larger than any gap inside one, or the column stops reading as
   * separate evenings.
   *
   * `paddingBottom` grows with it: the last card's strip has to clear the
   * floating tab bubble, which is 28 from the bottom and about 70 tall.
   */
  scroll: { padding: 20, paddingTop: 72, paddingBottom: BELOW_TABS, gap: 26, flexGrow: 1 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  /* Two of them now, so they need a row of their own rather than each being a
     child of the space-between. Wide enough apart to be two targets. */
  headActions: { flexDirection: 'row', alignItems: 'baseline', gap: 18 },
  headAction: { fontSize: 14, fontWeight: '600' },
  h1: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  /* The photograph is the card: no border, no panel, no strip of chrome. What
     used to be `event` was a bordered box around a mosaic and a detail strip;
     what is left is a tall picture, some faces over its edge, and two lines. */
  /*
   * Edge to edge, and square.
   *
   * The scroll keeps its 20pt gutter for everything that is words; the
   * photograph steps back out of it. A rounded card inset from both sides is a
   * *card* — an object on a page, with the page showing around it — and the
   * subject of this screen is the photograph, not the container it arrived in.
   * At full width with square corners the picture is the card, which is what
   * the note at the top of `EventCard` claims and the 18pt radius was quietly
   * contradicting.
   *
   * The negative margin rather than a padding-free scroll: the alternative is
   * moving the gutter onto every text block separately, which is four places
   * to keep in step instead of one.
   */
  cover: { marginHorizontal: -20, overflow: 'hidden', backgroundColor: '#8881' },
  coverShot: { width: '100%', height: '100%' },
  /*
   * The recency mark: a pill of the photograph's own colours, top right.
   *
   * `overflow: 'hidden'` is what makes it a pill rather than a blurred square
   * — the `BlurView` inside it is `absoluteFill`, and without the clip it
   * paints the corners the radius is pretending are not there.
   *
   * The tint is under the blur and does two jobs: it is the contrast white
   * text needs on a cover that is a bright sky, and it is the whole of the
   * effect anywhere the blur does not land. The hairline is the glass's own
   * edge, which is what stops the pill reading as a hole in the picture.
   *
   * 10 from the corner, which is the number the web card uses; the text
   * column's 16 is a margin off the *screen* and this is a mark on a picture.
   */
  coverMark: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,12,14,0.34)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  /* White, not the theme's ink: this sits on a photograph rather than on the
     page, and the page is light or dark while a photograph is neither. 11 is
     the web pill's size and a size below everything else on this card — it is
     the newest thing on it and still the least important. */
  coverMarkText: { fontSize: 11, fontWeight: '500', color: '#ffffff' },
  /* Over the picture's bottom edge, not under it — see the note on the card.
     The negative margin is the overlap, and the row sits above the text it
     shares a column with.

     Aligned to that text rather than inset from the picture. While the cover
     was a rounded card, 14 from its left corner was the obvious reference;
     now that the photograph runs to the screen edge the only column left to
     line up with is the title underneath. */
  faces: { flexDirection: 'row', marginTop: -13, marginLeft: -4, marginBottom: 2 },
  /* 70% of the 34 these were. Every number in the stack is scaled with the
     circle rather than only its width — the ring, the overlap and the letter
     were all chosen against 34, and leaving any of them put would make a
     smaller face look heavier rather than smaller. The overlap onto the
     photograph above (`faces.marginTop`) scales for the same reason. */
  face: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    marginRight: -6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceShot: { width: '100%', height: '100%' },
  faceLetter: { fontSize: 8.5, fontWeight: '700' },
  faceMore: { paddingHorizontal: 2 },
  /*
   * The rule line above a card: the measurements, then a hairline to the edge.
   *
   * `marginHorizontal: -4` is the card's column, the same number the byline,
   * the faces and the title all answer to — see the note below on measuring
   * from the glass rather than from the scroll.
   */
  measured: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: -4, marginBottom: 6 },
  /*
   * Monospaced, which is the only face in this product that is.
   *
   * Deliberately the exception rather than a drift: everything else on a card
   * is somebody's evening described in words, and this line is two numbers and
   * a date — the label on the outside of the box. A monospaced small-cap line
   * is what that reads as, and at 10.5 points with a wide letter-spacing it is
   * quiet enough that nobody has to read it who is not looking for it.
   *
   * `Menlo` on iOS and `monospace` on Android: React Native has no `ui-
   * monospace` keyword, and a missing family silently falls back to the system
   * face — which would make the one deliberate exception look like a bug.
   */
  measuredText: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  rule: { flex: 1, height: 1 },
  /*
   * The album's name, at the head of the card's column.
   *
   * 24 with the tracking pulled in: at this size the default spacing reads as
   * loose, and this is the one line on the card set as a headline rather than
   * as text. `marginHorizontal: -4` is the column every other line answers to
   * — see the note below on measuring from the glass rather than the scroll.
   *
   * No shadow and no white. It is on the page again rather than on somebody's
   * photograph, so it is `fg` on the surface it sits on and the cover goes
   * back to being a photograph with nothing over it.
   */
  cardTitle: {
    marginHorizontal: -4,
    marginBottom: 2,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  /* The row under the cover: three photographs and a count, edge to edge.

     Full-bleed like the photograph above it rather than inset to the text
     column, because it is made of the same thing the photograph is. Four tiles
     with the same hairline the album's own grid uses — it is a strip of one
     album's contents, and matching the spacing of the grid it opens is what
     keeps it reading as a preview of that rather than as four cards.

     The tiles are sized in the card rather than here: they are a quarter of
     the screen, which is a number this stylesheet does not have. See
     `sheetTile`. */
  sheet: { flexDirection: 'row', gap: SHEET_GAP, marginHorizontal: -20, marginTop: 10 },
  sheetShot: { width: '100%', height: '100%' },
  /* No border any more: the glass behind it is the tile's edge, and a hairline
     round a block of colour in a row of borderless photographs was the one
     thing on the strip drawn as an object. */
  sheetRest: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * White, and the same in both schemes.
   *
   * It read `dim` on the page's own card colour, which followed the scheme
   * because its background did. The glass does not: the icon's field is the
   * icon's field at midnight, so the ink on it has to be fixed too.
   *
   * It was a dark plum, which is what the pastels underneath it wanted. The
   * field is dark now and the plum went with it — white is what the icon puts
   * on this surface, and it measures 5.9:1 at the worst point of the band the
   * digits occupy, the deep blue middle being the darkest part of the square
   * rather than the brightest.
   */
  sheetRestText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  /* The byline, above the photograph. Aligned to the same column as the title
     below it — `under`'s 4, so the face, the name and the date share an edge. */
  /*
   * The card's text column, and it answers to the screen rather than to the
   * scroll.
   *
   * Everything here used to sit at the scroll's 20 plus 4 of its own — 24 from
   * the glass, which was the right distance while the photograph was an inset
   * card and its corner was the thing being lined up with. The photograph runs
   * to the edge now, so the only edge left to measure from is the screen's,
   * and 24 read as a wide margin beside a picture with none at all.
   *
   * `-4` against the scroll's 20 puts the whole column at 16. One number, in
   * three places that must agree: the byline, the faces and the title block.
   */
  byline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: -4,
    paddingBottom: 10,
  },
  /* The part of the row that is a person, and therefore a control. Shrinks
     before the line beside it does, because a handle truncated to "kostopo…"
     is still recognisable and "· 8 peo…" is not a fact. */
  bylineWho: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  /*
   * A rounded square, not a circle.
   *
   * The profile's own picture is a rounded rectangle, and this is the same
   * person's face on the card that leads to it — a circle here and a soft
   * corner there is two shapes for one thing. The radius is a quarter of the
   * box, which is the proportion the profile's 104 by 26 already sets, so the
   * 28pt one on a card and the big one on a profile are the same corner at two
   * sizes rather than two decisions.
   *
   * The small circles further down the card stay circles: they are a crowd
   * read as an overlapping row, and that row only works as circles.
   */
  bylineFace: { width: 28, height: 28, borderRadius: 7, overflow: 'hidden' },
  bylineBlank: { alignItems: 'center', justifyContent: 'center' },
  bylineLetter: { fontSize: 12, fontWeight: '700' },
  bylineName: { flexShrink: 1, minWidth: 0, fontSize: 14.5, fontWeight: '700' },
  /* The card with nothing in it, which is mostly a button. Bordered, unlike
     the one that leads with a photograph: there is no picture to give it an
     edge, and a borderless block of text would not read as something to press. */
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  emptyLenses: { flexDirection: 'row', flex: 0 },
  emptyLens: { width: 30, height: 30, borderRadius: 15, marginRight: -8 },
  emptySlot: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlotMark: { fontSize: 13, fontWeight: '700' },
  /* 18 rather than 22. It is no longer the first thing on the card — the
     byline and the creator's name are both above it — and at 22 it went on
     competing with the photograph for the loudest thing in the column. */
  eventName: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  /* Wider apart than the cards on the other tabs: each group is three pieces
     stacked — a name, a strip of evenings and a line about the last one — and
     14 points between blocks made two groups read as one.

     `paddingTop` is this file's standing 72 rather than the design's 26: the
     mockup draws the status bar as a row of its own and measures from under
     it, and there is no safe-area library here — 72 is the one allowance every
     screen in this project already starts at. */
  groupsScroll: { padding: 20, paddingTop: 72, paddingBottom: BELOW_TABS, gap: 18, flexGrow: 1 },
  /* --- the shelf of doors on Find ----------------------------------------

     Three across, wrapping, with the gutters an album shelf uses. Gutters
     rather than hairlines for the same reason: these are separate rooms, not
     one object the way a wall of photographs would be. The edge, the corner
     and the letter are all worked out from the window — see `door`. */
  doors: { flexDirection: 'row', flexWrap: 'wrap', gap: GROUP_GAP },
  /* The column. It centres what is in it, which used to be automatic: the
     square filled the cell, so there was nothing to centre. It is 0.7 of it
     now and the name under it is the full width, so without this the icon sits
     against the leading edge of its own label. */
  doorCell: { alignItems: 'center' },
  door: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  /* Sized with the icon it fills, and weighted like the other letters on a
     lens in this app. */
  doorInitial: { fontWeight: '700' },
  /* On the corner, half off it. The ring is the page's own colour, which is
     what makes it read as sitting on the icon rather than inside it. */
  doorUnread: { position: 'absolute', top: -5, right: -5, borderWidth: 2 },
  /* Centred under the door, because the door is centred. Two lines at most —
     `numberOfLines` on the element holds that; this holds the rhythm.

     `alignSelf: 'stretch'` against the cell's `alignItems: 'center'`, which
     would otherwise size this to its own content: the name is the reason the
     column stayed at three, and it has to wrap at the column's width rather
     than at the icon's. */
  doorName: {
    alignSelf: 'stretch',
    marginTop: 7,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  /* One conversation, as one line. Shared by a group row and an event chat. */
  sayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sayerFace: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sayerInitial: { fontSize: 11, fontWeight: '700' },
  said: { flex: 1, minWidth: 0, fontSize: 13.5 },
  /* The name carries the weight; the message is the same size beside it. */
  sayer: { fontWeight: '600' },
  saidWhen: { fontSize: 12.5 },
  /* A number on a group — it is busy and the number is the useful part. */
  /* Exactly a `RoundButton`, drawing nothing. Sized from the same constant so
     the two cannot drift apart. */
  roundSlot: { width: ROUND, height: ROUND },

  /* The first paint, before there is a page to draw. Centred in the tab rather
     than under a heading, because there is no heading yet. */
  groupsLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  /* A row rather than a link: it is the foot of a list and it is the width of
     one, so a word floating on the left would read as a caption on the group
     above it. */
  allGroups: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  allGroupsText: { fontSize: 15, fontWeight: '600' },
  allGroupsCount: { fontSize: 13.5 },
  /* The mobile unread pill, moved onto the corner of a disc: same 19pt, same
     accent fill, same ink. The ring is the page behind it, so the badge reads
     as sitting on top of the button rather than inside it. */
  unreadPill: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: { fontSize: 11.5, fontWeight: '700' },
  /* A dot on an event chat — usually one or two messages, and a count there is
     precision nobody asked for. */
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  /* The one-off evenings, under a label rather than a heading: they are the
     minor half of this screen and a 30pt title would say otherwise. */
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.7, paddingBottom: 4 },
  /* --- people you may know -----------------------------------------------

     A row that scrolls across a page that scrolls down. The page is padded 20
     all round, so the row cancels that with a negative margin and puts it back
     as content padding — which is what lets a card sit half off the right edge
     instead of stopping neatly at the margin. A row that ends at the margin
     reads as a row that has ended. */
  suggestBleed: { marginHorizontal: -20 },
  suggestRow: { paddingHorizontal: 20, gap: 10 },
  suggest: {
    width: 128,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  /* A rounded square, like every other face in this product outside the
     overlapping stack on an album's cover. */
  suggestFace: { width: 54, height: 54, borderRadius: 14 },
  suggestInitial: { fontSize: 21, fontWeight: '600' },
  suggestName: { fontSize: 14, fontWeight: '600', maxWidth: 108, textAlign: 'center' },
  suggestWhy: { fontSize: 12 },
  suggestAdd: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 18 },
  suggestAddText: { fontSize: 13.5, fontWeight: '600' },
  /*
   * An empty page, on the two tabs that can be one.
   *
   * The same three numbers as the profile's `noAlbums`, plus the room the
   * list would have taken: a note, a gap, and the `+` under it, all centred.
   * Held here rather than per-tab so the shape cannot drift between the
   * screens that use it — which is the whole reason it is shared.
   */
  blank: { alignItems: 'center', gap: 14, paddingTop: 40 },
  blankNote: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  /*
   * The block at the foot of the card: the newest reply and the counts.
   *
   * `-12` is the card's own column shifted out by the 8 points of padding
   * this adds — `-4` for the column and `-8` for the touch target — so the
   * words inside it line up with the name and the byline above while the
   * press wash reaches past them. A tap target that is only as big as its
   * text is a tap target people miss.
   *
   * `gap: 10` between the reply and the ledger, which is enough that they are
   * two things and not so much that they stop being one errand.
   */
  reply: {
    marginHorizontal: -12,
    marginTop: 4,
    paddingTop: 10,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: 10,
    gap: 10,
  },
  /* Face, then words. `flex-start` so a two-line reply keeps its face beside
     the first line rather than centred against both. */
  replyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  /* The 22pt circle `sayerFace` already draws, lifted a point: the cap height
     of the line beside it sits just above the middle of the circle, and
     without this the face reads as hanging below the name. */
  replyFace: { marginTop: -1 },
  /*
   * The words, in `dim`, with the name in `fg` inside them.
   *
   * `minWidth: 0` beside `flex: 1`, or a long unbroken word — a URL, usually
   * — pushes the column wider than the card instead of wrapping.
   *
   * Two lines, and it truncates rather than wrapping on: the card is a
   * summary and a paragraph in it is the thread.
   */
  replyLine: { flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 20 },
  /* The name carries the weight and the colour; the words carry neither. That
     is how a line of dialogue reads without a second size. */
  replyWho: { fontWeight: '700' },
  /* The same row as `measured` at the head of the card, with a chevron on the
     end. No horizontal margin of its own — the block around it has it. */
  /*
   * 10 between the pieces, where the head line has 8.
   *
   * The row holds two tallies rather than one run of words, and the gap
   * inside a tally — glyph to digit — has to be clearly the smaller of the
   * two or the four things read as four things. 3 and 10 is that; 4 and 8 was
   * tried first and the pairs did not hold together.
   */
  ledger: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tally: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  /*
   * The ledger's face, without the tracking.
   *
   * Monospaced and 10.5 like the line at the card's head, because this is
   * still the same kind of line and a number set in the body face beside a
   * glyph reads as a caption. What goes is the 1.5 of letter-spacing and the
   * uppercase: both are for words, and a two-digit number carrying trailing
   * space sits visibly off its own glyph.
   */
  tallyText: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 10.5,
    fontWeight: '600',
  },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  chatThumb: { width: 40, height: 40, borderRadius: 10 },
  /* The mark a room wears where the lens tile used to be. See `RoomMark`. */
  markCentre: { alignItems: 'center', justifyContent: 'center' },
  markCard: { position: 'absolute', overflow: 'hidden', borderWidth: 1.5 },
  markShot: { width: '100%', height: '100%' },
  /* The same square an album's cover fills, holding a letter instead. Centred,
     and sized to its own tile rather than to the product: every letter on a
     lens in this app is set to the box it is in. */
  chatLetter: { alignItems: 'center', justifyContent: 'center' },
  chatInitial: { fontSize: 17, fontWeight: '600' },
  chatName: { fontSize: 15, fontWeight: '600' },
  /* --- Find -------------------------------------------------------------
     One field, three chips, and rows under a hairline. Everything here
     replaced three bordered cards with a heading and a paragraph each. */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  /* No padding of its own: the box has it, and a field with both is a caret
     that starts a quarter of an inch from the magnifier. */
  fieldText: { flex: 1, fontSize: 16, padding: 0 },
  /* Set below the field's own text: it is the way out of a search, not a
     second thing to read while typing one. */
  clear: { fontSize: 15 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  chipText: { fontSize: 13.5 },
  chipTextOn: { fontWeight: '600' },
  results: { },
  /* A hairline between rows rather than a border around each: three bordered
     boxes make three results look like three decisions. */
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  resultFace: { width: 38, height: 38, borderRadius: 10 },
  resultFaceBlank: { alignItems: 'center', justifyContent: 'center' },
  resultLetter: { fontSize: 14, fontWeight: '700' },
  resultName: { fontSize: 15.5, fontWeight: '600' },
  resultUnder: { fontSize: 13 },
  /* The ask, at the end of a result. The pill the profile's own controls wear,
     at the size a 38pt row can carry: a bordered word, never a filled button —
     a row of accent rectangles down a list of strangers reads as a page urging
     you to add them. */
  resultDo: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  resultDoText: { fontSize: 13, fontWeight: '600' },
  /* What was typed before, as chips that wrap. The same bordered pill the
     scope chips above wear, at the size of a word rather than a control. */
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  recentText: { fontSize: 14, maxWidth: 220 },
  placeEvent: { paddingVertical: 6, paddingLeft: 50 },
});
