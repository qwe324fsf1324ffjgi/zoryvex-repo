import { describe, expect, it } from 'vitest';
import type { InterestState, Match, Role } from '@zoryvex/contracts';
import {
  contactUnlockBlockedByCandidate,
  listRolesForCandidate,
  setCandidateInterest,
  interestNoticeBody,
  setEmployerInterest,
  type InterestDependencies,
} from '../src/domain/interest-service';
import { ForbiddenError, NotFoundError } from '../src/errors/typed-errors';

const OWNER = 'emp_owner';
const OTHER_EMPLOYER = 'emp_other';
const ROLE_ID = 'role_1';
const CANDIDATE_ID = 'cand_1';
const OTHER_CANDIDATE = 'cand_2';
const NOW = new Date('2026-09-11T12:00:00.000Z');

const role: Role = {
  id: ROLE_ID,
  employerId: OWNER,
  launchTrack: 'aws_cloud',
  title: 'Platform engineer',
  seniority: 'mid',
  outcomes: 'Run the platform',
  mustHaveWork: ['Terraform'],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  intent: {
    engagementKind: 'employment',
    compensation: { minNGN: 800_000, maxNGN: 1_200_000, period: 'month' },
  },
};

const match: Match = {
  id: 'match_1',
  roleId: ROLE_ID,
  candidateId: CANDIDATE_ID,
  matchScore: 0.8,
  status: 'suggested',
  contactUnlocked: false,
  createdAt: '2026-09-01T00:00:00.000Z',
};

function createFakes(
  input: {
    match?: Match | null;
    roles?: Record<string, Role>;
    discoveryOptIn?: boolean;
    candidateMissing?: boolean;
    rateLimited?: boolean;
    sendFails?: boolean;
    access?: 'active' | 'grace' | 'suspended' | 'none';
  } = {},
) {
  let stored: Match | null = input.match === undefined ? { ...match } : input.match;
  const roles = input.roles ?? { [ROLE_ID]: role };
  const audits: { action: string; actorId: string; reason?: string | undefined }[] = [];
  const interestWrites: { roleId: string; candidateId: string; patch: unknown }[] = [];
  const notices: {
    email: string;
    displayName: string;
    organizationName: string;
    roleTitle: string;
  }[] = [];
  let rateLimitCalls = 0;

  const deps: InterestDependencies = {
    clock: { now: () => NOW },
    async getRole(roleId) {
      const found = roles[roleId];
      return found ? { role: found, version: 1 } : null;
    },
    async getMatch(roleId, candidateId) {
      if (!stored) return null;
      return stored.roleId === roleId && stored.candidateId === candidateId ? stored : null;
    },
    async listMatchesForCandidate(candidateId) {
      return stored && stored.candidateId === candidateId ? [stored] : [];
    },
    async updateMatchInterest(roleId, candidateId, patch) {
      interestWrites.push({ roleId, candidateId, patch });
      if (!stored || stored.roleId !== roleId || stored.candidateId !== candidateId) return null;
      stored = { ...stored, ...patch };
      return stored;
    },
    async appendAuditEvent(event) {
      audits.push({ action: event.action, actorId: event.actorId, reason: event.reason });
      return event;
    },
    generateId: () => 'generated',
    async getCandidate(candidateId) {
      if (input.candidateMissing) return null;
      return {
        candidate: {
          id: candidateId,
          accountId: 'acct_1',
          email: 'cand@example.com',
          displayName: 'Amara',
          launchTrack: 'aws_cloud',
          discoveryOptIn: input.discoveryOptIn ?? true,
          onboardingComplete: true,
          createdAt: '2026-08-19T00:00:00.000Z',
          updatedAt: '2026-08-19T00:00:00.000Z',
        } as never,
        version: 1,
      };
    },
    async getEmployer(employerId) {
      return {
        id: employerId,
        organizationName: 'Northwind',
        contactEmail: 'ops@northwind.test',
      } as never;
    },
    async getMarketplaceAccess() {
      // Defaults to a paying organization, so assertions written before
      // interest became a paid action keep describing what they meant.
      return input.access ?? 'active';
    },
    async checkRateLimit() {
      rateLimitCalls += 1;
      return { allowed: input.rateLimited ? false : true };
    },
    async notifyCandidateOfInterest(notice) {
      if (input.sendFails) throw new Error('SES refused');
      notices.push(notice);
    },
  };

  return {
    deps,
    audits,
    interestWrites,
    notices,
    current: () => stored,
    rateLimitCalls: () => rateLimitCalls,
  };
}

