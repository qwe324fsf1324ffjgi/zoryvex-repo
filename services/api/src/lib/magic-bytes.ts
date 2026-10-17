/**
 * Bounded, dependency-free magic-byte check for exactly the four
 * evidence-upload MIME types this app allows (@zoryvex/contracts'
 * ALLOWED_EVIDENCE_MIME_TYPES) — never trusts the client-supplied
 * Content-Type alone. text/plain has no signature, so it is instead
 * checked for the *absence* of binary content (a NUL byte, or too high a
 * proportion of non-printable bytes in the sample).
 */
export function bytesMatchClaimedType(bytes: Uint8Array, claimedMimeType: string): boolean {
  switch (claimedMimeType) {
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'text/plain':
      return looksLikePlainText(bytes);
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function looksLikePlainText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  if (sample.length === 0) return true;
  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 0x00) return false; // NUL byte — never valid in text
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isUtf8Continuation = byte >= 0x80; // permissive: allow UTF-8 text
    if (!isPrintableAscii && !isWhitespace && !isUtf8Continuation) nonPrintable += 1;
  }
  return nonPrintable / sample.length < 0.05;
}
