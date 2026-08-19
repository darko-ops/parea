/**
 * The picture on a shared link's card.
 *
 * The mark and the wordmark, and deliberately nothing about the album — no
 * name, no caption, no photograph. Whatever is in this image is handed to
 * anything that fetches the URL, and unlike the title it is a *picture*, which
 * is the thing this product exists to keep between the people who were there.
 * Same image for every link, so there is nothing in it to leak.
 *
 * ## It was a fourth drawing of the mark, and it disagreed with the other three
 *
 * The file said the geometry was "the same six numbers as `app/icon.svg`", and
 * the *geometry* was. Everything else was its own: three flat circles at 72%
 * alpha in colours appearing nowhere else in the product, letting the browser
 * composite the overlaps. That is exactly what `icon.svg` argues against —
 * alpha decides those four regions for us, and the one place the design wants
 * warmth comes out muddy. It also softened every edge, which is the thing that
 * made the mark look fragile.
 *
 * So it is the real drawing now: one SVG, built from `Mark.tsx`'s own numbers
 * and fills, with the seven regions painted explicitly and no transparency
 * anywhere. `brand.test.ts` checks this file against the others, which it
 * never did — which is how three copies drifted into four.
 *
 * Cached hard: it never changes, and every unfurl of every link asks for it.
 */

import { ImageResponse } from 'next/og';

import { markSvg } from '@/../app/components/Mark';

export const runtime = 'nodejs';

/**
 * How big the mark is drawn, in a 640px square.
 *
 * The artwork carries its own margin inside the 1024 viewBox, so this is the
 * whole box rather than the circles — 400 leaves the wordmark room underneath
 * and the frame a margin around both.
 */
const SIZE = 400;

/**
 * The mark as a data URI, because Satori has no `clipPath`.
 *
 * `next/og` lays out a subset of CSS and rasterises SVG through resvg, which
 * does support clipping — so handing it the finished SVG gets the real mark,
 * where drawing it as positioned `<div>`s could only ever get three circles
 * and whatever alpha compositing made of them.
 */
const MARK = `data:image/svg+xml;utf8,${encodeURIComponent(markSvg(SIZE))}`;

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
          background: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK} width={SIZE} height={SIZE} alt="" />
        {/*
          Lowercase, and tracked in rather than out. `PAREA` at +12 read as an
          institution — an architecture practice, or something with a quarterly
          report — and spacing the letters apart is the opposite of what the
          mark beside it means. Negative tracking at this size, matching the
          `.wordmark` rule the site uses.
        */}
        <div style={{ fontSize: 84, letterSpacing: -1.7, color: '#14171c' }}>parea</div>
      </div>
    ),
    // Square. iMessage crops a wide image to a square thumbnail and the mark
    // is the one thing in here that must not be cropped.
    { width: 640, height: 640 },
  );
}
