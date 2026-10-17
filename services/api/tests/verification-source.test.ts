import { describe, expect, it } from 'vitest';
import { publicVerificationUrl } from '../src/domain/verification-source';

/**
 * The market this product sells into has learned not to take profiles at
 * face value: fake and AI-assisted candidates are the top anticipated hiring
 * problem of 2026, ahead of talent shortage, and Gartner expects one in four
 * candidate profiles worldwide to be fake by 2028.
 *
 * A platform answering that with "verified, trust us" is asking for exactly
 * the trust the buyer has just learned to withhold. These links are the
 * answer: the employer re-runs our check at the issuer, without an account
 * and without us in the middle.
 */
describe('publicVerificationUrl', () => {
  const ASSERTION = '11111111-2222-4333-8444-555555555555';

  it('points a certification at the issuer, not at Zoryvex', () => {
    expect(publicVerificationUrl('issuer_badge', ASSERTION)).toBe(
      `https://www.credly.com/badges/${ASSERTION}`,
    );
  });

  it('points a repository at GitHub', () => {
    expect(publicVerificationUrl('repo_ownership', 'a-candidate/landing-zone')).toBe(
      'https://github.com/a-candidate/landing-zone',
    );
  });

  it('returns nothing for a task only Zoryvex scored', () => {
    // There is no third party to check with. Inventing a Zoryvex-hosted link
    // here would dress our own word up as an independent source, which is
    // the exact move this whole feature exists to avoid.
    expect(publicVerificationUrl('graded_task', 'task_abc')).toBeNull();
  });

  it('is built from the stored reference, so a malformed one yields no link', () => {
    // A link stored at verification time would be an editable field, and a
    // link is precisely what an attacker would want control of. Anything
    // that does not match the shape the check actually ran against produces
    // no link at all rather than a plausible-looking one.
    for (const bad of ['', '   ', 'not-a-uuid', '../../evil', 'https://evil.example.com']) {
      expect(publicVerificationUrl('issuer_badge', bad)).toBeNull();
    }
  });

  it('refuses a repository reference that is not a plain owner/repo', () => {
    for (const bad of [
      'evil.example.com/a/b',
      'owner/repo/extra',
      '/leading-slash',
      'owner',
      'https://github.com/owner/repo',
    ]) {
      expect(publicVerificationUrl('repo_ownership', bad)).toBeNull();
    }
  });

  it('normalizes an uppercase assertion id rather than producing a dead link', () => {
    expect(publicVerificationUrl('issuer_badge', ASSERTION.toUpperCase())).toBe(
      `https://www.credly.com/badges/${ASSERTION}`,
    );
  });

  it('preserves repository name casing, which GitHub is sensitive to in display', () => {
    expect(publicVerificationUrl('repo_ownership', 'Ada-L/Landing-Zone')).toBe(
      'https://github.com/Ada-L/Landing-Zone',
    );
  });
});
