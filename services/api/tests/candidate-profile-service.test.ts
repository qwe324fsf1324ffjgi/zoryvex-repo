import { describe, expect, it } from 'vitest';
import { CandidateSchema, type Candidate } from '@zoryvex/contracts';
import {
  getOwnCandidateProfile,
  updateOwnCandidateProfile,
  type CandidateProfileDependencies,
} from '../src/domain/candidate-profile-service';
import { NotFoundError } from '../src/errors/typed-errors';

function mergeDefined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

const CANDIDATE_ID = 'cand_1';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'cand@example.com',
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    discoveryOptIn: false,
    onboardingComplete: false,
    summary: '',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(input: { existing?: Candidate | null } = {}) {
  let stored: Candidate | null = input.existing === undefined ? candidate() : input.existing;
  let version = 1;
  const updateCalls: unknown[] = [];

  const deps: CandidateProfileDependencies = {
    clock: { now: () => new Date('2026-08-19T04:00:00.000Z') },
    async getCandidate(candidateId) {
      if (!stored || stored.id !== candidateId) return null;
      return { candidate: stored, version };
    },
    async updateCandidateProfile(candidateId, _expectedVersion, patch, updatedAt) {
      updateCalls.push(patch);
      const current = stored;
      if (!current || current.id !== candidateId) throw new NotFoundError('Candidate not found');
      // Mirrors the real repository rather than merely satisfying the type:
      // null means clear the field, which DynamoDB does with REMOVE, so here
      // it has to delete the key rather than store a null.
      // Every clearable field goes through the same shape, mirroring the
      // repository's single REMOVE path rather than special-casing one.
      const { location, phone, linkedinUrl, websiteUrl, ...rest } = patch;
      const updated = mergeDefined(current, { ...rest, updatedAt }) as Candidate;
      if (location === null) delete updated.location;
      else if (location !== undefined) updated.location = location;
      if (phone === null) delete updated.phone;
      else if (phone !== undefined) updated.phone = phone;
      if (linkedinUrl === null) delete updated.linkedinUrl;
      else if (linkedinUrl !== undefined) updated.linkedinUrl = linkedinUrl;
      if (websiteUrl === null) delete updated.websiteUrl;
      else if (websiteUrl !== undefined) updated.websiteUrl = websiteUrl;
      stored = updated;
      version += 1;
      return { candidate: updated, version };
    },
  };

  return { deps, updateCalls };
}

describe('getOwnCandidateProfile', () => {
  it('returns the profile for an existing candidate', async () => {
    const { deps } = createFakes();
    const result = await getOwnCandidateProfile(CANDIDATE_ID, deps);
    expect(result.candidate.id).toBe(CANDIDATE_ID);
  });

  it('throws NotFoundError when the profile does not exist', async () => {
    const { deps } = createFakes({ existing: null });
    await expect(getOwnCandidateProfile(CANDIDATE_ID, deps)).rejects.toThrow(NotFoundError);
  });
});

describe('updateOwnCandidateProfile', () => {
  it('updates displayName/summary/onboardingComplete', async () => {
    const { deps } = createFakes();
    const result = await updateOwnCandidateProfile(
      CANDIDATE_ID,
      1,
      { displayName: 'New Name', onboardingComplete: true },
      deps,
    );
    expect(result.candidate.displayName).toBe('New Name');
    expect(result.candidate.onboardingComplete).toBe(true);
  });

  it('never includes contactUnlockConsent/discoveryOptIn in the patch it forwards', async () => {
    const { deps, updateCalls } = createFakes();
    await updateOwnCandidateProfile(CANDIDATE_ID, 1, { summary: 'hi' }, deps);
    expect(updateCalls[0]).not.toHaveProperty('contactUnlockConsent');
    expect(updateCalls[0]).not.toHaveProperty('discoveryOptIn');
  });
});

describe('stating and withdrawing a location', () => {
  it('stores a location the candidate states about themselves', async () => {
    const { deps } = createFakes();
    const { candidate } = await updateOwnCandidateProfile(
      CANDIDATE_ID,
      1,
      { location: { country: 'NG', utcOffsetMinutes: 60 } },
      deps,
    );
    expect(candidate.location).toEqual({ country: 'NG', utcOffsetMinutes: 60 });
  });

  /**
   * null and undefined are not the same request. undefined is "this update
   * did not mention location"; null is "remove it". Conflating them means
   * either that a candidate can never withdraw a location, or that every
   * unrelated profile edit silently erases it.
   */
  it('leaves the location alone when an update does not mention it', async () => {
    const { deps } = createFakes();
    await updateOwnCandidateProfile(
      CANDIDATE_ID,
      1,
      { location: { country: 'NG', utcOffsetMinutes: 60 } },
      deps,
    );
    const { candidate } = await updateOwnCandidateProfile(
      CANDIDATE_ID,
      2,
      { displayName: 'Renamed' },
      deps,
    );
    expect(candidate.displayName).toBe('Renamed');
    expect(candidate.location).toEqual({ country: 'NG', utcOffsetMinutes: 60 });
  });

  it('clears the location on null, leaving no null behind for the schema to reject', async () => {
    const { deps } = createFakes();
    await updateOwnCandidateProfile(
      CANDIDATE_ID,
      1,
      { location: { country: 'NG', utcOffsetMinutes: 60 } },
      deps,
    );
    const { candidate } = await updateOwnCandidateProfile(
      CANDIDATE_ID,
      2,
      { location: null },
      deps,
    );
    expect(candidate.location).toBeUndefined();
    expect('location' in candidate).toBe(false);
    // Withdrawing costs a candidate nothing: an unstated location is never
    // filtered against, so this is a real choice rather than a penalty.
    expect(CandidateSchema.safeParse(candidate).success).toBe(true);
  });
});
