'use client';

/**
 * The bytes a cover is sent as, from either screen that sends one.
 *
 * Shared rather than copied, because the two callers are the two moments an
 * album's cover is decided — when it is made, and when somebody changes their
 * mind — and a picture that came out different depending on which one you used
 * would be a bug nobody could see.
 */

/**
 * The bytes to send for a cover.
 *
 * Drawn through a canvas at a sane size first, which does three things at
 * once: the request becomes a couple of hundred kilobytes instead of twelve
 * megabytes — and on the create screen it is made while somebody waits to land
 * in the album — the re-encode drops whatever the camera wrote into the file
 * before it leaves the device at all, and the server is handed a JPEG rather
 * than whatever the phone calls a photograph. `createImageBitmap` decodes HEIC on
 * the platforms that have a decoder, which is the same set of platforms whose
 * users would otherwise be told their photograph is not an image.
 *
 * Falls back to the original file if any of that is unavailable. The server
 * re-encodes regardless, so the fallback is slower and not wrong.
 */
export async function coverBytes(file: File): Promise<Blob> {
  const EDGE = 1600;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (blob) return blob;
  } catch {
    // A format this browser cannot decode, a tainted canvas, a File whose
    // handle died between picking and creating. All three want the original.
  }
  return file;
}
