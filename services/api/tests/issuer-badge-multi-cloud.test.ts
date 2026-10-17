import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalBadgeName,
  verifyBadgeAssertion,
  type BadgeAssertion,
  type BadgeClass,
} from '../src/lib/verifiers/issuer-badge';

/**
 * Certifications beyond AWS, and the hole that had to close before they
 * could be added.
 *
 * Every issuer and badge string below was read from a live Open Badges
 * record on 2026-09-06 rather than copied from a certification page. The
 * distinction is not pedantry: a Terraform certification's Credly page says
 * "issued by HashiCorp" while the credential itself names IBM Professional
 * Certification, so a verifier written from the page would reject every
 * genuine one.
 */

const EMAIL = 'candidate@example.com';
const NOW = new Date('2026-09-06T00:00:00.000Z');

function boundAssertion(overrides: Partial<BadgeAssertion> = {}): BadgeAssertion {
  return {
    recipient: {
      type: 'email',
      hashed: true,
      identity: `sha256$${createHash('sha256').update(EMAIL).digest('hex')}`,
    },
    badge: 'https://api.credly.com/api/v1/obi/v2/issuers/x/badge_classes/y',
    issuedOn: '2026-01-01T00:00:00.000Z',
    expires: '2029-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function verify(name: string, issuer: string) {
  const badgeClass: BadgeClass = { name, issuer: { name: issuer } };
  return verifyBadgeAssertion(boundAssertion(), badgeClass, EMAIL, NOW);
}

const GOOGLE = 'Google Cloud';
const LINUX = 'The Linux Foundation';
const IBM = 'IBM Professional Certification';
const AWS = 'Amazon Web Services Training and Certification';

describe('an issuer is only trusted for its own certifications', () => {
  /**
   * The reason the allow-list is scoped per issuer rather than kept as two
   * independent sets. Badge names on Credly are not unique to the
   * organisation that owns the exam — training partners publish badges
   * carrying the same words — so a shared pool of names lets any trusted
   * issuer vouch for any other's credential.
   */
  it('refuses an AWS certification name presented under a different issuer', () => {
    const result = verify('AWS Certified Solutions Architect – Associate', GOOGLE);
    expect(result.verified).toBe(false);
  });

  it('refuses a Kubernetes exam name presented by a training partner', () => {
    // Koenig Solutions genuinely publishes a badge with this name. They did
    // not set the exam, and a credential from them is not the certification
    // an employer thinks they are reading.
    const result = verify('CKA: Certified Kubernetes Administrator', 'Koenig Solutions');
    expect(result.verified).toBe(false);
  });

  it('refuses a Google Cloud certification name presented under AWS', () => {
    expect(verify('Professional Cloud Architect Certification', AWS).verified).toBe(false);
  });

  it('says which issuer the name was not accepted from, so the reason is legible', () => {
    const result = verify('AWS Certified Cloud Practitioner', GOOGLE);
    if (result.verified) throw new Error('expected refusal');
    expect(result.reason).toContain(GOOGLE);
  });
});

describe('the certifications each cloud actually issues', () => {
  it('verifies Google Cloud credentials', () => {
    for (const name of [
      'Professional Cloud Architect Certification',
      'Professional Cloud DevOps Engineer Certification',
      'Professional Cloud Security Engineer Certification',
      'Professional Machine Learning Engineer',
      'Associate Cloud Engineer Certification',
      'Cloud Digital Leader Certification',
    ]) {
      expect(verify(name, GOOGLE).verified, name).toBe(true);
    }
  });

  it('verifies the Kubernetes exams the Linux Foundation sets', () => {
    for (const name of [
      'CKA: Certified Kubernetes Administrator',
      'CKAD: Certified Kubernetes Application Developer',
      'CKS: Certified Kubernetes Security Specialist',
    ]) {
      expect(verify(name, LINUX).verified, name).toBe(true);
    }
  });

  it('verifies HashiCorp certifications under the issuer that really signs them', () => {
    for (const name of [
      'HashiCorp Certified: Terraform Associate (003)',
      'HashiCorp Certified: Terraform Associate (004)',
      'HashiCorp Certified: Vault Associate (002)',
    ]) {
      expect(verify(name, IBM).verified, name).toBe(true);
    }
  });

  it('still verifies AWS, which was the only issuer before this', () => {
    expect(verify('AWS Certified Solutions Architect – Associate', AWS).verified).toBe(true);
  });

  it('does not accept an unrelated IBM credential just because IBM is trusted', () => {
    // IBM Professional Certification issues a great many badges. Only the
    // HashiCorp exams are evidence for these tracks.
    expect(verify('IBM Certified Advocate - Cloud v2', IBM).verified).toBe(false);
  });
});

describe('canonicalBadgeName', () => {
  it('treats an exam revision as the same certification', () => {
    // A new revision must not stop being recognized the day it ships.
    expect(canonicalBadgeName('HashiCorp Certified: Terraform Associate (003)')).toBe(
      canonicalBadgeName('HashiCorp Certified: Terraform Associate (004)'),
    );
  });

  it('treats the optional "Certification" suffix as the same certification', () => {
    // Google Cloud publishes both forms. Confirmed live: most carry the
    // suffix, "Professional Machine Learning Engineer" does not.
    expect(canonicalBadgeName('Professional Cloud Architect Certification')).toBe(
      canonicalBadgeName('Professional Cloud Architect'),
    );
  });

  it('does not merge two different certifications', () => {
    expect(canonicalBadgeName('Professional Cloud Architect')).not.toBe(
      canonicalBadgeName('Professional Cloud Developer'),
    );
    expect(canonicalBadgeName('CKA: Certified Kubernetes Administrator')).not.toBe(
      canonicalBadgeName('CKS: Certified Kubernetes Security Specialist'),
    );
  });

  it('keeps a name that merely ends in a word, not a revision', () => {
    expect(canonicalBadgeName('AWS Certified Data Engineer – Associate')).toBe(
      'aws certified data engineer associate',
    );
  });
});