describe('an employer saying yes to a candidate', () => {
  it('records the interest on the match', async () => {
    const { deps, current } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(current()?.employerInterest).toBe('interested');
  });

  it('writes only the employer side, never the candidate answer', async () => {
    const { deps, interestWrites } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(interestWrites[0]?.patch).toEqual({ employerInterest: 'interested' });
  });

  /**
   * The ID-substitution case. `roleId` comes from the URL, so without the
   * ownership check any employer could write onto a competitor's
   * shortlist by guessing ids.
   */
  it('refuses an employer who does not own the role', async () => {
    const { deps, current } = createFakes();
    await expect(
      setEmployerInterest(OTHER_EMPLOYER, ROLE_ID, CANDIDATE_ID, 'interested', deps),
    ).rejects.toThrow('Role not found');
    expect(current()?.employerInterest).toBeUndefined();
  });

  it('says not found for a role that does not exist, revealing nothing', async () => {
    const { deps } = createFakes();
    await expect(
      setEmployerInterest(OWNER, 'role_missing', CANDIDATE_ID, 'interested', deps),
    ).rejects.toThrow('Role not found');
  });

  /** A recompute can drop the match between the page rendering and the click. */
  it('refuses when the match has gone, rather than inventing one', async () => {
    const { deps } = createFakes({ match: null });
    await expect(
      setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps),
    ).rejects.toThrow('Match not found');
  });

  it('leaves an audit trail naming who decided what', async () => {
    const { deps, audits } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'declined', deps);
    expect(audits).toEqual([
      { action: 'employer_interest_set', actorId: OWNER, reason: 'declined' },
    ]);
  });

  it('is idempotent: saying the same thing twice changes nothing new', async () => {
    const { deps, current } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(current()?.employerInterest).toBe('interested');
  });

  it('lets an employer change their mind', async () => {
    const { deps, current } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'declined', deps);
    expect(current()?.employerInterest).toBe('declined');
  });
});

describe('a candidate answering a role', () => {
  it('records their side', async () => {
    const { deps, current } = createFakes();
    await setCandidateInterest(CANDIDATE_ID, ROLE_ID, 'interested', deps);
    expect(current()?.candidateInterest).toBe('interested');
  });

  it('writes only the candidate side', async () => {
    const { deps, interestWrites } = createFakes();
    await setCandidateInterest(CANDIDATE_ID, ROLE_ID, 'declined', deps);
    expect(interestWrites[0]?.patch).toEqual({ candidateInterest: 'declined' });
  });

  /**
   * A candidate cannot answer a role they were never matched to. Without
   * this, the endpoint becomes an open application inbox the product does
   * not have and did not promise.
   */
  it('refuses a role the candidate was never matched to', async () => {
    const { deps } = createFakes();
    await expect(
      setCandidateInterest(OTHER_CANDIDATE, ROLE_ID, 'interested', deps),
    ).rejects.toThrow('Match not found');
  });

  /**
   * The invariant the previous test cannot isolate.
   *
   * Removing the pre-read check breaks nothing observable, because the
   * write is also addressed by the composite key (role + candidate) and
   * returns null for a row that is not there. That is defence in depth
   * and is fine — but it means the refusal test passes whichever
   * mechanism is doing the work, so a mutation deleting one of them looks
   * harmless.
   *
   * What must never change is *which* candidate id addresses the write.
   * It comes from the session. If a refactor ever threaded a
   * request-supplied id through here instead, both the read and the write
   * would be scoped to somebody else's row and every test above would
   * still pass.
   */
  it('addresses the write with the calling candidate, never a supplied id', async () => {
    const { deps, interestWrites } = createFakes();
    await setCandidateInterest(CANDIDATE_ID, ROLE_ID, 'interested', deps);

    expect(interestWrites).toHaveLength(1);
    expect(interestWrites[0]?.candidateId).toBe(CANDIDATE_ID);
    expect(interestWrites[0]?.roleId).toBe(ROLE_ID);
  });

  /**
   * And the same for the employer side, where the candidate id genuinely
   * does come from the URL: it must reach the write unchanged, scoped by
   * a role the ownership check has already proven belongs to the caller.
   */
  it('scopes the employer write to the named role and candidate', async () => {
    const { deps, interestWrites } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);

    expect(interestWrites[0]?.roleId).toBe(ROLE_ID);
    expect(interestWrites[0]?.candidateId).toBe(CANDIDATE_ID);
  });
});

