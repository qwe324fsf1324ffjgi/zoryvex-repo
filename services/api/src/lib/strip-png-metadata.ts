const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Keeps only chunk types needed to decode/render the image correctly;
 * drops everything else, including every text/EXIF/time metadata chunk
 * (tEXt, zTXt, iTXt, eXIf, tIME, hIST, sPLt) and any unrecognized ancillary
 * chunk — a conservative default, since anything not on this list could
 * carry identifying data. See strip-jpeg-metadata.ts for why this is
 * hand-rolled rather than using `sharp`.
 */
const KEEP_CHUNK_TYPES = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'bKGD',
  'pHYs',
  'sBIT',
]);

export function stripPngMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 8 || !PNG_SIGNATURE.every((byte, index) => input[index] === byte)) {
    throw new Error('Not a PNG (missing signature)');
  }

  const chunks: Uint8Array[] = [input.subarray(0, 8)];
  let offset = 8;

  while (offset < input.length) {
    if (offset + 8 > input.length) throw new Error('Malformed PNG: truncated chunk header');
    const dataLength = new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
    const type = String.fromCharCode(
      input[offset + 4]!,
      input[offset + 5]!,
      input[offset + 6]!,
      input[offset + 7]!,
    );
    const chunkEnd = offset + 8 + dataLength + 4; // 8-byte header + data + 4-byte CRC
    if (chunkEnd > input.length) throw new Error('Malformed PNG: truncated chunk');

    if (KEEP_CHUNK_TYPES.has(type)) {
      chunks.push(input.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}
