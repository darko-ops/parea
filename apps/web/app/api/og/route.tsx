/**
 * The picture on a shared link's card.
 *
 * The mark and the wordmark, and deliberately nothing about the album — no
 * name, no caption, no photograph. Whatever is in this image is handed to
 * anything that fetches the URL, and unlike the title it is a *picture*, which
 * is the thing this product exists to keep between the people who were there.
 * Same image for every link, so there is nothing in it to leak.
 *
 * Drawn rather than served from a file. There is a PNG of this mark in the
 * native app's assets and copying it here would be the same artwork committed
 * twice, drifting the first time somebody edits one — the geometry is six
 * numbers and they are the same six as `app/icon.svg`.
 *
 * Cached hard: it never changes, and every unfurl of every link asks for it.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

/*
 * `icon.svg` draws circles of radius 184 with centres 134 from the middle, so
 * the artwork is 636 across. Scaled to 400 here to leave the wordmark room and
 * the frame a margin; the ratio between the two numbers is the design and is
 * what is preserved.
 */
const SCALE = 400 / (2 * (184 + 134));
const R = 184 * SCALE;
const OFFSET = 134 * SCALE;
/** The square the three circles are laid out in. */
const BOX = 2 * (R + OFFSET);

/** Straight up, then 120° apart. The three people who were there. */
const CENTRES = [0, 120, 240].map((degrees) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: Math.cos(radians) * OFFSET, y: Math.sin(radians) * OFFSET };
});

const COLOURS = ['rgba(244,114,140,.72)', 'rgba(124,150,255,.72)', 'rgba(110,214,169,.72)'];

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
        <div style={{ position: 'relative', display: 'flex', width: BOX, height: BOX }}>
          {CENTRES.map((centre, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: BOX / 2 + centre.x - R,
                top: BOX / 2 + centre.y - R,
                width: 2 * R,
                height: 2 * R,
                borderRadius: '50%',
                background: COLOURS[i],
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 84, letterSpacing: 12, color: '#14171c' }}>PAREA</div>
      </div>
    ),
    // Square. iMessage crops a wide image to a square thumbnail and the mark
    // is the one thing in here that must not be cropped.
    { width: 640, height: 640 },
  );
}
