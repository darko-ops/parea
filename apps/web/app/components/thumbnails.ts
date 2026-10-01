/**
 * Small previews of photos somebody has just picked.
 *
 * The create-roll page used to point an `<img>` at each original. On a recent
 * iPhone an original is 24 or 48 megapixels, and Safari keeps every one it is
 * showing decoded at full size — tens to hundreds of megabytes each, all at
 * once. A handful of photos was enough for iOS to kill the tab mid-upload, and
 * a killed tab loses the photos it was lent (see `secure` in the upload store).
 *
 * So each preview is made once, at `PREVIEW_EDGE`, one file at a time: decode,
 * draw small, encode a little JPEG, let the big decode go. The page then holds
 * a strip of thumbnails rather than a strip of originals.
 */

/** The longest side of a preview, in pixels — enough for a 2× strip tile. */
export const PREVIEW_EDGE = 320;

/** A made preview: its blob URL, and its size, which is the photo's shape. */
export type Thumbnail = { url: string; width: number; height: number };

/**
 * A blob URL for a small preview of `file`, or null when this browser cannot
 * make one — no `createImageBitmap`, or a format it will not decode (HEIC in
 * Chrome). The caller decides what to show instead.
 */
export async function thumbnailUrl(file: File, edge = PREVIEW_EDGE): Promise<string | null> {
  return (await thumbnail(file, edge))?.url ?? null;
}

/**
 * The same, with the drawn size — so a gallery can reserve the photo's real
 * shape before the server has measured it. See `useUploadPreviews`.
 */
export async function thumbnail(file: File, edge = PREVIEW_EDGE): Promise<Thumbnail | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    // Asking for the size up front lets a browser decode small; one that
    // ignores the option still gets drawn down to size below.
    bitmap = await createImageBitmap(file, { resizeWidth: edge, resizeQuality: 'medium' });
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    );
    // Release the canvas's backing store now rather than at collection.
    canvas.width = 0;
    canvas.height = 0;
    return blob ? { url: URL.createObjectURL(blob), width, height } : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
