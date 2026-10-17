import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import type {
  Candidate,
  CandidateLocation,
  Evidence,
  Match,
  Role,
  RoleLocationRequirement,
} from '@zoryvex/contracts';
import {
  byStrongestMatch,
  MATCHING_BASELINE_VERSION,
  getMatchesForRole,
  recomputeMatchesForRole,
  redactAiOutput,
  scoreCandidateAgainstRole,
  type MatchingDependencies,
} from '../src/domain/matching-service';
import { NotFoundError } from '../src/errors/typed-errors';

const OWNER_EMPLOYER_ID = 'emp_owner';
const OTHER_EMPLOYER_ID = 'emp_other';
const ROLE_ID = 'role_1';
const CANDIDATE_ID = 'cand_1';
const NOW = new Date('2026-08-19T03:00:00.000Z');

const role: Role = {
  id: ROLE_ID,
  employerId: OWNER_EMPLOYER_ID,
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra reliably',
  mustHaveWork: ['Terraform IaC on AWS', 'CI/CD pipelines'],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-19T00:00:00.000Z',
};

function evidenceItem(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: CANDIDATE_ID,
    source: 'project',
    claim: 'Built Terraform IaC for a multi-account AWS setup',
    context: 'Personal project',
    actions: 'Wrote modules, wired CI/CD pipelines',
    outcome: 'Deployed reliably for a year',
    verificationState: 'verified',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('scoreCandidateAgainstRole', () => {
  it('scores full requirement coverage from verified evidence near 1', () => {
    const result = scoreCandidateAgainstRole(role, [evidenceItem()], NOW);
    expect(result.matchScore).toBeGreaterThan(0.5);
    expect(result.matchedEvidenceIds).toEqual(['ev_1']);
    expect(result.rationale).toContain('ev_1');
  });

  it('scores 0 with an explanatory rationale when no evidence supports any requirement', () => {
    const unrelated = evidenceItem({
      claim: 'Painted a mural',
      context: 'Community art',
      actions: 'Used brushes and spray paint',
      outcome: 'Well received',
    });
    const result = scoreCandidateAgainstRole(role, [unrelated], NOW);
    expect(result.matchScore).toBe(0);
    expect(result.matchedEvidenceIds).toEqual([]);
    expect(result.rationale).toContain('no verified evidence');
  });

  it('scores 0 with no evidence at all', () => {
    const result = scoreCandidateAgainstRole(role, [], NOW);
    expect(result.matchScore).toBe(0);
    expect(result.rationale).toContain('no verified evidence');
  });

  /**
   * The rule the whole product rests on. This replaced a weighting test that
   * asserted unverified evidence merely scored LOWER than verified — which
   * meant an employer paying for verified talent could still be shown an
   * unchecked claim, just ranked a little further down.
   */
  it('gives unverified evidence no credit at all, not merely less', () => {
    const verified = scoreCandidateAgainstRole(
      role,
      [evidenceItem({ verificationState: 'verified' })],
      NOW,
    );
    const unverified = scoreCandidateAgainstRole(
      role,
      [evidenceItem({ verificationState: 'unverified' })],
      NOW,
    );
    expect(verified.matchScore).toBeGreaterThan(0);
    expect(unverified.matchScore).toBe(0);
    expect(unverified.matchedEvidenceIds).toEqual([]);
  });

  it('gives self-attested evidence no credit either', () => {
    const selfAttested = scoreCandidateAgainstRole(
      role,
      [evidenceItem({ verificationState: 'self_attested' })],
      NOW,
    );
    expect(selfAttested.matchScore).toBe(0);
    expect(selfAttested.matchedEvidenceIds).toEqual([]);
  });

  it('never names an unverified item in a rationale an employer reads', () => {
    const result = scoreCandidateAgainstRole(
      role,
      [evidenceItem({ id: 'ev_unchecked', verificationState: 'unverified' })],
      NOW,
    );
    expect(result.rationale).not.toContain('ev_unchecked');
    expect(result.rationale).toContain('no verified evidence');
  });

  it('dedupes matchedEvidenceIds when the same item best-matches more than one requirement', () => {
    const result = scoreCandidateAgainstRole(role, [evidenceItem()], NOW);
    expect(result.matchedEvidenceIds).toHaveLength(1);
  });
});

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'cand@example.com',
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    // Findable means reachable since 2026-09-14: matching skips a candidate
    // an employer could not act on. The default fixture is somebody who can
    // be reached, so every assertion below keeps describing what it meant.
    phone: '+2348012345678',
    websiteUrl: 'https://candidate.example',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(
  input: {
    evidence?: Evidence[];
    existingMatch?: Match | null;
    aiMatching?: boolean;
    locationRequirement?: RoleLocationRequirement;
    candidateLocation?: CandidateLocation;
    roleIntent?: Role['intent'];
    candidateIntent?: Candidate['intent'];
    candidateOverrides?: Partial<Candidate>;
  } = {},
) {
  const putCalls: Match[] = [];
  const deletedMatches: string[] = [];
  let storedMatch: Match | null = input.existingMatch ?? null;

  const deps: MatchingDependencies = {
    clock: { now: () => new Date('2026-08-19T03:00:00.000Z') },
    async getRole(roleId) {
      if (roleId !== ROLE_ID) return null;
      const withLocation: Role = input.locationRequirement
        ? { ...role, locationRequirement: input.locationRequirement }
        : role;
      const withIntent: Role = input.roleIntent
        ? { ...withLocation, intent: input.roleIntent }
        : withLocation;
      return { role: withIntent, version: 1 };
    },
    async listDiscoveryOptedCandidates() {
      const base = candidate();
      const located = input.candidateLocation
        ? { ...base, location: input.candidateLocation }
        : base;
      const withIntent = input.candidateIntent
        ? { ...located, intent: input.candidateIntent }
        : located;
      // Spread last so a test can remove a contact channel by passing
      // `undefined`, which is what the reachability cases below do.
      return [{ ...withIntent, ...(input.candidateOverrides ?? {}) }];
    },
    async listCandidateEvidence() {
      return input.evidence ?? [evidenceItem()];
    },
    async getMatch() {
      return storedMatch;
    },
    async putMatch(match) {
      putCalls.push(match);
      storedMatch = match;
      return match;
    },
    async listMatchesForRole() {
      return storedMatch ? [storedMatch] : [];
    },
    async deleteMatch() {
      deletedMatches.push(CANDIDATE_ID);
      storedMatch = null;
    },
    async getFeatureFlags() {
      return { ...DEFAULT_FEATURE_FLAGS, aiMatching: input.aiMatching ?? false };
    },
    generateId: () => 'generated_id',
  };

  return { deps, putCalls, deletedMatches };
}

describe('recomputeMatchesForRole', () => {
  it("throws NotFoundError for a role that doesn't exist", async () => {
    const { deps } = createFakes();
    await expect(recomputeMatchesForRole(OWNER_EMPLOYER_ID, 'missing', deps)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws NotFoundError (not Forbidden) for another employer's role", async () => {
    const { deps } = createFakes();
    await expect(recomputeMatchesForRole(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('creates a new suggested, locked match with a scoringVersion for a first-time candidate', async () => {
    const { deps, putCalls } = createFakes();
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toHaveLength(1);
    expect(putCalls[0]).toMatchObject({
      id: 'generated_id',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      status: 'suggested',
      contactUnlocked: false,
      scoringVersion: MATCHING_BASELINE_VERSION,
    });
  });

  it("preserves an existing match's status, contactUnlocked, id, and createdAt across recompute", async () => {
    const existing: Match = {
      id: 'existing_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.1,
      status: 'contacted',
      contactUnlocked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, putCalls } = createFakes({ existingMatch: existing });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(putCalls[0]).toMatchObject({
      id: 'existing_match',
      status: 'contacted',
      contactUnlocked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // The score/rationale/citations DO refresh even though human state is preserved.
    expect(putCalls[0]!.scoringVersion).toBe(MATCHING_BASELINE_VERSION);
  });

  it('keeps a prior aiExplanation when recompute produces the same matched evidence set', async () => {
    const existing: Match = {
      id: 'existing_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.1,
      status: 'contacted',
      contactUnlocked: true,
      // Exactly what scoring produces for the default evidence fixture.
      matchedEvidenceIds: ['ev_1'],
      aiExplanation: 'Cites ev_1.',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, putCalls } = createFakes({ existingMatch: existing, aiMatching: true });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(putCalls[0]!.matchedEvidenceIds).toEqual(['ev_1']);
    expect(putCalls[0]!.aiExplanation).toBe('Cites ev_1.');
  });

  it('drops a prior aiExplanation once the matched evidence set changes', async () => {
    // The candidate hid the evidence the explanation was written about.
    // Carrying the prose forward would leave the match asserting support
    // from evidence it no longer contains (docs/AI_SAFETY.md grounding).
    const existing: Match = {
      id: 'existing_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'contacted',
      contactUnlocked: true,
      matchedEvidenceIds: ['ev_1'],
      aiExplanation: 'Strong Terraform experience, see ev_1.',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, putCalls } = createFakes({
      existingMatch: existing,
      // Still verified, still real, but now about something else entirely, so
      // it no longer supports this role's requirements.
      evidence: [
        evidenceItem({
          id: 'ev_2',
          claim: 'Ran a community bake sale',
          context: 'Local charity',
          actions: 'Baked and sold cakes',
          outcome: 'Raised funds',
        }),
      ],
      aiMatching: true,
    });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    // contactUnlocked matches are never removed, so this still writes.
    //
    // The bake sale backs none of this role's requirements, so the match is
    // `adjacent` and cites the candidate's verified evidence rather than an
    // empty set: an employer looking at a card that says "worth a look" has
    // to have something to look at. matchScore is still 0, so nothing here
    // claims the role is answered.
    expect(putCalls[0]!.fit).toBe('adjacent');
    expect(putCalls[0]!.matchScore).toBe(0);
    expect(putCalls[0]!.matchedEvidenceIds).toEqual(['ev_2']);
    // The point of the test: the explanation was written about ev_1 and must
    // not survive onto a match that no longer contains it.
    expect(putCalls[0]!.aiExplanation).toBeUndefined();
    // Human-set state still survives — dropping the explanation is not a reset.
    expect(putCalls[0]!.status).toBe('contacted');
    expect(putCalls[0]!.contactUnlocked).toBe(true);
  });

  it('excludes private-visibility evidence, leaving nothing to match on', async () => {
    const { deps, putCalls } = createFakes({ evidence: [evidenceItem({ visibility: 'private' })] });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(putCalls).toEqual([]);
    expect(matches).toEqual([]);
  });
});

describe('getMatchesForRole', () => {
  it("throws NotFoundError for another employer's role", async () => {
    const { deps } = createFakes();
    await expect(getMatchesForRole(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("returns the owner's matches", async () => {
    const existing: Match = {
      id: 'm1',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.5,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: '2026-08-19T00:00:00.000Z',
    };
    const { deps } = createFakes({ existingMatch: existing });
    const matches = await getMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toEqual([existing]);
  });
});

/**
 * Guards a real bug found in a 2026-08-27 audit.
 *
 * docs/AI_SAFETY.md "Rollback" promises that turning AI off is nothing more
 * than setting `aiMatching` to `false`, and MatchSchema's comment claimed
 * `aiExplanation` was "always absent while aiMatching is off". Neither held:
 * only handlers/matches/explain.ts consulted the flag, so a Match written
 * while AI was on kept serving its explanation from
 * `GET /roles/{roleId}/matches` forever after — including after
 * scripts/emergency-cost-lockdown.mjs forced the flag off during an
 * incident, which is precisely when the rollback has to bite.
 */
describe('the aiMatching flag gates reading AI output, not only generating it', () => {
  const matchWithAi: Match = {
    id: 'm1',
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    matchScore: 0.5,
    status: 'suggested',
    contactUnlocked: false,
    rationale: 'Deterministic rationale.',
    matchedEvidenceIds: ['ev_1'],
    aiExplanation: 'Generated while the flag was on.',
    createdAt: '2026-08-19T00:00:00.000Z',
  };

  it('redacts aiExplanation from a list response while the flag is off', async () => {
    const { deps } = createFakes({ existingMatch: matchWithAi, aiMatching: false });
    const [match] = await getMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(match).toBeDefined();
    expect(match!.aiExplanation).toBeUndefined();
    // Redacted, not stripped of everything: the deterministic explanation an
    // employer actually relies on is untouched.
    expect(match!.rationale).toBe('Deterministic rationale.');
    expect(match!.matchedEvidenceIds).toEqual(['ev_1']);
  });

  it('serves aiExplanation again once the flag is back on, with no migration', async () => {
    // AI_SAFETY.md's "no data migration is required" only holds if the
    // rollback redacts rather than deletes.
    const { deps } = createFakes({ existingMatch: matchWithAi, aiMatching: true });
    const [match] = await getMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(match!.aiExplanation).toBe('Generated while the flag was on.');
  });

  it('redacts aiExplanation from a recompute response too', async () => {
    // Recompute returns matches on its own route; gating only the list
    // route would leave this one serving AI text during a lockdown.
    const { deps } = createFakes({ existingMatch: matchWithAi, aiMatching: false });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches[0]!.aiExplanation).toBeUndefined();
  });

  it('omits the key entirely rather than setting it to undefined', () => {
    // API Gateway serializes with JSON.stringify, which drops `undefined`
    // anyway — but the object must not carry the key for a strict schema
    // parse or an `in` check either.
    const [redacted] = redactAiOutput([matchWithAi], { ...DEFAULT_FEATURE_FLAGS });
    expect('aiExplanation' in redacted!).toBe(false);
  });

  it('leaves every match untouched when the flag is on', () => {
    const input = [matchWithAi];
    expect(redactAiOutput(input, { ...DEFAULT_FEATURE_FLAGS, aiMatching: true })).toEqual(input);
  });
});

/**
 * The rule the product is sold on: an employer only ever sees candidates
 * Zoryvex can actually vouch for.
 *
 * Before this, nothing in the codebase could set a verificationState other
 * than `unverified`, and the scorer gave unverified evidence 0.4 credit —
 * so every match score on the platform was a self-report, discounted.
 */
describe('only verified, qualified candidates reach an employer', () => {
  it('creates no match for a candidate with nothing verified', async () => {
    const { deps, putCalls } = createFakes({
      evidence: [evidenceItem({ verificationState: 'unverified' })],
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toEqual([]);
    expect(putCalls).toEqual([]);
  });

  it('removes an existing match once the candidate no longer qualifies', async () => {
    // This is the credential-expiry path: an issuer says the certification
    // lapsed, re-verification fails, and the shortlist has to follow.
    const existing: Match = {
      id: 'existing_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, deletedMatches, putCalls } = createFakes({
      existingMatch: existing,
      evidence: [evidenceItem({ verificationState: 'unverified' })],
    });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(deletedMatches).toEqual([CANDIDATE_ID]);
    expect(putCalls).toEqual([]);
  });

  it('never deletes a match the employer paid to unlock, but tells the truth about it', async () => {
    const paid: Match = {
      id: 'paid_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'contacted',
      contactUnlocked: true,
      rationale: 'Stale rationale claiming support.',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, deletedMatches, putCalls } = createFakes({
      existingMatch: paid,
      evidence: [evidenceItem({ verificationState: 'unverified' })],
    });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(deletedMatches).toEqual([]);
    // Refreshed, not left stale: a score of 0.9 still implying support that
    // has since gone is the dishonest outcome.
    expect(putCalls[0]!.matchScore).toBe(0);
    expect(putCalls[0]!.rationale).toContain('no verified evidence');
    expect(putCalls[0]!.contactUnlocked).toBe(true);
  });

  it('matches a candidate whose verified evidence genuinely covers the role', async () => {
    const { deps, putCalls } = createFakes({
      evidence: [evidenceItem({ verificationState: 'verified' })],
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toHaveLength(1);
    expect(putCalls[0]!.matchScore).toBeGreaterThan(0);
  });

  it('ignores an unverified item even when it out-keywords the verified one', async () => {
    // The precise failure partial credit allowed: a candidate could outrank
    // real proof by writing a keyword-dense claim nobody ever checked.
    const { deps, putCalls } = createFakes({
      evidence: [
        evidenceItem({ id: 'ev_verified', verificationState: 'verified' }),
        evidenceItem({
          id: 'ev_keyword_stuffed',
          verificationState: 'unverified',
          claim: 'Terraform IaC on AWS CI/CD pipelines Terraform IaC AWS',
        }),
      ],
    });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(putCalls[0]!.matchedEvidenceIds).toEqual(['ev_verified']);
  });
});

/**
 * Guards a real bug found in a 2026-08-27 audit, and the one with the worst
 * public failure mode in the product.
 *
 * verifyBadgeAssertion already read a credential's expiry date, refused
 * expired ones, and then threw the date away. Nothing stored it, so an AWS
 * certification verified today stayed marked `verified` for ever, including
 * years after it lapsed. An employer clicking "check this yourself at the
 * source" would have discovered the expiry themselves — a platform that
 * sells trust, caught by its own honesty link.
 */
describe('a lapsed credential stops counting as proof', () => {
  const CERT = {
    verificationState: 'verified' as const,
    verificationMethod: 'issuer_badge' as const,
  };

  it('scores a credential that has not expired', () => {
    const current = evidenceItem({ ...CERT, verificationExpiresAt: '2029-01-01T00:00:00.000Z' });
    expect(scoreCandidateAgainstRole(role, [current], NOW).matchScore).toBeGreaterThan(0);
  });

  it('ignores one that expired, with nobody having to re-run anything', () => {
    const lapsed = evidenceItem({ ...CERT, verificationExpiresAt: '2026-01-01T00:00:00.000Z' });
    const result = scoreCandidateAgainstRole(role, [lapsed], NOW);
    expect(result.matchScore).toBe(0);
    expect(result.matchedEvidenceIds).toEqual([]);
  });

  it('keeps counting evidence that never expires, like a repository', () => {
    // Absent is "does not lapse", which is different from "unknown".
    const perpetual = evidenceItem({
      verificationState: 'verified',
      verificationMethod: 'repo_ownership',
      verificationExpiresAt: undefined,
    });
    expect(scoreCandidateAgainstRole(role, [perpetual], NOW).matchScore).toBeGreaterThan(0);
  });

  it('fails closed on an expiry it cannot read', () => {
    // One fewer candidate beats one claim we cannot date.
    const unreadable = evidenceItem({ ...CERT, verificationExpiresAt: 'sometime in 2029' });
    expect(scoreCandidateAgainstRole(role, [unreadable], NOW).matchScore).toBe(0);
  });

  it('treats the expiry moment itself as expired', () => {
    const exact = evidenceItem({ ...CERT, verificationExpiresAt: NOW.toISOString() });
    expect(scoreCandidateAgainstRole(role, [exact], NOW).matchScore).toBe(0);
  });

  it('removes a match once the candidate has nothing current left', async () => {
    // The credential-expiry path end to end: nobody edits anything, the date
    // simply passes, and the shortlist follows.
    const existing: Match = {
      id: 'm1',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, deletedMatches } = createFakes({
      existingMatch: existing,
      evidence: [evidenceItem({ ...CERT, verificationExpiresAt: '2026-01-01T00:00:00.000Z' })],
    });
    await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(deletedMatches).toEqual([CANDIDATE_ID]);
  });
});

/**
 * Pay and the kind of work, which the product brief required and nothing
 * implemented. An employer could pay to unlock somebody who would never
 * have taken the money, and a candidate offering to tutor had no way to say
 * so.
 *
 * Both behave like the location rule already does: a mismatch explains
 * itself and drops the candidate down the list, it never hides them. An
 * employer may well want to talk to somebody slightly outside what they
 * wrote down, and a candidate who is never shown cannot negotiate.
 */
describe('what each side is actually offering', () => {
  const monthly = (minNGN: number, maxNGN: number) =>
    ({ minNGN, maxNGN, period: 'month' }) as const;

  it('says so when the role pays below what the candidate asked for', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(300_000, 500_000) },
      candidateIntent: { openTo: [], note: '', minimumCompensation: monthly(900_000, 1_200_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('partial');
    expect(matches[0]?.fitReason).toContain('NGN 500,000');
    expect(matches[0]?.fitReasonForCandidate).toContain('NGN 500,000');
    expect(matches[0]?.fitReasonForCandidate).toContain('NGN 900,000');
  });

  /**
   * The employer is told the gap exists and not how wide it is. The
   * candidate entered that figure under a line saying it is never shown to
   * an employer as a demand, and this is the row an employer reads before
   * paying for anything.
   */
  it('keeps what the candidate asked for out of the employer shortlist', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(300_000, 500_000) },
      candidateIntent: { openTo: [], note: '', minimumCompensation: monthly(900_000, 1_200_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fitReason).not.toContain('900,000');
    expect(matches[0]?.fitReason).not.toContain('1,200,000');
  });

  /** And the candidate is addressed, not described to somebody else. */
  it('writes the candidate explanation in the second person', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(300_000, 500_000) },
      candidateIntent: {
        openTo: ['mentoring'],
        note: '',
        minimumCompensation: monthly(900_000, 1_200_000),
      },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fitReasonForCandidate).toContain('you said you');
    expect(matches[0]?.fitReasonForCandidate).not.toMatch(/[^a-z]they[^a-z]/);
    expect(matches[0]?.fitReason).toMatch(/[^a-z]they[^a-z]/);
  });

  it('still lists them, rather than filtering them out over money', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(300_000, 500_000) },
      candidateIntent: { openTo: [], note: '', minimumCompensation: monthly(900_000, 1_200_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches).toHaveLength(1);
  });

  it('holds nothing against a role that has published no pay', async () => {
    const { deps } = createFakes({
      candidateIntent: { openTo: [], note: '', minimumCompensation: monthly(900_000, 1_200_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('meets');
  });

  it('holds nothing against a candidate who has stated no minimum', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(300_000, 500_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('meets');
  });

  it('clears when the top of the range reaches what they asked for', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'employment', compensation: monthly(600_000, 950_000) },
      candidateIntent: { openTo: [], note: '', minimumCompensation: monthly(900_000, 1_200_000) },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('meets');
  });

  it('says so when the role is not a kind of work they are open to', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'training' },
      candidateIntent: { openTo: ['employment'], note: '' },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('partial');
    expect(matches[0]?.fitReason?.toLowerCase()).toContain('training');
  });

  it('matches a tutor to tutoring, which had no way of being expressed before', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'tutoring' },
      candidateIntent: { openTo: ['employment', 'tutoring'], note: '' },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('meets');
  });

  /**
   * An empty list is "I have not said", not "I want nothing". Reading it
   * the other way would make every candidate who skipped the question
   * partial against every role.
   */
  it('reads an unstated preference as no constraint', async () => {
    const { deps } = createFakes({
      roleIntent: { engagementKind: 'training' },
      candidateIntent: { openTo: [], note: '' },
    });

    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);

    expect(matches[0]?.fit).toBe('meets');
  });
});

describe('byStrongestMatch', () => {
  // Only the two fields the sort reads. Cast through `unknown` rather than
  // built out in full, because a complete Match fixture would say nothing
  // about ordering and would need maintaining alongside the schema for no
  // benefit.
  const match = (candidateId: string, matchScore: number) =>
    ({ candidateId, matchScore }) as unknown as Match;

  it('puts the strongest match first', () => {
    // The repository returns matches in sort-key order, which is by candidate
    // id. These five are the demo fixtures in the order the store actually
    // returned them, read out of the running app: an employer met the
    // weakest-but-one first and had no way to know the order meant nothing.
    // Found by looking at the product, not by reading the code.
    const sorted = byStrongestMatch([
      match('cand_chioma', 0.75),
      match('cand_segun', 0.8),
      match('cand_amara', 0.6),
      match('cand_bayo', 0.7),
      match('cand_kelechi', 0.65),
    ]);
    expect(sorted.map((m) => m.matchScore)).toEqual([0.8, 0.75, 0.7, 0.65, 0.6]);
  });

  it('breaks ties by candidate id, so the order holds between page loads', () => {
    const sorted = byStrongestMatch([match('cand_z', 0.5), match('cand_a', 0.5)]);
    expect(sorted.map((m) => m.candidateId)).toEqual(['cand_a', 'cand_z']);
  });

  it('does not mutate what it was given', () => {
    const input = [match('cand_a', 0.1), match('cand_b', 0.9)];
    byStrongestMatch(input);
    expect(input.map((m) => m.candidateId)).toEqual(['cand_a', 'cand_b']);
  });
});

/**
 * Ordering by how well a match answers what the role asked for.
 *
 * Founder instruction, 2026-09-10: "make sure employers can see profiles they
 * have access to and also what they prefer would show first, for example they
 * prefer certain location, or hours".
 *
 * A role states the countries it can employ in and how far from its working
 * hours it can stretch. Both were already honoured — a candidate outside
 * either gets `fit: 'partial'` and a sentence saying what does not line up —
 * but neither reached the ordering, so a candidate in the wrong country with
 * broader proof sat above one the employer could actually hire.
 */
describe('what the employer asked for decides the order', () => {
  const fitted = (candidateId: string, matchScore: number, fit?: Match['fit']) =>
    ({ candidateId, matchScore, ...(fit ? { fit } : {}) }) as unknown as Match;

  it('puts a hireable candidate above a better-covered one who is out of area', () => {
    const sorted = byStrongestMatch([
      fitted('cand_faraway', 1, 'partial'),
      fitted('cand_local', 0.5, 'meets'),
    ]);
    expect(sorted.map((m) => m.candidateId)).toEqual(['cand_local', 'cand_faraway']);
  });

  it('still shows the out-of-area candidate, rather than filtering them out', () => {
    const sorted = byStrongestMatch([
      fitted('cand_faraway', 1, 'partial'),
      fitted('cand_local', 0.5, 'meets'),
    ]);
    expect(sorted).toHaveLength(2);
  });

  it('orders meets above partial above adjacent', () => {
    const sorted = byStrongestMatch([
      fitted('cand_c', 0.9, 'adjacent'),
      fitted('cand_a', 0.1, 'meets'),
      fitted('cand_b', 0.9, 'partial'),
    ]);
    expect(sorted.map((m) => m.fit)).toEqual(['meets', 'partial', 'adjacent']);
  });

  it('falls back to coverage between candidates who fit equally well', () => {
    const sorted = byStrongestMatch([
      fitted('cand_low', 0.4, 'meets'),
      fitted('cand_high', 0.9, 'meets'),
    ]);
    expect(sorted.map((m) => m.candidateId)).toEqual(['cand_high', 'cand_low']);
  });

  /**
   * A match stored before tiering existed carries no `fit`, and is read as
   * `meets` everywhere else in this file. A shortlist an employer already has
   * must not reorder itself because a field was added later.
   */
  it('reads a match with no recorded fit as meets, so old shortlists hold', () => {
    const sorted = byStrongestMatch([
      fitted('cand_partial', 0.9, 'partial'),
      fitted('cand_legacy', 0.5),
    ]);
    expect(sorted.map((m) => m.candidateId)).toEqual(['cand_legacy', 'cand_partial']);
  });
});

describe('recomputeMatchesForRole and the location filter', () => {
  const WAT = 60;
  const inLagos: CandidateLocation = { country: 'NG', utcOffsetMinutes: WAT };
  const inChicago: CandidateLocation = { country: 'US', utcOffsetMinutes: -300 };
  const nigeriaOnly: RoleLocationRequirement = {
    countries: ['NG'],
    utcOffsetMinutes: WAT,
    maxTimezoneDifferenceHours: null,
  };

  it('keeps a candidate who meets the requirement, and excludes nobody', async () => {
    const { deps } = createFakes({
      locationRequirement: nigeriaOnly,
      candidateLocation: inLagos,
    });
    const { matches, locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      deps,
    );
    expect(matches).toHaveLength(1);
    expect(locationExcluded).toBe(0);
  });

  /**
   * This used to write nothing at all. A candidate whose proof answered the
   * role was deleted for living in the wrong place, and the employer saw a
   * shorter list with a number beside it.
   *
   * They are kept now, as `partial`, with the location stated. The employer
   * still gets the number — it is what makes a location requirement a
   * decision rather than an invisible cost — but they also get the person,
   * and can judge whether remote or a relocation is worth discussing.
   */
  it('keeps a candidate outside the location requirement, saying where they are', async () => {
    const { deps, putCalls } = createFakes({
      locationRequirement: nigeriaOnly,
      candidateLocation: inChicago,
    });
    const { matches, locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      deps,
    );
    expect(matches).toHaveLength(1);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.fit).toBe('partial');
    expect(putCalls[0]?.fitReason).toContain("Outside this role's location requirement");
    // The count is still the whole point: an employer has to be able to see
    // what a filter is costing them without reading every card.
    expect(locationExcluded).toBe(1);
  });

  it('never excludes a candidate who has not stated a location', async () => {
    const { deps } = createFakes({ locationRequirement: nigeriaOnly });
    const { matches, locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      deps,
    );
    expect(matches).toHaveLength(1);
    expect(locationExcluded).toBe(0);
  });

  it('keeps an existing unpaid match when the role gains a location they fail', async () => {
    const existing: Match = {
      id: 'existing_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, deletedMatches, putCalls } = createFakes({
      existingMatch: existing,
      locationRequirement: nigeriaOnly,
      candidateLocation: inChicago,
    });
    const { locationExcluded } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    // Adding a location requirement no longer destroys a match. The row is
    // refreshed and demoted, so an employer who tightens a filter can still
    // see who it moved and undo the decision.
    expect(deletedMatches).toEqual([]);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.fit).toBe('partial');
    expect(locationExcluded).toBe(1);
  });

  /**
   * The case worth being careful about. An unlocked match is the employer's
   * record that they paid for this person's contact details. Deleting it
   * because the role's requirements changed afterwards would destroy a
   * purchase, and hiding it would hide something already bought and paid
   * for. It stays, and it says why it no longer fits.
   */
  it('keeps a paid unlock that no longer fits, and says so on the match', async () => {
    const paid: Match = {
      id: 'paid_match',
      roleId: ROLE_ID,
      candidateId: CANDIDATE_ID,
      matchScore: 0.9,
      status: 'contacted',
      contactUnlocked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { deps, deletedMatches, putCalls } = createFakes({
      existingMatch: paid,
      locationRequirement: nigeriaOnly,
      candidateLocation: inChicago,
    });
    const { matches, locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      deps,
    );
    expect(deletedMatches).toEqual([]);
    expect(matches).toHaveLength(1);
    expect(putCalls[0]?.contactUnlocked).toBe(true);
    // The location now lives on fitReason rather than being appended to the
    // rationale. rationale says which requirements the proof covers; fitReason
    // says why this person is not an exact answer. Two questions, two fields,
    // both shown on the card.
    expect(putCalls[0]?.fitReason).toContain("Outside this role's location requirement");
    expect(putCalls[0]?.fitReason).toContain('US');
    expect(putCalls[0]?.fit).toBe('partial');
    // Counted, because the number now means "meets your requirements, sits
    // outside your location" rather than "was removed". This person is
    // exactly that, and an employer weighing the filter should see them in it.
    expect(locationExcluded).toBe(1);
  });

  it('filters on timezone distance as well as country', async () => {
    const overlapRequired: RoleLocationRequirement = {
      countries: [],
      utcOffsetMinutes: WAT,
      maxTimezoneDifferenceHours: 3,
    };
    const { locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      createFakes({ locationRequirement: overlapRequired, candidateLocation: inChicago }).deps,
    );
    expect(locationExcluded).toBe(1);

    const nearby = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      createFakes({
        locationRequirement: overlapRequired,
        candidateLocation: { country: 'KE', utcOffsetMinutes: 180 },
      }).deps,
    );
    expect(nearby.matches).toHaveLength(1);
  });

  it('filters nobody when the role states no requirement, which is every existing role', async () => {
    const { matches, locationExcluded } = await recomputeMatchesForRole(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      createFakes({ candidateLocation: inChicago }).deps,
    );
    expect(matches).toHaveLength(1);
    expect(locationExcluded).toBe(0);
  });
});

/**
 * The employer is told what the candidate wants, not only when it clashes.
 *
 * `intent.openTo` decided whether a mismatch sentence appeared in the fit
 * reason and was otherwise invisible, so an employer could not tell a
 * candidate open to tutoring from one who had never answered. The person
 * about to spend an unlock is exactly who needs that, and the fact was
 * already in the record.
 *
 * Written beside `fitReason` and from the same read, so a shortlist can
 * never carry a preference that disagrees with the explanation next to it.
 */
describe('the shortlist carries what the candidate is open to', () => {
  it('records the kinds they chose', async () => {
    const { deps } = createFakes({
      candidateIntent: { openTo: ['tutoring', 'mentoring'], note: '' },
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches[0]?.candidateOpenTo).toEqual(['tutoring', 'mentoring']);
  });

  it('records an empty list when they stated no preference', async () => {
    // Empty is their answer and means matching ruled nothing out. Leaving
    // the field absent would make it indistinguishable from a row written
    // before this existed.
    const { deps } = createFakes({ candidateIntent: { openTo: [], note: '' } });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches[0]?.candidateOpenTo).toEqual([]);
  });

  it('agrees with the mismatch sentence it is shown beside', async () => {
    // Both come from one read of openTo. If they could disagree, an
    // employer would see "open to tutoring" above a reason saying tutoring
    // was not among the kinds they accept.
    const { deps } = createFakes({
      candidateIntent: { openTo: ['tutoring'], note: '' },
      roleIntent: { engagementKind: 'employment' },
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    const match = matches[0];
    expect(match?.candidateOpenTo).toEqual(['tutoring']);
    expect(match?.fitReason).toContain('not among');
  });
});

/**
 * An employer who pays to reach somebody must be able to reach them.
 *
 * Founder decision, 2026-09-14. A contact unlock spends one of a metered
 * monthly allowance, and an email address on its own is the channel a
 * stranger's message is most likely to die in. So being findable now means
 * carrying a phone number and one link to where the work lives.
 *
 * Enforced here rather than at save time on purpose: a candidate who signed
 * up before the rule keeps their profile, their claims and their proofs, and
 * simply is not shown until an employer could act on the result. Their own
 * profile panel names exactly what is missing.
 */
describe('only candidates an employer could reach are shortlisted', () => {
  it('skips a candidate with no contact channels at all', async () => {
    const { deps } = createFakes({
      candidateOverrides: { phone: undefined, websiteUrl: undefined },
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toEqual([]);
  });

  it('skips a candidate who can be reached but shows no work', async () => {
    const { deps } = createFakes({ candidateOverrides: { websiteUrl: undefined } });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toEqual([]);
  });

  it('skips a candidate whose work is visible but who cannot be reached', async () => {
    const { deps } = createFakes({ candidateOverrides: { phone: undefined } });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches).toEqual([]);
  });

  it('accepts LinkedIn in place of a site of their own', async () => {
    // Requiring a personal site would turn away candidates who prove
    // themselves through certifications and repositories, which shrinks the
    // marketplace the employer is paying for.
    const { deps } = createFakes({
      candidateOverrides: {
        websiteUrl: undefined,
        linkedinUrl: 'https://www.linkedin.com/in/somebody',
      },
    });
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches.length).toBe(1);
  });

  it('shortlists a candidate who is reachable and whose work is visible', async () => {
    const { deps } = createFakes();
    const { matches } = await recomputeMatchesForRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(matches.length).toBe(1);
  });
});
