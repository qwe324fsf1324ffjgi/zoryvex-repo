import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  normalizeName,
  resolveBadgeClass,
  verifyBadgeAssertion,
  type BadgeAssertion,
  type BadgeClass,
} from '../src/lib/verifiers/issuer-badge';

const EMAIL = 'candidate@example.com';
const NOW = new Date('2026-08-27T00:00:00.000Z');
const SALT = 'a-fixed-test-salt';

function hashedIdentity(email: string, salt = ''): string {
  return (
    'sha256$' +
    createHash('sha256')
      .update(email.toLowerCase() + salt)
      .digest('hex')
  );
}

/**
 * Shaped from a REAL Credly response observed on 2026-08-27, not from a
 * guess at the spec. The differences that matter, each of which the first
 * draft of the verifier got wrong or right only by accident:
 *
 *   badge      is a URI string, not an embedded object
 *   recipient  has NO salt key at all (Credly hashes the bare email)
 *   revoked    is absent on a valid badge rather than false
 *
 * The identity below is computed from a test address; no real person's
 * credential is reproduced here.
 */
const BADGE_CLASS_URI =
  'https://api.credly.com/api/v1/obi/v2/issuers/7b741b5c-231d-4925-8041-c64b6846f1c8/badge_classes/54225396-3c1a-44b6-ba14-9fe2f812842b';

