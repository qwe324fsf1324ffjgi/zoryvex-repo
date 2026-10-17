import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import {
  MARKETPLACE_GATE_MIN_MATCHES,
  type AccessState,
  type AuditEvent,
  type Candidate,
  type Match,
  type Role,
} from '@zoryvex/contracts';
import {
  contactUnlockNoticeBody,
  unlockContact,
  getUnlockedContactInfo,
  type ContactUnlockDependencies,
  type GetUnlockedContactDependencies,
} from '../src/domain/contact-unlock-service';
import type { ContactUnlockOutcome } from '../src/repositories/match-repository';
import { ForbiddenError, NotFoundError } from '../src/errors/typed-errors';

const EMPLOYER_ID = 'emp_1';
const OTHER_EMPLOYER_ID = 'emp_2';
const ROLE_ID = 'role_1';
const CANDIDATE_ID = 'cand_1';

const role: Role = {
  id: ROLE_ID,
  employerId: EMPLOYER_ID,
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra',
  mustHaveWork: ['Terraform'],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const consentedCandidate: Candidate = {
  id: CANDIDATE_ID,
  email: 'cand@example.com',
  displayName: 'A',
  launchTrack: 'aws_cloud',
  discoveryOptIn: true,
  contactUnlockConsent: true,
  onboardingComplete: true,
  summary: '',
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

function baseMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match_1',
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    matchScore: 0.9,
    status: 'suggested',
    contactUnlocked: false,
    createdAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(input: {
  match?: Match | null;
  candidate?: Candidate | null;
  plan?: string | null;
  unlockOutcome?: ContactUnlockOutcome;
  contactUnlocks?: boolean;
  notifyFails?: boolean;
  matchCount?: number;
  access?: AccessState;
  aiMatching?: boolean;
}) {
  const auditEvents: AuditEvent[] = [];
  const notices: Array<{ email: string; displayName: string; roleTitle: string }> = [];
  const deps: ContactUnlockDependencies = {
    clock: { now: () => new Date('2026-08-19T01:00:00.000Z') },
    async getFeatureFlags() {
      return {
        ...DEFAULT_FEATURE_FLAGS,
        contactUnlocks: input.contactUnlocks ?? true,
        aiMatching: input.aiMatching ?? false,
      };
    },
    async getRole(roleId) {
      return roleId === ROLE_ID ? { role, version: 1 } : null;
    },
    async getMatch() {
      return input.match === undefined ? baseMatch() : input.match;
    },
    async getCandidate() {
      return input.candidate === undefined
        ? { candidate: consentedCandidate, version: 1 }
        : input.candidate
          ? { candidate: input.candidate, version: 1 }
          : null;
    },
    async countMatchesForRole() {
      return input.matchCount ?? MARKETPLACE_GATE_MIN_MATCHES;
    },
    async getEntitlementPlan() {
      return input.plan === undefined ? 'scout' : input.plan;
    },
    async getMarketplaceAccess() {
      return input.access ?? 'active';
    },
    async unlockContactAtomic() {
      return input.unlockOutcome ?? { allowed: true, match: baseMatch({ contactUnlocked: true }) };
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
    async notifyCandidateOfUnlock(notice) {
      if (input.notifyFails) throw new Error('SES is unavailable');
      notices.push(notice);
    },
    generateId: () => 'audit_1',
  };
  return { deps, auditEvents, notices };
}

describe('unlockContact', () => {
  it('succeeds for an owning employer, a consented candidate, and an active plan', async () => {
    const { deps, auditEvents } = createFakes({});
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.alreadyUnlocked).toBe(false);
    expect(result.match.contactUnlocked).toBe(true);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.action).toBe('contact_unlock');
  });

  it('rejects a role belonging to another employer', async () => {
    const { deps } = createFakes({});
    await expect(
      unlockContact(OTHER_EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when no match exists', async () => {
    const { deps } = createFakes({ match: null });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('is idempotent: an already-unlocked match returns success without a new transaction/audit event', async () => {
    const { deps, auditEvents } = createFakes({ match: baseMatch({ contactUnlocked: true }) });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.alreadyUnlocked).toBe(true);
    expect(auditEvents).toHaveLength(0);
  });

  it('rejects when the candidate has not consented to contact sharing — server-side, never client-asserted', async () => {
    const { deps } = createFakes({
      candidate: { ...consentedCandidate, contactUnlockConsent: false },
    });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rejects when consent was never explicitly given (undefined defaults to not-consented)', async () => {
    const { deps } = createFakes({
      candidate: { ...consentedCandidate, contactUnlockConsent: undefined },
    });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rejects when the employer has no active plan (zero allowance)', async () => {
    const { deps } = createFakes({ plan: 'none' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rejects when the Kit-only plan has zero contact-unlock allowance', async () => {
    const { deps } = createFakes({ plan: 'kit' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rejects when the atomic transaction reports the allowance is exhausted, without a duplicate audit event', async () => {
    const { deps, auditEvents } = createFakes({
      unlockOutcome: { allowed: false, reason: 'allowance_exhausted' },
    });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(auditEvents).toHaveLength(0);
  });

  it('recovers gracefully when the atomic transaction loses a race to a concurrent unlock (already_unlocked_or_not_found)', async () => {
    let callCount = 0;
    const { deps, auditEvents } = createFakes({
      unlockOutcome: { allowed: false, reason: 'already_unlocked_or_not_found' },
    });
    // After the race, a fresh getMatch should show it unlocked (by the winner).
    deps.getMatch = async () => {
      callCount += 1;
      return callCount === 1 ? baseMatch() : baseMatch({ contactUnlocked: true });
    };
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.alreadyUnlocked).toBe(true);
    expect(auditEvents).toHaveLength(0);
  });
});

describe('getUnlockedContactInfo', () => {
  function createGetContactFakes(input: { match?: Match | null; candidate?: Candidate | null }) {
    const deps: GetUnlockedContactDependencies = {
      async getFeatureFlags() {
        return { ...DEFAULT_FEATURE_FLAGS, contactUnlocks: true };
      },
      async getRole(roleId) {
        return roleId === ROLE_ID ? { role, version: 1 } : null;
      },
      async getMatch() {
        return input.match === undefined ? baseMatch({ contactUnlocked: true }) : input.match;
      },
      async getCandidate() {
        return input.candidate === undefined
          ? { candidate: consentedCandidate, version: 1 }
          : input.candidate
            ? { candidate: input.candidate, version: 1 }
            : null;
      },
    };
    return { deps };
  }

  it('returns the candidate email and display name once already unlocked', async () => {
    const { deps } = createGetContactFakes({});
    const result = await getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result).toEqual({
      email: consentedCandidate.email,
      displayName: consentedCandidate.displayName,
    });
  });

  /**
   * Guards a real privacy bug found in a 2026-08-27 audit. unlockContact
   * checked contactUnlockConsent, but this route — the one that actually
   * returns the email address — checked only match.contactUnlocked. A
   * candidate who revoked consent kept having their email served to the
   * employer on every request, forever, so revocation had no effect on the
   * single endpoint that discloses it. privacy-service.ts advertises consent
   * as reversible; it was not.
   */
  it('refuses to keep serving the email after the candidate withdraws consent', async () => {
    const { deps } = createGetContactFakes({
      candidate: { ...consentedCandidate, contactUnlockConsent: false },
    });
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('serves the email again if the candidate consents a second time', async () => {
    // The unlock itself is never undone (the allowance stays spent), so
    // renewed consent must not require the employer to pay again.
    const { deps } = createGetContactFakes({
      candidate: { ...consentedCandidate, contactUnlockConsent: true },
      match: baseMatch({ contactUnlocked: true }),
    });
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).resolves.toMatchObject({ email: consentedCandidate.email });
  });

  it('rejects a role belonging to another employer', async () => {
    const { deps } = createGetContactFakes({});
    await expect(
      getUnlockedContactInfo(OTHER_EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects when no match exists at all', async () => {
    const { deps } = createGetContactFakes({ match: null });
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when a match exists but contact was never unlocked — this is the core boundary, never bypassable', async () => {
    const { deps } = createGetContactFakes({ match: baseMatch({ contactUnlocked: false }) });
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when the candidate record is somehow gone despite an unlocked match', async () => {
    const { deps } = createGetContactFakes({ candidate: null });
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/**
 * Guards a real bug found in a 2026-08-27 audit, and the most consequential
 * of its kind this session.
 *
 * scripts/emergency-cost-lockdown.mjs sets `contactUnlocks: false`, and its
 * own header says it "disables AI, contact unlock and expensive jobs". The
 * contact-unlock half was a no-op: the flag was written to Parameter Store
 * by every environment, read by getFeatureFlags, and consulted by no code
 * anywhere. In a real incident the founder would have run the lockdown, seen
 * it succeed, and contact unlocks would have carried on spending allowance
 * and disclosing addresses.
 *
 * A flag that gates nothing is worse than no flag at all: it is a control an
 * operator believes they have.
 */
describe('the contactUnlocks kill switch actually stops contact unlocks', () => {
  it('refuses a new unlock while the flag is off', async () => {
    const { deps } = createFakes({ contactUnlocks: false });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('does not spend the allowance when it refuses', async () => {
    // Checked before the transaction, so a lockdown can never leave an
    // employer charged for an unlock that did not happen.
    const fakes = createFakes({ contactUnlocks: false });
    await expect(
      unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, fakes.deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fakes.auditEvents).toEqual([]);
  });

  it('stops serving already-unlocked addresses too', async () => {
    // A switch that blocks new unlocks while every previously unlocked
    // address keeps being served is not a kill switch. This is the same
    // read-path gap that made the aiMatching flag ineffective.
    const deps: GetUnlockedContactDependencies = {
      async getFeatureFlags() {
        return { ...DEFAULT_FEATURE_FLAGS, contactUnlocks: false };
      },
      async getRole() {
        return { role, version: 1 };
      },
      async getMatch() {
        return baseMatch({ contactUnlocked: true });
      },
      async getCandidate() {
        return { candidate: consentedCandidate, version: 1 };
      },
    };
    await expect(
      getUnlockedContactInfo(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('telling the candidate their contact was shared', () => {
  /**
   * The employer's confirmation dialog has always said "the candidate is
   * notified that you've unlocked their contact", and the local demo path
   * really does send that mail. This path did not: it flipped a flag, wrote
   * an audit event, and left the candidate to find out by receiving an
   * unexpected email from a stranger.
   */
  it('sends the candidate a notice naming the role', async () => {
    const { deps, notices } = createFakes({});
    await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(notices).toEqual([
      { email: 'cand@example.com', displayName: 'A', roleTitle: role.title },
    ]);
  });

  it('does not fail the unlock when the notice cannot be sent', async () => {
    // The allowance is already spent and the flag already flipped. Throwing
    // here would report a failure for something that succeeded, and tempt a
    // retry that spends a second unlock.
    const { deps, auditEvents } = createFakes({ notifyFails: true });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.match.contactUnlocked).toBe(true);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'contact_unlock',
      'contact_unlock_notice_failed',
    ]);
    expect(auditEvents[1]?.reason).toMatch(/Notify them manually/);
  });

  it('sends nothing when the unlock was refused', async () => {
    const { deps, notices } = createFakes({ plan: null });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(notices).toEqual([]);
  });

  it('sends nothing when the contact was already unlocked', async () => {
    // A second unlock of the same match is a no-op, and a second notice for
    // it would read to the candidate as a second employer.
    const { deps, notices } = createFakes({ match: baseMatch({ contactUnlocked: true }) });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.alreadyUnlocked).toBe(true);
    expect(notices).toEqual([]);
  });
});

describe('contactUnlockNoticeBody', () => {
  const body = contactUnlockNoticeBody({
    displayName: 'Amara',
    roleTitle: 'Platform Lead',
    settingsUrl: 'https://example.test/candidate/profile',
  });

  it('names the role and says what happens next', () => {
    expect(body).toContain('Amara');
    expect(body).toContain('"Platform Lead"');
    expect(body).toContain('may write to you directly');
  });

  it('says how to turn contact sharing off', () => {
    expect(body).toContain('https://example.test/candidate/profile');
    expect(body).toContain('turn it off at any');
  });

  it('does not name the employer', () => {
    // An employer that paid to reach a candidate has not agreed to have its
    // own hiring plans disclosed, and the candidate sees who it is in the
    // message that follows.
    expect(body).not.toMatch(/employer\s+[A-Z]/);
  });
});

describe('the marketplace gate, server-side', () => {
  /**
   * docs/COMMERCIAL_RUNBOOK.md: "No recurring marketplace promotion for a
   * saved role until >= 5 real, opted-in matching candidates exist and the
   * eligibility check passes server-side." The threshold lived only in
   * apps/web's role page, so the only thing between an employer and a
   * marketplace with three people in it was the browser.
   */
  it('refuses to unlock a contact on a role with no matches at all', async () => {
    // The floor dropped from five to one on 2026-09-02, so this is the only
    // case left that refuses: a role nobody matches has no contact to open.
    const { deps, auditEvents, notices } = createFakes({ matchCount: 0 });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toThrow(
      /no matching candidates yet/,
    );
    // Nothing was spent and nobody was emailed about a disclosure that did
    // not happen.
    expect(auditEvents).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('allows it at exactly the threshold', async () => {
    const { deps } = createFakes({ matchCount: MARKETPLACE_GATE_MIN_MATCHES });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.match.contactUnlocked).toBe(true);
  });

  it('blames the gate rather than the candidate when both would refuse', async () => {
    // Telling an employer that a candidate declined, when the real reason is
    // that their role has too few matches, is both wrong and unkind.
    const nonConsenting = { ...consentedCandidate, contactUnlockConsent: false };
    const { deps } = createFakes({ matchCount: 0, candidate: nonConsenting });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toThrow(
      /no matching candidates yet/,
    );
  });

  it('does not re-check the gate for an already-unlocked contact', async () => {
    // The disclosure already happened. Withdrawing access to a contact the
    // employer already paid for, because the match count later dropped,
    // would take back something already bought.
    const { deps } = createFakes({ matchCount: 1, match: baseMatch({ contactUnlocked: true }) });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.alreadyUnlocked).toBe(true);
  });
});

/**
 * The buyer's own state, which the plan alone never told anyone.
 *
 * `getEntitlementPlan` returns `entitlement.plan` and has never looked at
 * `entitlement.status`, so an organization whose subscription lapsed kept a
 * plan name and kept spending five contact unlocks a month against it.
 */
describe('unlockContact and marketplace access', () => {
  it('refuses once the grace window has closed, without spending the allowance', async () => {
    const { deps } = createFakes({ access: 'suspended' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('says the subscription needs a card, rather than blaming the candidate', async () => {
    const { deps } = createFakes({ access: 'suspended' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toThrow(
      /working card/,
    );
  });

  it('refuses an organization with no subscription at all', async () => {
    const { deps } = createFakes({ access: 'none' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toThrow(
      /no active subscription/i,
    );
  });

  /** A card that failed on Friday is not the same as a subscription that ended. */
  it('still allows an unlock inside the grace window', async () => {
    const { deps } = createFakes({ access: 'grace' });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).resolves.toMatchObject({
      alreadyUnlocked: false,
    });
  });

  it('checks access before revealing anything about the role or the candidate', async () => {
    // An organization that is not paying should not learn how many matches a
    // role has or whether a candidate consented: both are things the product
    // sells.
    const { deps } = createFakes({ access: 'none', matchCount: 0, candidate: null });
    await expect(unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps)).rejects.toThrow(
      /no active subscription/i,
    );
  });
});

/**
 * matching-service redacts aiExplanation from every match response while
 * aiMatching is off, on the reasoning that a stored value can outlive the
 * flag that produced it - so the API strips it rather than trusting it was
 * never written. This service returned a Match without that redaction, which
 * made the unlock the one match response the rule did not cover.
 */
describe('AI output on the unlock path', () => {
  const withExplanation = (match: Match): Match => ({
    ...match,
    aiExplanation: 'A model wrote this while the flag was on.',
  });

  it('strips a stored explanation while aiMatching is off', async () => {
    const { deps } = createFakes({
      candidate: consentedCandidate,
      match: withExplanation(baseMatch({ contactUnlocked: true })),
    });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.match.aiExplanation).toBeUndefined();
  });

  it('keeps it when the flag is on, because then it is a feature', async () => {
    const { deps } = createFakes({
      candidate: consentedCandidate,
      match: withExplanation(baseMatch({ contactUnlocked: true })),
      aiMatching: true,
    });
    const result = await unlockContact(EMPLOYER_ID, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.match.aiExplanation).toBe('A model wrote this while the flag was on.');
  });
});
