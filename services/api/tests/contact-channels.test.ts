import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import {
  CandidateSchema,
  LinkedInUrlSchema,
  PhoneSchema,
  PublicProofSchema,
} from '@zoryvex/contracts';
import type { Candidate, Match, Role } from '@zoryvex/contracts';
import {
  getUnlockedContactInfo,
  type GetUnlockedContactDependencies,
} from '../src/domain/contact-unlock-service';

/**
 * A phone number and a LinkedIn profile are contact details, and they are
 * treated exactly like the email address that was already here: released
 * only after an employer has unlocked the match, only while the candidate's
 * consent stands, and never anywhere else.
 *
 * The risk worth testing is not that the feature fails to work. It is that
 * a new field slips out through a path the email never took — a public proof
 * page, a match card, a search document — because it was added to the record
 * rather than to the gate.
 */

const EMPLOYER_ID = 'emp_1';
const ROLE_ID = 'role_1';
const CANDIDATE_ID = 'cand_1';

const role: Role = {
  id: ROLE_ID,
  employerId: EMPLOYER_ID,
  title: 'Platform Engineer',
  launchTrack: 'devops_platform',
  seniority: 'mid',
  outcomes: 'Run the platform.',
  mustHaveWork: ['Terraform'],
  constraints: '',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'cand@example.com',
    displayName: 'A Candidate',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    contactUnlockConsent: true,
    onboardingComplete: true,
    summary: '',
    phone: '+234 801 234 5678',
    linkedinUrl: 'https://www.linkedin.com/in/a-candidate',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakes(input: { candidate?: Candidate; unlocked?: boolean } = {}) {
  const match: Match = {
    id: 'm1',
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    matchScore: 1,
    status: 'suggested',
    contactUnlocked: input.unlocked ?? true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const deps: GetUnlockedContactDependencies = {
    async getFeatureFlags() {
      return { ...DEFAULT_FEATURE_FLAGS, contactUnlocks: true };
    },
    async getRole() {
      return { role, version: 1 };
    },
    async getMatch() {
      return match;
    },
    async getCandidate() {
      return { candidate: input.candidate ?? candidate(), version: 1 };
    },
  };
  return deps;
}

describe('contact channels ride the same gate as the email', () => {
  it('returns them once the match is unlocked and consent stands', async () => {
    const info = await getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, fakes());
    expect(info.phone).toBe('+234 801 234 5678');
    expect(info.linkedinUrl).toBe('https://www.linkedin.com/in/a-candidate');
  });

  it('releases none of them before the employer has unlocked', async () => {
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, fakes({ unlocked: false })),
    ).rejects.toThrow();
  });

  it('stops releasing them the moment consent is withdrawn', async () => {
    // The email already behaved this way. A new channel that kept flowing
    // after a withdrawal would make the withdrawal a lie.
    await expect(
      getUnlockedContactInfo(
        EMPLOYER_ID,
        ROLE_ID,
        CANDIDATE_ID,
        fakes({ candidate: candidate({ contactUnlockConsent: false }) }),
      ),
    ).rejects.toThrow();
  });

  it('omits a channel the candidate never gave, rather than sending an empty one', async () => {
    const info = await getUnlockedContactInfo(
      EMPLOYER_ID,
      ROLE_ID,
      CANDIDATE_ID,
      fakes({ candidate: candidate({ phone: undefined, linkedinUrl: undefined }) }),
    );
    expect('phone' in info).toBe(false);
    expect('linkedinUrl' in info).toBe(false);
    // The email is not optional and must still be there.
    expect(info.email).toBe('cand@example.com');
  });

  it('is optional: a candidate who gives neither is still a valid record', () => {
    const parsed = CandidateSchema.safeParse(
      candidate({ phone: undefined, linkedinUrl: undefined }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('what the fields will accept', () => {
  it('takes international numbers, which is who this product is for', () => {
    for (const value of [
      '+2348012345678',
      '+234 801 234 5678',
      '08012345678',
      '+44 20 7946 0958',
    ]) {
      expect(PhoneSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('refuses something that is plainly not a number', () => {
    for (const value of ['call me', '', 'https://example.com', '12']) {
      expect(PhoneSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('takes a real LinkedIn profile address in the forms people paste', () => {
    for (const value of [
      'https://www.linkedin.com/in/a-candidate',
      'https://linkedin.com/in/a-candidate',
      'https://www.linkedin.com/in/a-candidate/',
    ]) {
      expect(LinkedInUrlSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('refuses anything that is not a LinkedIn profile', () => {
    // The field claims to be a LinkedIn profile and is shown to an employer
    // as one. An open URL field here would be a place to put a redirect, a
    // tracker, or a page that changes after anybody looked at it.
    for (const value of [
      'http://www.linkedin.com/in/a-candidate',
      'https://linkedin.com.evil.test/in/a-candidate',
      'https://www.linkedin.com/company/acme',
      'https://example.com/in/a-candidate',
      'linkedin.com/in/a-candidate',
    ]) {
      expect(LinkedInUrlSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('the public page never learns about them', () => {
  /**
   * The public proof page is the one shape that leaves the authenticated
   * boundary, readable by anyone holding the link. It is defined by what it
   * omits, and a contact channel added to the candidate record rather than
   * to the gate is exactly how something reaches it by accident.
   *
   * Asserted against the schema rather than against one rendered page, so
   * the guard holds for every candidate rather than for the fixture.
   */
  it('has no field that could carry a phone number or a profile link', () => {
    const keys = Object.keys(PublicProofSchema.shape);
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('linkedinUrl');
    expect(keys).not.toContain('email');
  });

  it('strips them if something ever hands them over anyway', () => {
    // zod objects are strip-by-default, so a caller that spread a whole
    // Candidate into a public proof would lose these rather than publish
    // them. Pinned, because a future `.passthrough()` would silently undo it.
    const parsed = PublicProofSchema.safeParse({
      displayName: 'A Candidate',
      launchTrack: 'devops_platform',
      proofs: [],
      generatedAt: '2026-09-06T00:00:00.000Z',
      phone: '+234 801 234 5678',
      linkedinUrl: 'https://www.linkedin.com/in/a-candidate',
      email: 'cand@example.com',
    });
    if (!parsed.success) throw new Error('fixture no longer matches PublicProofSchema');
    expect(JSON.stringify(parsed.data)).not.toContain('801');
    expect(JSON.stringify(parsed.data)).not.toContain('linkedin.com');
    expect(JSON.stringify(parsed.data)).not.toContain('cand@example.com');
  });
});
