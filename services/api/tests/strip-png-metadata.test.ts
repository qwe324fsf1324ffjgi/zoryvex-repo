import { describe, expect, it } from 'vitest';
import { stripPngMetadata } from '../src/lib/strip-png-metadata';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const crc = [0, 0, 0, 0]; // dummy — the stripper never validates CRC
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...typeBytes,
    ...data,
    ...crc,
  ];
}

const SECRET_TEXT = [...'Author\0SecretPersonName'].map((c) => c.charCodeAt(0));

function buildTestPng(): Uint8Array {
  const ihdr = pngChunk('IHDR', new Array(13).fill(0));
  const tExt = pngChunk('tEXt', SECRET_TEXT);
  const idat = pngChunk('IDAT', [1, 2, 3, 4]);
  const iend = pngChunk('IEND', []);
  return new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...tExt, ...idat, ...iend]);
}

function containsSubsequence(haystack: Uint8Array, needle: number[]): boolean {
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((byte, offset) => haystack[i + offset] === byte)) return true;
  }
  return false;
}

describe('stripPngMetadata', () => {
  it('removes a tEXt metadata chunk', () => {
    const result = stripPngMetadata(buildTestPng());
    expect(containsSubsequence(result, SECRET_TEXT)).toBe(false);
  });

  it('keeps the required IHDR/IDAT/IEND chunks', () => {
    const result = stripPngMetadata(buildTestPng());
    for (const type of ['IHDR', 'IDAT', 'IEND']) {
      const typeBytes = [...type].map((c) => c.charCodeAt(0));
      expect(containsSubsequence(result, typeBytes)).toBe(true);
    }
  });

  it('preserves the PNG signature', () => {
    const result = stripPngMetadata(buildTestPng());
    expect(Array.from(result.subarray(0, 8))).toEqual(PNG_SIGNATURE);
  });

  it('produces a shorter result than the input (metadata actually removed)', () => {
    const input = buildTestPng();
    const result = stripPngMetadata(input);
    expect(result.length).toBeLessThan(input.length);
  });

  it('throws on a non-PNG input', () => {
    expect(() => stripPngMetadata(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow();
  });
});