describe('what a candidate can see about their own matches', () => {
  it('lists the role, how it fits, and what it pays', async () => {
    const { deps } = createFakes();
    const [view] = await listRolesForCandidate(CANDIDATE_ID, deps);
    expect(view?.roleTitle).toBe('Platform engineer');
    expect(view?.compensation?.compensation?.minNGN).toBe(800_000);
  });

  it('reads an unanswered match as unstated on both sides, not as a refusal', async () => {
    const { deps } = createFakes();
    const [view] = await listRolesForCandidate(CANDIDATE_ID, deps);
    expect(view?.candidateInterest).toBe('unstated');
    expect(view?.employerInterest).toBe('unstated');
    expect(view?.mutual).toBe(false);
  });

  it('is mutual only once both sides have said yes', async () => {
    const { deps } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    let [view] = await listRolesForCandidate(CANDIDATE_ID, deps);
    expect(view?.mutual).toBe(false);

    await setCandidateInterest(CANDIDATE_ID, ROLE_ID, 'interested', deps);
    [view] = await listRolesForCandidate(CANDIDATE_ID, deps);
    expect(view?.mutual).toBe(true);
  });

  it('shows nothing to a candidate with no matches', async () => {
    const { deps } = createFakes();
    expect(await listRolesForCandidate(OTHER_CANDIDATE, deps)).toEqual([]);
  });

  /** A match whose role has been deleted is a dangling row, not a blank card. */
  it('drops a match whose role no longer exists', async () => {
    const { deps } = createFakes({ roles: {} });
    expect(await listRolesForCandidate(CANDIDATE_ID, deps)).toEqual([]);
  });

  /**
   * What a candidate must never learn from this view: anything about the
   * other people matched to the same role.
   */
  it('exposes no other candidate and no shortlist internals', async () => {
    const { deps } = createFakes();
    const [view] = await listRolesForCandidate(CANDIDATE_ID, deps);
    const keys = Object.keys(view ?? {});
    expect(keys).not.toContain('candidateId');
    expect(keys).not.toContain('otherMatches');
    expect(keys).not.toContain('contactUnlocked');
  });
});

describe('a candidate who declined blocks an unlock', () => {
  it.each<[InterestState | undefined, boolean]>([
    ['declined', true],
    ['interested', false],
    ['unstated', false],
    [undefined, false],
  ])('candidateInterest %s blocks: %s', (state, blocked) => {
    expect(contactUnlockBlockedByCandidate({ candidateInterest: state })).toBe(blocked);
  });
});

/**
 * Telling the candidate, which is the half that did not exist.
 *
 * An employer could say yes and nothing reached the candidate at all: the
 * answer lived in a match row that only surfaced if they happened to sign in
 * and open Matches. Somebody who checks once a fortnight could miss the only
 * offer they were going to get, and no screen suggested there was a reason
 * to look. `InterestDependencies` had no way to send anything.
 *
 * The rules below are the ones that decide whether a real person is
 * disturbed, so each is pinned rather than left to the implementation.
 */
describe('the candidate is told an employer said yes', () => {
  it('sends the notice, naming the organisation and the role', async () => {
    const { deps, notices } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({
      email: 'cand@example.com',
      displayName: 'Amara',
      organizationName: 'Northwind',
      roleTitle: role.title,
    });
  });

  it('says nothing when the employer says no', async () => {
    // Declining is not news a candidate needs, and mailing it would teach
    // people that a Zoryvex message is usually a rejection.
    const { deps, notices } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'declined', deps);
    expect(notices).toEqual([]);
  });

  it('does not send again when the answer was already yes', async () => {
    // Pressing the button twice, or a re-render, is not a second decision.
    const { deps, notices } = createFakes({
      match: { ...match, employerInterest: 'interested' },
    });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(notices).toEqual([]);
  });

  it('sends when a previous no becomes a yes', async () => {
    // A genuine change of mind is a genuine event.
    const { deps, notices } = createFakes({
      match: { ...match, employerInterest: 'declined' },
    });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(notices).toHaveLength(1);
  });

  it('stays silent when the daily limit is already spent', async () => {
    // Stops an employer flip-flopping between yes and no from mailing the
    // candidate on every swing back.
    const { deps, notices } = createFakes({ rateLimited: true });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(notices).toEqual([]);
  });

  it('stays silent for a candidate who left discovery', async () => {
    // Re-read rather than trusted from the match, the same rule the
    // profile-view notice follows: somebody who opted out stops hearing
    // about being looked at.
    const { deps, notices } = createFakes({ discoveryOptIn: false });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(notices).toEqual([]);
  });

  it('still records the interest when the send fails, and logs that nobody was told', async () => {
    // The employer's decision succeeded. Throwing here would report a
    // failure for something that worked and invite a retry that says yes a
    // second time. The candidate not being told is the part that costs
    // somebody something, so it leaves a row the exception queue reads.
    const { deps, audits, current } = createFakes({ sendFails: true });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);

    expect(current()?.employerInterest).toBe('interested');
    expect(audits.map((a) => a.action)).toContain('employer_interest_notice_failed');
  });

  it('never carries a way to reach the employer outside the product', async () => {
    // Interest is an answer, not consent to be contacted. Contact runs the
    // other way, through a paid unlock the candidate separately consented
    // to, so the employer's own address must not travel in this mail.
    const { deps, notices } = createFakes();
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(JSON.stringify(notices)).not.toContain('ops@northwind.test');
  });
});

