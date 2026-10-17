import { describe, expect, it } from 'vitest';
import { isContactableForDiscovery, missingContactForDiscovery } from '../src/domain';

/**
 * An employer spends one of a metered monthly allowance to reach somebody.
 * Founder decision, 2026-09-14: being findable means being reachable, so a
 * phone number and one link to where the work lives are required before a
 * candidate is shown in a search.
 *
 * LinkedIn counts as the portfolio because for most engineers that is where
 * the work is. Requiring a personal site would turn away candidates who
 * prove themselves through certifications and repositories, which would
 * shrink the marketplace the employer is paying for.
 */
describe('who an employer can be shown', () => {
  it('accepts a phone and a website', () => {
    expect(
      isContactableForDiscovery({ phone: '+2348012345678', websiteUrl: 'https://me.dev' }),
    ).toBe(true);
  });

  it('accepts a phone and LinkedIn, with no site of their own', () => {
    expect(
      isContactableForDiscovery({
        phone: '+2348012345678',
        linkedinUrl: 'https://www.linkedin.com/in/somebody',
      }),
    ).toBe(true);
  });

  it('refuses an email-only candidate', () => {
    // The case this rule exists for: an unlock that returns an address and
    // nothing else is less than the page implied.
    expect(isContactableForDiscovery({})).toBe(false);
  });

  it('refuses a phone with nowhere to see the work', () => {
    expect(isContactableForDiscovery({ phone: '+2348012345678' })).toBe(false);
  });

  it('refuses a portfolio with no way to reach them', () => {
    expect(isContactableForDiscovery({ websiteUrl: 'https://me.dev' })).toBe(false);
  });

  it('treats whitespace as absent, so a space is not a phone number', () => {
    expect(isContactableForDiscovery({ phone: '   ', websiteUrl: 'https://me.dev' })).toBe(false);
  });

  it('names exactly what is missing, so the candidate is not left guessing', () => {
    expect(missingContactForDiscovery({})).toEqual(['phone', 'portfolio']);
    expect(missingContactForDiscovery({ phone: '+2348012345678' })).toEqual(['portfolio']);
    expect(missingContactForDiscovery({ websiteUrl: 'https://me.dev' })).toEqual(['phone']);
    expect(
      missingContactForDiscovery({
        phone: '+2348012345678',
        linkedinUrl: 'https://www.linkedin.com/in/x',
      }),
    ).toEqual([]);
  });
});
