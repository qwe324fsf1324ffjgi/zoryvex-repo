import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES, indexingAllowed, siteOrigin } from '../src/lib/site';

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe('indexingAllowed', () => {
  /**
   * The direction this must fail in. TEST serves the whole product on a
   * public hostname, so a build that guessed "probably fine to index"
   * would put a pre-launch product into search results - far harder to
   * undo than to prevent.
   */
  it('refuses indexing when nothing says otherwise', () => {
    delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    expect(indexingAllowed()).toBe(false);
  });

  it('refuses anything that is not exactly true', () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      process.env.NEXT_PUBLIC_ALLOW_INDEXING = value;
      expect(indexingAllowed(), value).toBe(false);
    }
  });

  it('allows indexing only on an explicit opt-in', () => {
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = 'true';
    expect(indexingAllowed()).toBe(true);
  });
});

describe('siteOrigin', () => {
  it('returns the origin of a configured site URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.zoryvex.space';
    expect(siteOrigin()).toBe('https://test.zoryvex.space');
  });

  it('strips any path, so metadata and the sitemap cannot double up a segment', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://zoryvex.space/some/path';
    expect(siteOrigin()).toBe('https://zoryvex.space');
  });

  it('returns null rather than throwing on a malformed value', () => {
    // A bad value degrades metadata to relative URLs. Taking the build down
    // over it would be a worse trade.
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url';
    expect(siteOrigin()).toBeNull();
  });

  it('returns null when unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteOrigin()).toBeNull();
  });
});

describe('PUBLIC_ROUTES', () => {
  it('offers only public marketing pages to a crawler', () => {
    // Anything behind the authorizer would give a crawler a sign-in wall,
    // and would advertise URLs that mean nothing to anyone not signed in.
    const gated = PUBLIC_ROUTES.filter((route) =>
      ['/candidate', '/employer', '/admin', '/auth'].some((prefix) => route.startsWith(prefix)),
    );
    expect(gated).toEqual([]);
  });

  /**
   * A proof page is a link its owner chooses to share. Indexing one would
   * surface a person's verified work against their name in search results
   * they never opted into, which is a different act from sharing it.
   */
  it('never lists the public proof page', () => {
    expect(PUBLIC_ROUTES).not.toContain('/proof');
  });

  it('starts at the homepage and has no duplicates', () => {
    expect(PUBLIC_ROUTES[0]).toBe('/');
    expect(new Set(PUBLIC_ROUTES).size).toBe(PUBLIC_ROUTES.length);
  });
});
