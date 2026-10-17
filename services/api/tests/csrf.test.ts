import { describe, expect, it } from 'vitest';
import { csrfTokenMatches, originAllowed } from '../src/http/csrf';

describe('originAllowed', () => {
  it('accepts an exact match', () => {
    expect(originAllowed('https://test.zoryvex.space', 'https://test.zoryvex.space')).toBe(true);
  });

  it('rejects a different origin', () => {
    expect(originAllowed('https://evil.example', 'https://test.zoryvex.space')).toBe(false);
  });

  it('rejects a missing Origin header', () => {
    expect(originAllowed(undefined, 'https://test.zoryvex.space')).toBe(false);
  });

  it('rejects a subdomain/prefix trick', () => {
    expect(
      originAllowed('https://test.zoryvex.space.evil.example', 'https://test.zoryvex.space'),
    ).toBe(false);
  });
});

describe('csrfTokenMatches', () => {
  it('accepts a matching token', () => {
    expect(csrfTokenMatches('token-a', 'token-a')).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(csrfTokenMatches('token-a', 'token-b')).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(csrfTokenMatches(undefined, 'token-a')).toBe(false);
  });
});
