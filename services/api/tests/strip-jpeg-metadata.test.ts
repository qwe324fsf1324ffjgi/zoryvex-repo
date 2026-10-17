import { describe, expect, it } from 'vitest';
import { stripJpegMetadata } from '../src/lib/strip-jpeg-metadata';

function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const JFIF_APP0_PAYLOAD = [
  0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
];
const FAKE_EXIF_PAYLOAD = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xaa, 0xbb, 0xcc]; // "Exif\0\0" + fake data
const FAKE_COMMENT_PAYLOAD = [0x68, 0x65, 0x6c, 0x6c, 0x6f]; // "hello"

function buildTestJpeg(): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = jpegSegment(0xe0, JFIF_APP0_PAYLOAD);
  const app1Exif = jpegSegment(0xe1, FAKE_EXIF_PAYLOAD);
  const com = jpegSegment(0xfe, FAKE_COMMENT_PAYLOAD);
  const sos = jpegSegment(0xda, [0x00, 0x01, 0x02]);
  const scanData = [0x11, 0x22, 0x33, 0x44];
  const eoi = [0xff, 0xd9];
  return new Uint8Array([...soi, ...app0, ...app1Exif, ...com, ...sos, ...scanData, ...eoi]);
}

function containsSubsequence(haystack: Uint8Array, needle: number[]): boolean {
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((byte, offset) => haystack[i + offset] === byte)) return true;
  }
  return false;
}

describe('stripJpegMetadata', () => {
  it('removes the EXIF (APP1) segment', () => {
    const result = stripJpegMetadata(buildTestJpeg());
    expect(containsSubsequence(result, FAKE_EXIF_PAYLOAD)).toBe(false);
  });

  it('removes the comment (COM) segment', () => {
    const result = stripJpegMetadata(buildTestJpeg());
    expect(containsSubsequence(result, FAKE_COMMENT_PAYLOAD)).toBe(false);
  });

  it('keeps the APP0/JFIF header (structural, not identifying metadata)', () => {
    const result = stripJpegMetadata(buildTestJpeg());
    expect(containsSubsequence(result, JFIF_APP0_PAYLOAD)).toBe(true);
  });

  it('keeps the SOS header, scan data, and EOI byte-for-byte', () => {
    const result = stripJpegMetadata(buildTestJpeg());
    expect(containsSubsequence(result, [0xff, 0xda, 0x00, 0x05, 0x00, 0x01, 0x02])).toBe(true);
    expect(containsSubsequence(result, [0x11, 0x22, 0x33, 0x44, 0xff, 0xd9])).toBe(true);
  });

  it('starts with SOI and the result is shorter than the input (metadata actually removed)', () => {
    const input = buildTestJpeg();
    const result = stripJpegMetadata(input);
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
    expect(result.length).toBeLessThan(input.length);
  });

  it('throws on a non-JPEG input rather than silently returning something', () => {
    expect(() => stripJpegMetadata(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow();
  });
});
