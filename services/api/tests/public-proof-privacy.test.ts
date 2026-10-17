import { describe, expect, it } from 'vitest';
import { PublicProofSchema } from '@zoryvex/contracts';

/**
 * The public proof page is the only unauthenticated view of a real person
 * in this product. Anybody with the link can read it, including people the
 * candidate has never heard of and search engines.
 *
 * It is built by naming four fields rather than by spreading the candidate,
 * which is what keeps it safe. That is a one-line change away from being
 * unsafe: `getCandidate` now returns phone, LinkedIn, website, location and
 * stated pay expectations — it dropped several of those until 2026-09-11,
 * so anyone reading the old code would have concluded a spread was
 * harmless. It was not; it was merely broken in a way that hid the risk.
 *
 * These tests pin the shape of what may be published, so widening it has to
 * be a deliberate act with a failing test in front of it.
 */

const CONTACT_AND_LOCATION_FIELDS = [
  'email',
  'phone',
  'linkedinUrl',
  'websiteUrl',
  'location',
  'contactUnlockConsent',
  'intent',
  'id',
];

describe('what a public proof page is allowed to contain', () => {
  it('publishes only the four fields it is meant to', () => {
    expect(Object.keys(PublicProofSchema.shape).sort()).toEqual([
      'displayName',
      'generatedAt',
      'launchTrack',
      'proofs',
    ]);
  });

  /**
   * The list that matters. Each of these is either a way to contact
   * somebody, a way to locate them, or a statement about their price, and
   * none belongs on a page the whole internet can read.
   */
  it.each(CONTACT_AND_LOCATION_FIELDS)('has no place for %s', (field) => {
    expect(Object.keys(PublicProofSchema.shape)).not.toContain(field);
  });

  /**
   * Zod strips unknown keys, so even a careless spread would be filtered
   * by a parse. This proves the schema is the backstop rather than
   * assuming it: if anyone makes these schemas strict, or swaps parse for
   * a cast, this is the test that notices.
   */
  it('strips contact details even if handed a whole candidate', () => {
    const parsed = PublicProofSchema.parse({
      displayName: 'Someone',
      launchTrack: 'aws_cloud',
      proofs: [],
      generatedAt: '2026-09-11T00:00:00.000Z',
      email: 'someone@example.test',
      phone: '+2348012345678',
      linkedinUrl: 'https://www.linkedin.com/in/someone',
      location: { country: 'NG', utcOffsetMinutes: 60 },
    }) as Record<string, unknown>;

    for (const field of CONTACT_AND_LOCATION_FIELDS) {
      expect(parsed[field]).toBeUndefined();
    }
  });

  /**
   * The candidate's own name is on the page, deliberately — a proof page
   * nobody can attribute proves nothing. Pinned so it is not removed by
   * accident while tightening the rest.
   */
  it('does publish the display name, which is the point of the page', () => {
    expect(Object.keys(PublicProofSchema.shape)).toContain('displayName');
  });
});