function assertion(overrides: Partial<BadgeAssertion> = {}): BadgeAssertion {
  return {
    recipient: { type: 'email', hashed: true, identity: hashedIdentity(EMAIL) },
    badge: BADGE_CLASS_URI,
    issuedOn: '2026-01-01T00:00:00.000Z',
    expires: '2029-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The real issuer and badge names, verbatim, en dash included. */
function badgeClass(overrides: Partial<BadgeClass> = {}): BadgeClass {
  return {
    name: 'AWS Certified Solutions Architect – Associate',
    issuer: { name: 'Amazon Web Services Training and Certification' },
    ...overrides,
  };
}

describe('resolveBadgeClass', () => {
  it('returns the URI to dereference, which is what Credly actually sends', () => {
    // The bug this pins: reading assertion.badge.name gave undefined, so
    // every genuine credential was rejected as an unrecognized certification.
    expect(resolveBadgeClass(assertion())).toEqual({ fetchUri: BADGE_CLASS_URI });
  });

  it('accepts an embedded class, which the spec also permits', () => {
    const inline = assertion({ badge: badgeClass() });
    expect(resolveBadgeClass(inline)).toEqual({ inline: badgeClass() });
  });

  it('refuses a badge URI pointing away from Credly', () => {
    // The assertion is upstream data. Following an arbitrary URL out of a
    // response body is the same forgery hole that parsing the candidate's
    // own link exists to avoid.
    for (const uri of [
      'https://evil.example.com/badge_classes/1',
      'https://api.credly.com.evil.test/x',
      'http://api.credly.com/x',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect(resolveBadgeClass(assertion({ badge: uri }))).toMatchObject({
        reason: expect.any(String),
      });
    }
  });

  it('refuses an assertion with no badge at all', () => {
    expect(resolveBadgeClass(assertion({ badge: undefined }))).toMatchObject({
      reason: expect.any(String),
    });
  });
});

describe('verifyBadgeAssertion', () => {
  it('verifies a current AWS credential cryptographically bound to the candidate', () => {
    const result = verifyBadgeAssertion(assertion(), badgeClass(), EMAIL, NOW);
    expect(result.verified).toBe(true);
    expect(result).toMatchObject({ issuerName: 'Amazon Web Services Training and Certification' });
  });

  it("refuses a credential issued to somebody else's email", () => {
    // The whole point: a candidate cannot pass by pasting a badge URL they
    // found. The salted hash binds the credential to an address they had to
    // prove control of at sign-in.
    const stolen = assertion({
      recipient: {
        type: 'email',
        hashed: true,
        salt: SALT,
        identity: hashedIdentity('someone.else@example.com'),
      },
    });
    const result = verifyBadgeAssertion(stolen, badgeClass(), EMAIL, NOW);
    expect(result.verified).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('different email address') });
  });

  it('refuses a revoked credential', () => {
    expect(
      verifyBadgeAssertion(assertion({ revoked: true }), badgeClass(), EMAIL, NOW).verified,
    ).toBe(false);
  });

  it('refuses an expired credential even though it was genuinely earned', () => {
    // Real history, but not current proof — matching must not treat it as such.
    const expired = assertion({ expires: '2026-01-01T00:00:00.000Z' });
    const result = verifyBadgeAssertion(expired, badgeClass(), EMAIL, NOW);
    expect(result.verified).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('expired') });
  });

  it('accepts a credential with no expiry at all', () => {
    const perpetual = assertion({ expires: undefined });
    expect(verifyBadgeAssertion(perpetual, badgeClass(), EMAIL, NOW)).toMatchObject({
      verified: true,
      expiresAt: null,
    });
  });

  it('refuses an unrecognized issuer rather than trusting the name', () => {
    const fake = badgeClass({ issuer: { name: 'Definitely Real Certifications Ltd' } });
    expect(verifyBadgeAssertion(assertion(), fake, EMAIL, NOW).verified).toBe(false);
  });

  it('refuses a real AWS badge that is not one of the tracked certifications', () => {
    const offTrack = badgeClass({ name: 'AWS Partner: Accreditation' });
    expect(verifyBadgeAssertion(assertion(), offTrack, EMAIL, NOW).verified).toBe(false);
  });

  it('survives an issuer changing punctuation in the badge name', () => {
    // Credly has used both an en dash and a hyphen for the same credential.
    // A real credential must not fail verification over typography.
    const hyphenated = badgeClass({ name: 'AWS Certified Solutions Architect - Associate' });
    expect(verifyBadgeAssertion(assertion(), hyphenated, EMAIL, NOW).verified).toBe(true);
  });

  it('handles an unhashed recipient identity', () => {
    const plain = assertion({
      recipient: { type: 'email', hashed: false, identity: 'Candidate@Example.com' },
    });
    expect(verifyBadgeAssertion(plain, badgeClass(), EMAIL, NOW).verified).toBe(true);
  });

  it('verifies an unsalted identity, which is what Credly actually sends', () => {
    // Confirmed live: the recipient object has no salt key at all. An absent
    // salt means the bare email is hashed, so this is the spec being read
    // correctly rather than a fallback that happens to work.
    const unsalted = assertion({
      recipient: { type: 'email', hashed: true, identity: hashedIdentity(EMAIL, '') },
    });
    expect(verifyBadgeAssertion(unsalted, badgeClass(), EMAIL, NOW).verified).toBe(true);
  });

  it('refuses a hashed identity computed with a salt we were not given', () => {
    const saltedElsewhere = assertion({
      recipient: { type: 'email', hashed: true, identity: hashedIdentity(EMAIL, 'other-salt') },
    });
    expect(verifyBadgeAssertion(saltedElsewhere, badgeClass(), EMAIL, NOW).verified).toBe(false);
  });

  it('refuses an assertion that identifies nobody', () => {
    expect(
      verifyBadgeAssertion(assertion({ recipient: {} }), badgeClass(), EMAIL, NOW).verified,
    ).toBe(false);
    expect(
      verifyBadgeAssertion(assertion({ recipient: undefined }), badgeClass(), EMAIL, NOW).verified,
    ).toBe(false);
  });

  it('refuses an unreadable expiry rather than treating it as no expiry', () => {
    const bad = assertion({ expires: 'sometime next year' });
    expect(verifyBadgeAssertion(bad, badgeClass(), EMAIL, NOW).verified).toBe(false);
  });

  it('refuses a non-email recipient type', () => {
    const byUrl = assertion({
      recipient: { type: 'url', hashed: false, identity: 'https://example.com/me' },
    });
    expect(verifyBadgeAssertion(byUrl, badgeClass(), EMAIL, NOW).verified).toBe(false);
  });

  it('normalizes dashes, case, and punctuation consistently', () => {
    expect(normalizeName('AWS Certified Solutions Architect – Associate')).toBe(
      'aws certified solutions architect associate',
    );
    expect(normalizeName('AWS  Certified,  Developer - Associate')).toBe(
      'aws certified developer associate',
    );
  });
});
