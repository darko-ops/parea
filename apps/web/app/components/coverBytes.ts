'use client';

/**
 * The bytes a cover is sent as, from either screen that sends one.
 *
 * Shared rather than copied, because the two callers are the two moments an
 * event's cover is decided — when it is made, and when somebody changes their
 * mind — and a picture that came out different depending on which one you used
 * would be a bug nobody could see.
 */

/** Big enough to crop from, small enough to post from a phone connection. */
const EDGE = 1600;

/**
 * Pixels out of a picked file, by whichever decoder this platform will admit.
 *
 * `createImageBitmap` is the one to want: it is fast, it does not need an
 * element, and it releases on demand. It is also not enough on its own. Safari
 * refuses it on an HEIC while rendering that same HEIC in an `<img>` perfectly
 * well — and an HEIC is what an iPhone hands over, so the file people actually
 * choose is the file the fast path drops.
 *
 * The consequence used to be invisible and expensive. `coverBytes` fell back to
 * posting the original, the server sniffed `image/heic`, handed it to libheif
 * and got `bad seek` — a cover that silently did not save, on the format most
 * covers arrive in. Reaching for the element decoder is what makes the fallback
 * unnecessary.
 */
async function pixelsOf(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  try {
    let source: CanvasImageSource;
    let width: number;
    let height: number;

    try {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      // The decoder the browser puts behind `<img>`, which is a different and
      // usually wider set of formats than the one behind `createImageBitmap`.
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      source = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    }

    if (!width || !height) return null;

    const scale = Math.min(1, EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
  } catch {
    // A format neither decoder reads, a tainted canvas, a File whose handle
    // died between picking and sending. All three mean there are no pixels.
    return null;
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * The bytes to send for a cover, or null when this device cannot make any.
 *
 * Drawn through a canvas at a sane size first, which does three things at
 * once: the request becomes a couple of hundred kilobytes instead of twelve
 * megabytes — and on the create screen it is made while somebody waits to land
 * in the event — the re-encode drops whatever the camera wrote into the file
 * before it leaves the device at all, and the server is handed a JPEG rather
 * than whatever the phone calls a photograph.
 *
 * Null rather than the original file when every decoder fails, and that is the
 * point of the return type. Posting bytes this device could not read is a
 * request whose only possible answer is 400, and both callers used to make it
 * and then ignore the answer — which is how "my cover did not save" happened
 * with nothing anywhere to say so. A caller that has to handle null is a caller
 * that cannot quietly do nothing.
 *
 * The exception is a format the server is certain of. A JPEG, PNG or WebP that
 * this browser would not draw — a canvas tainted by something, a decoder that
 * gave up — is still a file libvips opens without difficulty, and sending it is
 * strictly better than refusing on the client's behalf. HEIC is not on that
 * list precisely because it is the case that does not survive the trip.
 */
export async function coverBytes(file: File): Promise<Blob | null> {
  const drawn = await pixelsOf(file);
  if (drawn) return drawn;

  const type = file.type.toLowerCase().split(';')[0]!.trim();
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
    return file;
  }
  return null;
}
