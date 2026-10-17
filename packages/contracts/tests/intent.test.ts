import { describe, expect, it } from 'vitest';
import {
  CandidateIntentSchema,
  CandidateSchema,
  CompensationRangeSchema,
  MatchSchema,
  RoleIntentSchema,
  RoleSchema,
  compensationClears,
  formatCompensationRange,
  isMutualMatch,
} from '../src/index';

/**
 * These three things were in the product brief and in nothing else: no
 * schema field, no API, no screen. An employer could pay to unlock somebody
 * who would never have taken the money, a candidate offering to tutor had
 * nowhere to say so, and "mutual matching" described a behaviour the system
 * could not represent because neither side could express interest at all.
 */

describe('a pay range has to be a range', () => {
  it('refuses a top below the bottom, which is the typo that matters', () => {
    const result = CompensationRangeSchema.safeParse({
      minNGN: 900_000,
      maxNGN: 600_000,
      period: 'month',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single figure expressed as an equal range', () => {
    const result = CompensationRangeSchema.safeParse({
      minNGN: 800_000,
      maxNGN: 800_000,
      period: 'month',
    });
    expect(result.success).toBe(true);
  });

  it('refuses kobo, because a decimal in a salary is a float bug waiting', () => {
    const result = CompensationRangeSchema.safeParse({
      minNGN: 800_000.5,
      maxNGN: 900_000,
      period: 'month',
    });
    expect(result.success).toBe(false);
  });

  it('reads as one phrase a person can scan', () => {
    expect(formatCompensationRange({ minNGN: 800_000, maxNGN: 1_200_000, period: 'month' })).toBe(
      'NGN 800,000 to NGN 1,200,000 per month',
    );
    expect(formatCompensationRange({ minNGN: 95_000, maxNGN: 95_000, period: 'day' })).toBe(
      'NGN 95,000 per day',
    );
  });
});

describe('pay is only held against a match when both sides have stated it', () => {
  const asked = { minNGN: 900_000, maxNGN: 1_200_000, period: 'month' as const };

  it('does not penalise a role that has published no range', () => {
    expect(compensationClears(undefined, asked).clears).toBe(true);
  });

  it('does not penalise a candidate who has stated no minimum', () => {
    expect(
      compensationClears({ minNGN: 400_000, maxNGN: 500_000, period: 'month' }, undefined).clears,
    ).toBe(true);
  });

  it('clears when the top of the offer reaches what they asked for', () => {
    expect(
      compensationClears({ minNGN: 600_000, maxNGN: 900_000, period: 'month' }, asked).clears,
    ).toBe(true);
  });

  it('falls short when the whole range is below what they asked for', () => {
    const result = compensationClears({ minNGN: 400_000, maxNGN: 600_000, period: 'month' }, asked);
    expect(result.clears).toBe(false);
    if (!result.clears) {
      expect(result.reasonForCandidate).toContain('NGN 600,000');
      expect(result.reasonForCandidate).toContain('NGN 900,000');
      expect(result.reasonForEmployer).toContain('NGN 600,000');
    }
  });

  /**
   * The candidate's own figure is theirs. The profile field that collects
   * it says it is never shown to an employer as a demand, and a shortlist
   * that printed it would break that promise on the employer's screen.
   * The employer is told the gap exists, which is all they need to decide
   * whether to talk to somebody anyway.
   */
  it('never names what the candidate asked for in the employer sentence', () => {
    const result = compensationClears({ minNGN: 400_000, maxNGN: 600_000, period: 'month' }, asked);
    expect(result.clears).toBe(false);
    if (!result.clears) {
      expect(result.reasonForEmployer).not.toContain('900,000');
      expect(result.reasonForEmployer).toContain('below what they said they need');
    }
  });

  /** And the candidate is addressed as themselves, not described. */
  it('writes the candidate sentence in the second person', () => {
    const result = compensationClears({ minNGN: 400_000, maxNGN: 600_000, period: 'month' }, asked);
    expect(result.clears).toBe(false);
    if (!result.clears) {
      expect(result.reasonForCandidate).toContain('you said you need');
      expect(result.reasonForCandidate).not.toContain('they');
    }
  });

  /**
   * A day rate and a monthly salary cannot be compared without inventing a
   * number of working days that neither side agreed to. Silence beats a
   * confident wrong answer.
   */
  it('declines to compare a day rate against a monthly salary', () => {
    expect(
      compensationClears({ minNGN: 90_000, maxNGN: 120_000, period: 'day' }, asked).clears,
    ).toBe(true);
  });
});

describe('mutual means both sides actually said yes', () => {
  it('is mutual only when both are interested', () => {
    expect(isMutualMatch('interested', 'interested')).toBe(true);
  });

  it('is not mutual when one side has simply not looked yet', () => {
    expect(isMutualMatch('interested', 'unstated')).toBe(false);
    expect(isMutualMatch('unstated', 'interested')).toBe(false);
  });

  it('treats an absent answer as not yet said, never as agreement', () => {
    expect(isMutualMatch(undefined, 'interested')).toBe(false);
    expect(isMutualMatch(undefined, undefined)).toBe(false);
  });

  it('is not mutual when either side declined', () => {
    expect(isMutualMatch('declined', 'interested')).toBe(false);
    expect(isMutualMatch('interested', 'declined')).toBe(false);
  });
});

describe('mentoring, tutoring and training are first-class, not free text', () => {
  it('accepts a candidate open to teaching as well as being hired', () => {
    const parsed = CandidateIntentSchema.parse({
      openTo: ['employment', 'mentoring', 'tutoring'],
      note: '',
    });
    expect(parsed.openTo).toContain('tutoring');
  });

  it('defaults to no preference rather than to a guess', () => {
    const parsed = CandidateIntentSchema.parse({});
    expect(parsed.openTo).toEqual([]);
    expect(parsed.minimumCompensation).toBeUndefined();
  });

  it('refuses an engagement kind nobody defined', () => {
    expect(CandidateIntentSchema.safeParse({ openTo: ['apprenticeship'] }).success).toBe(false);
  });

  it('treats a role as a permanent hire unless it says otherwise', () => {
    expect(RoleIntentSchema.parse({}).engagementKind).toBe('employment');
  });
});

describe('records written before any of this existed still parse', () => {
  const role = {
    id: 'role_1',
    employerId: 'emp_1',
    launchTrack: 'aws_cloud',
    title: 'Platform engineer',
    seniority: 'mid',
    outcomes: 'Run the platform',
    mustHaveWork: ['Terraform'],
    constraints: '',
    status: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  it('parses a role with no intent', () => {
    const parsed = RoleSchema.parse(role);
    expect(parsed.intent).toBeUndefined();
  });

  it('parses a candidate with no intent', () => {
    const parsed = CandidateSchema.parse({
      id: 'cand_1',
      email: 'someone@example.test',
      displayName: 'Someone',
      launchTrack: 'aws_cloud',
      discoveryOptIn: true,
      contactUnlockConsent: false,
      location: undefined,
      onboardingComplete: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(parsed.intent).toBeUndefined();
  });

  /**
   * The one that would quietly change meaning: a stored shortlist must not
   * start reading as mutual rejection because two fields were added.
   */
  it('parses a match with no interest recorded, and it is not mutual', () => {
    const parsed = MatchSchema.parse({
      id: 'match_1',
      roleId: 'role_1',
      candidateId: 'cand_1',
      matchScore: 0.8,
      status: 'suggested',
      createdAt: '2026-08-01T00:00:00.000Z',
      contactUnlocked: false,
    });
    expect(parsed.candidateInterest).toBeUndefined();
    expect(isMutualMatch(parsed.candidateInterest, parsed.employerInterest)).toBe(false);
  });
});
