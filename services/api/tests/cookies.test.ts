import { describe, expect, it } from 'vitest';
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  readSessionCookie,
} from '../src/http/cookies';

describe('buildSessionCookie', () => {
  it('sets the __Host- prefix with Secure/HttpOnly/Path=/, no Domain', () => {
    const cookie = buildSessionCookie('abc', 3600);
    expect(cookie).toContain('__Host-zoryvex_session=abc');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).not.toContain('Domain=');
  });
});

describe('buildExpiredSessionCookie', () => {
  it('sets Max-Age=0 to clear the cookie', () => {
    expect(buildExpiredSessionCookie()).toContain('Max-Age=0');
  });
});

describe('readSessionCookie', () => {
  it('extracts the session cookie value from a cookies array', () => {
    const value = readSessionCookie([
      'other=1',
      '__Host-zoryvex_session=my-session-id',
      'another=2',
    ]);
    expect(value).toBe('my-session-id');
  });

  it('returns null when the cookie is absent', () => {
    expect(readSessionCookie(['other=1'])).toBeNull();
  });

  it('returns null when cookies is undefined', () => {
    expect(readSessionCookie(undefined)).toBeNull();
  });

  it('handles a value that itself contains an equals sign (base64url never does, but be defensive)', () => {
    const value = readSessionCookie(['__Host-zoryvex_session=abc=def']);
    expect(value).toBe('abc=def');
  });
});