describe('the words the candidate receives', () => {
  const body = () =>
    interestNoticeBody({
      displayName: 'Amara',
      organizationName: 'Northwind',
      roleTitle: 'Cloud Engineer',
      matchesUrl: 'https://zoryvex.space/candidate/matches',
      profileUrl: 'https://zoryvex.space/candidate/profile',
    });

  it('points at the one screen where the answer can be given', () => {
    // The profile cannot answer a match. A notice that lands somebody on the
    // wrong page is one they act on once and then ignore.
    expect(body()).toContain('https://zoryvex.space/candidate/matches');
  });

  it('says an answer is wanted', () => {
    expect(body()).toContain('needs an answer');
  });

  it('says answering shares no contact details', () => {
    // Somebody who suspects that saying yes hands over their number will not
    // say yes, and they would be wrong.
    expect(body()).toContain('shares none of your contact details');
  });

  it('says how to stop receiving them', () => {
    expect(body()).toContain('https://zoryvex.space/candidate/profile');
  });
});

/**
 * Saying yes is free, and stays free.
 *
 * Interest is the cheap question: is a conversation welcome at all. An
 * employer who answers it before paying finds out whether the interest is
 * returned before spending an unlock on somebody who does not want the role,
 * and a candidate gets to put their hand up for work without anybody having
 * bought anything. Gating it would invert that.
 *
 * Pinned because the neighbouring read is gated. `getMatchEvidence` now
 * refuses without marketplace access, and `InterestDependencies` has no
 * `getMarketplaceAccess` at all, so the only thing stopping a future change
 * from extending that gate one endpoint too far is a test saying it must
 * not. The entitlement belongs on contact unlock, which spends an allowance
 * and discloses an address; interest does neither.
 */
/**
 * Saying yes is a paid action.
 *
 * It was free until 2026-09-14, on the reasoning that an employer should be
 * able to learn whether interest is returned before spending anything. The
 * founder reversed that: the subscription is what the marketplace sells, and
 * reaching a candidate at all is what it sells it for.
 *
 * The asymmetry below is deliberate and is the part worth guarding. Saying
 * yes needs a subscription; taking it back does not. An employer whose card
 * failed must still be able to withdraw a yes the candidate is looking at,
 * because a stale yes is a conversation that never comes and the candidate
 * has no way to tell the difference.
 */
describe('showing interest is a paid action', () => {
  it('lets a paying employer say yes', async () => {
    const { deps, current } = createFakes({ access: 'active' });
    const updated = await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(updated.employerInterest).toBe('interested');
    expect(current()?.employerInterest).toBe('interested');
  });

  it('lets them say yes during the grace window after a failed renewal', async () => {
    // A card that expired on a Friday is not a decision to stop paying.
    // This must agree with contact unlock, which uses the same predicate.
    const { deps } = createFakes({ access: 'grace' });
    const updated = await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps);
    expect(updated.employerInterest).toBe('interested');
  });

  for (const access of ['none', 'suspended'] as const) {
    it(`refuses a yes when access is ${access}`, async () => {
      const { deps, current } = createFakes({ access });
      await expect(
        setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // And nothing was written, so a refused click leaves no trace the
      // candidate could see.
      expect(current()?.employerInterest).toBeUndefined();
    });
  }

  it('says why, in words an employer can act on', async () => {
    const { deps } = createFakes({ access: 'none' });
    const error = await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps).catch(
      (e) => e,
    );
    expect(String(error.message)).toContain('subscription');
  });

  it('still lets an unpaid employer withdraw a yes they already gave', async () => {
    // The asymmetry. A lapsed subscription must not trap a candidate in an
    // interest that is no longer real.
    const { deps, current } = createFakes({
      access: 'none',
      match: { ...match, employerInterest: 'interested' },
    });
    const updated = await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'declined', deps);
    expect(updated.employerInterest).toBe('declined');
    expect(current()?.employerInterest).toBe('declined');
  });

  it('sends no notice when the yes was refused', async () => {
    const { deps, notices } = createFakes({ access: 'none' });
    await setEmployerInterest(OWNER, ROLE_ID, CANDIDATE_ID, 'interested', deps).catch(() => {});
    expect(notices).toEqual([]);
  });

  it('refuses another employer role before it considers the subscription', async () => {
    // Order matters. Answering "you need a subscription" for a role that is
    // not theirs would confirm the role exists.
    const { deps } = createFakes({ access: 'none' });
    await expect(
      setEmployerInterest(OTHER_EMPLOYER, ROLE_ID, CANDIDATE_ID, 'interested', deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
