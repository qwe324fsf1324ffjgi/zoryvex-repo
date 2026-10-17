/**
 * Dependency-free JPEG metadata stripper. Removes every APPn segment
 * (EXIF/XMP/Photoshop-IPTC/etc, markers 0xE1-0xEF) and COM (0xFE) segments,
 * keeping APP0 (the standard JFIF header, not identifying metadata) plus
 * every segment actually needed to decode the image. Chosen over pulling in
 * `sharp` (already a dependency elsewhere in this repo, for a one-off local
 * asset-prep script) because sharp's native per-platform binary would need
 * careful, risk-prone Lambda-bundle wiring for a Linux target this sandbox
 * cannot verify end-to-end — see docs/DECISIONS.md.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new Error('Not a JPEG (missing SOI marker)');
  }

  const chunks: Uint8Array[] = [input.subarray(0, 2)];
  let offset = 2;

  while (offset < input.length) {
    if (input[offset] !== 0xff) {
      throw new Error('Malformed JPEG: expected a marker');
    }
    const marker = input[offset + 1];

    if (marker === 0xd9) {
      chunks.push(input.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(input.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > input.length) throw new Error('Malformed JPEG: truncated segment header');
    const length = (input[offset + 2]! << 8) | input[offset + 3]!;
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > input.length) throw new Error('Malformed JPEG: truncated segment');

    const isApp = marker !== undefined && marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    const isJfifApp0 = marker === 0xe0;

    if ((isApp && !isJfifApp0) || isComment) {
      offset = segmentEnd; // drop: metadata segment
      continue;
    }

    chunks.push(input.subarray(offset, segmentEnd));
    offset = segmentEnd;

    if (marker === 0xda) {
      // Start Of Scan — the rest is entropy-coded image data (plus RST
      // markers and the trailing EOI), never more segments to parse.
      chunks.push(input.subarray(offset));
      offset = input.length;
    }
  }

  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}
