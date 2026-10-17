import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../src/lib/sanitize-filename';

describe('sanitizeFilename', () => {
  it('passes through an ordinary filename unchanged', () => {
    expect(sanitizeFilename('resume.pdf')).toBe('resume.pdf');
  });

  it('strips a Unix path prefix, keeping only the basename', () => {
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
  });

  it('strips a Windows path prefix', () => {
    expect(sanitizeFilename('C:\\Users\\me\\secret.txt')).toBe('secret.txt');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('evil\x00\x1f.txt')).toBe('evil.txt');
  });

  it('caps length at 255 characters', () => {
    const long = 'a'.repeat(400) + '.txt';
    expect(sanitizeFilename(long).length).toBe(255);
  });

  it('falls back to "file" for an empty or all-control-character name', () => {
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('\x00\x01')).toBe('file');
  });
});
