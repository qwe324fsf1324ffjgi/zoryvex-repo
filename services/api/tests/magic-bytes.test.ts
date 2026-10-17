import { describe, expect, it } from 'vitest';
import { bytesMatchClaimedType } from '../src/lib/magic-bytes';

describe('bytesMatchClaimedType', () => {
  it('accepts a real PDF signature for application/pdf', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    expect(bytesMatchClaimedType(bytes, 'application/pdf')).toBe(true);
  });

  it('rejects a PNG signature claimed as application/pdf', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytesMatchClaimedType(bytes, 'application/pdf')).toBe(false);
  });

  it('accepts a real PNG signature for image/png', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytesMatchClaimedType(bytes, 'image/png')).toBe(true);
  });

  it('accepts a real JPEG signature for image/jpeg', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(bytesMatchClaimedType(bytes, 'image/jpeg')).toBe(true);
  });

  it('rejects an executable (MZ header) disguised with any allowed claimed type', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ / PE header
    expect(bytesMatchClaimedType(bytes, 'application/pdf')).toBe(false);
    expect(bytesMatchClaimedType(bytes, 'image/png')).toBe(false);
    expect(bytesMatchClaimedType(bytes, 'image/jpeg')).toBe(false);
    expect(bytesMatchClaimedType(bytes, 'text/plain')).toBe(false);
  });

  it('accepts plausible plain-text bytes for text/plain', () => {
    const bytes = new TextEncoder().encode('Built X at Y, shipped Z.\nSecond line.');
    expect(bytesMatchClaimedType(bytes, 'text/plain')).toBe(true);
  });

  it('rejects binary content (NUL byte) claimed as text/plain', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6f]);
    expect(bytesMatchClaimedType(bytes, 'text/plain')).toBe(false);
  });

  it('rejects an unrecognized/unlisted MIME type entirely', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(bytesMatchClaimedType(bytes, 'application/x-msdownload')).toBe(false);
  });

  it('treats an empty buffer as not matching any binary signature', () => {
    expect(bytesMatchClaimedType(new Uint8Array([]), 'application/pdf')).toBe(false);
  });
});
