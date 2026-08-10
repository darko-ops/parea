/**
 * CRC-32 (IEEE), computed at ingest and stored per photo.
 *
 * Not for integrity checking. It is what lets the download Worker emit a
 * streaming zip with an exact `Content-Length` (design §10): a STORE-method
 * archive's byte layout is fully determined by the members' sizes, names and
 * CRCs, so precomputing them here turns a 1GB download from an indeterminate
 * spinner into a real progress bar — and makes Range-resume implementable
 * later without changing the format.
 *
 * Computing it at ingest means the zip endpoint never has to read a photo it
 * is only going to stream through.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
