import { describe, expect, it } from 'vitest';
import { MatchSchema } from '@zoryvex/contracts';
import { listRolesForCandidate } from '../src/domain/interest-service';
import { getMatchesForRole } from '../src/domain/matching-service';

/**
 * Each side reads an explanation written for it.
 *
 * One string served both screens. It was authored for the employer's
 * shortlist, so it said "they" and "their proof", and the candidate's own
 * list of roles rendered it unchanged: a person read a paragraph about
 * themselves in the third person, as though the site were discussing them
 * with somebody else.
 *
 * The worse half was quieter. The pay sentence named the figure the
 * candidate had entered as their minimum, and it went to the employer. The
 * field that collects that figure says, on the profile page, that it is
 * never shown to an employer as a demand. An employer looking at a
 * shortlist was reading the number anyway, before paying for anything.
 *
 * `fitReason` is the employer's and `fitReasonForCandidate` is the
 * candidate's, and these hold the wall between them.
 */

const clock = { now: () => new Date('2026-09-11T00:00:00.000Z') };

const role = {
  id: 'role_1',
  employerId: 'emp_1',
  launchTrack: 'aws_cloud' as const,
  title: 'Platform lead',
  seniority: 'senior' as const,
  outcomes: 'Own the landing zone.',
  mustHaveWork: ['Has designed a multi-account structure'],
  constraints: '',
  status: 'active' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function matchWith(over: Record<string, unknown>) {
  return MatchSchema.parse({
    id: 'match_1',
    roleId: 'role_1',
    candidateId: 'cand_1',
    matchScore: 0.4,
    status: 'suggested',
    contactUnlocked: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });
}

function depsFor(match: ReturnType<typeof matchWith>) {
  return {
    clock,
    listMatchesForCandidate: async () => [match],
    getRole: async () => ({ role, version: 1 }),
  } as unknown as Parameters<typeof listRolesForCandidate>[1];
}

describe('a candidate is never handed the employer explanation', () => {
  it('returns the sentence written for them', async () => {
    const views = await listRolesForCandidate(
      'cand_1',
      depsFor(
        matchWith({
          fit: 'partial',
          fitReason: 'This role pays up to NGN 600,000 per month, which is below what they need.',
          fitReasonForCandidate:
            'This role pays up to NGN 600,000 per month, and you said you need at least NGN 900,000.',
        }),
      ),
    );

    expect(views[0]?.fitReason).toContain('you said you need at least');
  });

  /** The defect: the employer's wording reaching the candidate's screen. */
  it('does not fall back to the employer sentence', async () => {
    const views = await listRolesForCandidate(
      'cand_1',
      depsFor(
        matchWith({
          fit: 'partial',
          fitReason: 'They work in MLOps rather than Cloud engineering.',
        }),
      ),
    );

    expect(views[0]?.fitReason).toBeUndefined();
  });

  it('shows nothing rather than something wrong on a shortlist built before this existed', async () => {
    const views = await listRolesForCandidate('cand_1', depsFor(matchWith({ fit: 'meets' })));
    expect(views[0]?.fitReason).toBeUndefined();
    expect(views[0]?.roleTitle).toBe('Platform lead');
  });
});

/**
 * And the employer's copy of the row does not carry the other one.
 *
 * Taking the sentence off the employer's screen is not the same as taking
 * it out of the employer's response. The shortlist endpoint serializes the
 * whole Match, so a field left on the object travels to the browser and
 * sits in the response body, where it is one devtools panel away from
 * being read and one future component away from being rendered.
 */
describe('the employer shortlist does not carry the candidate sentence', () => {
  const withBoth = matchWith({
    fit: 'partial',
    fitReason:
      'This role pays up to NGN 600,000 per month, which is below what they said they need.',
    fitReasonForCandidate:
      'This role pays up to NGN 600,000 per month, and you said you need at least NGN 900,000.',
  });

  const employerDeps = {
    getRole: async () => ({ role, version: 1 }),
    listMatchesForRole: async () => [withBoth],
    getFeatureFlags: async () => ({ aiMatching: false }),
  } as unknown as Parameters<typeof getMatchesForRole>[2];

  it('strips it from the response the employer receives', async () => {
    const matches = await getMatchesForRole('emp_1', 'role_1', employerDeps);
    expect(matches[0]?.fitReasonForCandidate).toBeUndefined();
  });

  it('and the figure is nowhere in the serialized payload', async () => {
    const matches = await getMatchesForRole('emp_1', 'role_1', employerDeps);
    expect(JSON.stringify(matches)).not.toContain('900,000');
  });

  it('while keeping the explanation the employer is meant to read', async () => {
    const matches = await getMatchesForRole('emp_1', 'role_1', employerDeps);
    expect(matches[0]?.fitReason).toContain('below what they said they need');
  });
});
