import { describe, expect, it } from 'vitest';
import { organizationNameFromEmail } from '../src/lib/organization-name';

/**
 * The name here is emailed to candidates, so these are not cosmetic cases.
 *
 * Found during the 2026-09-10 workflow audit: every employer in the TEST
 * database was called "<FirstName>'s organization", and the profile-view
 * email tells a candidate "<that string> looked at your proof on Zoryvex".
 */
describe('organizationNameFromEmail', () => {
  it('names the company from a work domain rather than the person', () => {
    expect(organizationNameFromEmail('jane@acme.com')).toBe('Acme');
    expect(organizationNameFromEmail('recruiting@northwind.io')).toBe('Northwind');
  });

  it('reads a multi-part suffix, where the first label is still the company', () => {
    expect(organizationNameFromEmail('jane@acme.co.uk')).toBe('Acme');
    expect(organizationNameFromEmail('hr@example.com.ng')).toBe('Example');
  });

  it('capitalises each word of a hyphenated company', () => {
    expect(organizationNameFromEmail('jane@acme-corp.com')).toBe('Acme-Corp');
  });

  /**
   * The case that makes the domain a bad guess. "Gmail" would be worse than
   * the old behaviour, not better, so a free provider keeps the old form and
   * the product admits it does not know the company.
   */
  it('falls back to the old form for a free provider rather than naming the provider', () => {
    expect(organizationNameFromEmail('jane@gmail.com')).toBe("Jane's organization");
    expect(organizationNameFromEmail('jane@outlook.com')).toBe("Jane's organization");
    expect(organizationNameFromEmail('jane@proton.me')).toBe("Jane's organization");
  });

  it('falls back when there is no readable domain at all', () => {
    expect(organizationNameFromEmail('jane')).toBe("Jane's organization");
    expect(organizationNameFromEmail('jane@localhost')).toBe("Jane's organization");
  });

  it('is case-insensitive about the address it was given', () => {
    expect(organizationNameFromEmail('Jane@ACME.com')).toBe('Acme');
    expect(organizationNameFromEmail('  jane@acme.com  ')).toBe('Acme');
  });

  /**
   * A plus-address is normal on a work account and must not change the
   * company, and an address with an @ in the local part must resolve on the
   * last one rather than the first.
   */
  it('is unaffected by plus-addressing and splits on the last @', () => {
    expect(organizationNameFromEmail('jane+roles@acme.com')).toBe('Acme');
    expect(organizationNameFromEmail('"odd@name"@acme.com')).toBe('Acme');
  });

  it('never returns an empty name', () => {
    for (const input of ['', '@', '@acme.com', 'a@']) {
      expect(organizationNameFromEmail(input).length).toBeGreaterThan(0);
    }
  });
});
