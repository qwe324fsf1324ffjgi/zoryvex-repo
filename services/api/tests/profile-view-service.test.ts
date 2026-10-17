import { describe, expect, it } from 'vitest';
import type { AuditEvent, Candidate, Employer } from '@zoryvex/contracts';
import {
  notifyCandidateOfProfileView,
  profileViewNoticeBody,
  type ProfileViewDependencies,
} from '../src/domain/profile-view-service';

/**
 * Telling a candidate an employer looked at them, and the three ways that
 * could go wrong in a way nobody would notice: mailing them for a page they
 * were never really on, mailing them every time somebody scrolled, and
 * mailing them after they had asked not to be found.
 */

const EMPLOYER_ID = 'emp_1';
const CANDIDATE_ID = 'cand_1';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'cand@example.com',
    displayName: 'Amara',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const employer: Employer = {
  id: EMPLOYER_ID,
  organizationName: 'Acme Cloud',
  contactEmail: 'hiring@acme.test',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakes(
  input: { candidate?: Candidate | null; allowed?: boolean; sendThrows?: boolean } = {},
) {
  const sent: Array<{ email: string; organizationName: string; roleTitle: string }> = [];
  const audit: AuditEvent[] = [];
  const rateLimitCalls: Array<{ kind: string; key: string; limit: number }> = [];

  const deps: ProfileViewDependencies = {
    clock: { now: () => new Date('2026-09-06T10:00:00.000Z') },
    async getCandidate() {
      const found = input.candidate === undefined ? candidate() : input.candidate;
      return found ? { candidate: found, version: 1 } : null;
    },
    async getEmployer() {
      return employer;
    },
    async checkRateLimit(args) {
      rateLimitCalls.push({ kind: args.kind, key: args.key, limit: args.limit });
      return { allowed: input.allowed ?? true };
    },
    async notifyCandidateOfView(notice) {
      if (input.sendThrows) throw new Error('SES said no');
      sent.push({
        email: notice.email,
        organizationName: notice.organizationName,
        roleTitle: notice.roleTitle,
      });
    },
    async appendAuditEvent(event) {
      audit.push(event);
      return event;
    },
    generateId: () => 'audit_1',
  };
  return { deps, sent, audit, rateLimitCalls };
}

const view = {
  employerId: EMPLOYER_ID,
  roleId: 'role_1',
  roleTitle: 'Platform Engineer',
  candidateId: CANDIDATE_ID,
};

describe('telling a candidate their proof was opened', () => {
  it('mails them, naming the organisation and the role', async () => {
    const { deps, sent } = fakes();
    const result = await notifyCandidateOfProfileView(view, deps);
    expect(result).toEqual({ notified: true });
    expect(sent).toEqual([
      { email: 'cand@example.com', organizationName: 'Acme Cloud', roleTitle: 'Platform Engineer' },
    ]);
  });

  it('records it as an audit event once the mail has actually gone', async () => {
    const { deps, audit } = fakes();
    await notifyCandidateOfProfileView(view, deps);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: EMPLOYER_ID,
      actorRole: 'employer',
      action: 'candidate_profile_viewed',
      targetId: CANDIDATE_ID,
    });
  });

  it('writes no audit entry when the mail failed, so the log cannot claim they were told', async () => {
    const { deps, audit } = fakes({ sendThrows: true });
    await expect(notifyCandidateOfProfileView(view, deps)).rejects.toThrow();
    expect(audit).toEqual([]);
  });

  it('says nothing a second time the same day, per employer and candidate', async () => {
    const { deps, sent, rateLimitCalls } = fakes({ allowed: false });
    const result = await notifyCandidateOfProfileView(view, deps);
    expect(result).toEqual({ notified: false, reason: 'already_notified_today' });
    expect(sent).toEqual([]);
    // Keyed on the pair, so a different employer looking is still reported
    // and a different candidate is unaffected by this one's window.
    expect(rateLimitCalls[0]).toEqual({
      kind: 'profile-view-notice',
      key: `${EMPLOYER_ID}#${CANDIDATE_ID}`,
      limit: 1,
    });
  });

  it('checks the window before reading anything, so a repeat look is cheap', async () => {
    // The rate-limit call is the first thing that happens. If a repeat view
    // still loaded the candidate and the employer, an employer comparing two
    // people would pay for those reads on every click.
    let candidateReads = 0;
    const { deps } = fakes({ allowed: false });
    const wrapped: ProfileViewDependencies = {
      ...deps,
      async getCandidate(id) {
        candidateReads += 1;
        return deps.getCandidate(id);
      },
    };
    await notifyCandidateOfProfileView(view, wrapped);
    expect(candidateReads).toBe(0);
  });

  it('stays quiet for a candidate who has left discovery', async () => {
    // The state at the moment of the disclosure governs it, the same way
    // withdrawn contact consent stops contact being served.
    const { deps, sent } = fakes({ candidate: candidate({ discoveryOptIn: false }) });
    const result = await notifyCandidateOfProfileView(view, deps);
    expect(result).toEqual({ notified: false, reason: 'not_discoverable' });
    expect(sent).toEqual([]);
  });

  it('stays quiet rather than throwing when the candidate is gone', async () => {
    const { deps, sent } = fakes({ candidate: null });
    const result = await notifyCandidateOfProfileView(view, deps);
    expect(result).toEqual({ notified: false, reason: 'unknown_party' });
    expect(sent).toEqual([]);
  });
});

describe('what the notice says', () => {
  const body = profileViewNoticeBody({
    displayName: 'Amara',
    organizationName: 'Acme Cloud',
    roleTitle: 'Platform Engineer',
    profileUrl: 'https://example.test/candidate/profile',
  });

  it('answers what they saw before the reader has to wonder', () => {
    expect(body).toMatch(/did not see your email address/i);
    expect(body).toMatch(/phone number/i);
    expect(body).toMatch(/marked private/i);
  });

  it('does not imply the candidate has something to do', () => {
    expect(body).toMatch(/nothing you need to do/i);
  });

  it('says how to stop receiving it, and is honest that it stops discovery too', () => {
    expect(body).toContain('https://example.test/candidate/profile');
    expect(body).toMatch(/turning that\s*\n?\s*off stops both the discovery and these messages/i);
  });

  it('never states a view count, which is not the fact that matters', () => {
    expect(body).not.toMatch(/\b\d+ times?\b/i);
    expect(body).not.toMatch(/viewed your profile \d+/i);
  });
});
