/**
 * The picture on a shared link's card.
 *
 * The icon and the wordmark, and deliberately nothing about the event — no
 * name, no caption, no photograph. Whatever is in this image is handed to
 * anything that fetches the URL, and unlike the title it is a *picture*, which
 * is the thing this product exists to keep between the people who were there.
 * Same image for every link, so there is nothing in it to leak.
 *
 * ## It is the app icon's surface now
 *
 * It was the pale mark on white: correct as a drawing, and the reason the card
 * looked like nothing at all in a list of link previews, which is exactly where
 * a card is seen. A preview sits among other people's previews and is the size
 * of a thumbnail, so it competes the way an app icon on a home screen competes,
 * and the product already had an answer for that — the field the phone's icon
 * carries. So the background is that field, and the mark on it is the icon's
 * own: three circles punched white out of the colour under `evenodd`, rather
 * than the seven pale fills the page version paints.
 *
 * ## It was a fourth drawing of the mark, and it disagreed with the other three
 *
 * Worth keeping the history, because it is why the gradient is mirrored into
 * `appIcon.ts` and compared in a test rather than trusted. This file used to
 * carry three flat circles at 72% alpha in colours that appeared nowhere else
 * in the product, with a comment claiming it was "the same six numbers as
 * `app/icon.svg`". The geometry was; everything else was its own, and nobody
 * noticed for months, because a link card is the one surface a developer never
 * looks at.
 *
 * Cached hard: it never changes, and every unfurl of every link asks for it.
 */

import { ImageResponse } from 'next/og';

import { fieldSvg, symbolSvg } from '@/appIcon';

export const runtime = 'nodejs';

/** The card. Square, because iMessage crops a wide image to a square
    thumbnail and the mark is the one thing in here that must not be cropped. */
const BOX = 640;

/**
 * How big the mark is drawn.
 *
 * Smaller than the icon's own proportion, because the icon has nothing under
 * it and this has a word. 300 in 640 leaves the wordmark its line and the pair
 * of them a margin, and keeps the mark and the word closer in size than the
 * icon's margin would allow.
 */
const MARK = 300;

/*
 * Both handed over as data URIs rather than drawn as elements.
 *
 * `next/og` lays out a subset of CSS with Satori and rasterises SVG through
 * resvg. Six stacked radial gradients and an even-odd fill are both things
 * resvg draws exactly and Satori's CSS subset does not, so the way to get the
 * real field and the real mark is to hand over finished SVG documents and let
 * the rasteriser do what it is good at.
 */
const FIELD = `data:image/svg+xml;utf8,${encodeURIComponent(fieldSvg(BOX))}`;
const SYMBOL = `data:image/svg+xml;utf8,${encodeURIComponent(symbolSvg(MARK))}`;

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Under the field, so a renderer that fails to fetch the data URI
          // gets the icon's own base colour rather than a white card with a
          // word floating on it.
          background: '#173EA8',
          fontFamily: 'sans-serif',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={FIELD}
          width={BOX}
          height={BOX}
          alt=""
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 28,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SYMBOL} width={MARK} height={MARK} alt="" />
          {/*
            Lowercase, and tracked in rather than out. `PAREA` at +12 read as
            an institution — an architecture practice, or something with a
            quarterly report — and spacing the letters apart is the opposite of
            what the mark above it means. Negative tracking at this size,
            matching the `.wordmark` rule the site uses.

            White, like the mark, because on this field there is one ink.
          */}
          <div style={{ fontSize: 84, letterSpacing: -1.7, color: '#ffffff' }}>parea</div>
        </div>
      </div>
    ),
    { width: BOX, height: BOX },
  );
}
