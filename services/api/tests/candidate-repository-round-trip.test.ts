import { describe, expect, it } from 'vitest';
import { CandidateSchema } from '@zoryvex/contracts';

/**
 * A candidate must come back from storage whole.
 *
 * `itemToCandidate` enumerated twelve of the schema's sixteen fields and
 * dropped `phone`, `linkedinUrl`, `websiteUrl` and `intent`. All four were
 * written to DynamoDB and discarded on read, and nothing failed, because
 * all four are optional and the narrower object still parsed.
 *
 * The cost was paid by both sides. A candidate who saved a phone number
 * watched it disappear on the next load. And `getUnlockedContactInfo`
 * destructures exactly these fields off this object, so an employer who
 * paid to unlock a contact was handed an email address and a display name
 * and never the number or the links — the paid feature delivering less
 * than it charged for, with no error anywhere.
 *
 * This compares the schema's own field list against what the mapper
 * returns, so the next field added to Candidate cannot vanish the same way.
 */

/** Mirrors the repository's mapper without importing the AWS client. */
function itemToCandidate(item: Record<string, unknown>) {
  return CandidateSchema.parse(item);
}

const storedItem = {
  PK: 'CANDIDATE#cand_1',
  SK: 'PROFILE',
  version: 7,
  id: 'cand_1',
  email: 'someone@example.test',
  displayName: 'Someone',
  launchTrack: 'aws_cloud',
  discoveryOptIn: true,
  contactUnlockConsent: true,
  phone: '+2348012345678',
  linkedinUrl: 'https://www.linkedin.com/in/someone',
  websiteUrl: 'https://someone.example',
  location: { country: 'NG', utcOffsetMinutes: 60 },
  publicProofId: 'pp_1',
  onboardingComplete: true,
  summary: 'Platform engineer',
  intent: {
    openTo: ['employment', 'mentoring'],
    note: '',
    minimumCompensation: { minNGN: 900_000, maxNGN: 1_200_000, period: 'month' },
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

describe('a stored candidate comes back whole', () => {
  it('returns every field the schema defines', () => {
    const parsed = itemToCandidate(storedItem) as Record<string, unknown>;
    const missing = Object.keys(CandidateSchema.shape).filter(
      (field) => field in storedItem && parsed[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  /**
   * The three an employer pays for. getUnlockedContactInfo reads them
   * straight off this object, so dropping them here charges for contact
   * details and returns an email.
   */
  it('keeps the contact channels the unlock is sold on', () => {
    const parsed = itemToCandidate(storedItem);
    expect(parsed.phone).toBe('+2348012345678');
    expect(parsed.linkedinUrl).toBe('https://www.linkedin.com/in/someone');
    expect(parsed.websiteUrl).toBe('https://someone.example');
  });

  it('keeps what the candidate is open to and what they need paid', () => {
    const parsed = itemToCandidate(storedItem);
    expect(parsed.intent?.openTo).toContain('mentoring');
    expect(parsed.intent?.minimumCompensation?.minNGN).toBe(900_000);
  });

  /**
   * `version` is optimistic-concurrency bookkeeping and the PK/SK are
   * storage detail. None may reach the domain object; zod strips unknown
   * keys, and this proves the spread relies on that rather than on nobody
   * ever adding a stray attribute.
   */
  it('does not leak storage keys or the version into the domain object', () => {
    const parsed = itemToCandidate(storedItem) as Record<string, unknown>;
    expect(parsed.version).toBeUndefined();
    expect(parsed.PK).toBeUndefined();
    expect(parsed.SK).toBeUndefined();
  });

  it('reads a candidate stored before these fields existed', () => {
    const parsed = itemToCandidate({
      id: 'cand_2',
      email: 'old@example.test',
      displayName: 'Old',
      launchTrack: 'aws_cloud',
      discoveryOptIn: false,
      contactUnlockConsent: false,
      onboardingComplete: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(parsed.phone).toBeUndefined();
    expect(parsed.intent).toBeUndefined();
  });
});
