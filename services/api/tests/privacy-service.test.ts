import { describe, expect, it } from 'vitest';
import type {
  AuditEvent,
  Candidate,
  Evidence,
  EvidenceFile,
  GradedAttemptRecord,
  Match,
  Role,
} from '@zoryvex/contracts';
import {
  exportCandidateData,
  updateConsent,
  type PrivacyDependencies,
} from '../src/domain/privacy-service';
import { NotFoundError } from '../src/errors/typed-errors';

const CANDIDATE_ID = 'cand_1';

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'cand@example.com',
    displayName: 'A',
    launchTrack: 'aws_cloud',
    discoveryOptIn: false,
    contactUnlockConsent: false,
    onboardingComplete: true,
    summary: '',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(
  initial: Candidate,
  initialMatches: Match[] = [],
  roles: Map<string, Role> = new Map(),
  attemptsByEvidence: Map<string, GradedAttemptRecord[]> = new Map(),
) {
  let candidate = initial;
  let version = 1;
  const auditEvents: AuditEvent[] = [];
  const discoveryToggleCalls: boolean[] = [];
  let matches = [...initialMatches];
  const deletedMatches: Array<{ roleId: string; candidateId: string }> = [];

  const deps: PrivacyDependencies = {
    clock: { now: () => new Date('2026-08-19T02:00:00.000Z') },
    async getCandidate() {
      return { candidate, version };
    },
    async setDiscoveryOptIn(_candidateId, _launchTrack, optIn) {
      discoveryToggleCalls.push(optIn);
      candidate = { ...candidate, discoveryOptIn: optIn };
    },
    async updateCandidateProfile(_candidateId, expectedVersion, patch) {
      if (expectedVersion !== version) throw new Error('version mismatch in fake');
      candidate = { ...candidate, ...patch };
      version += 1;
      return { candidate, version };
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
    async listCandidateEvidence() {
      return [] as Evidence[];
    },
    async listFilesForCandidate() {
      return [] as EvidenceFile[];
    },
    async listMatchesForCandidate() {
      return matches;
    },
    async getRole(roleId) {
      const role = roles.get(roleId);
      return role ? { role } : null;
    },
    async listGradedAttempts(_candidateId, evidenceId) {
      return attemptsByEvidence.get(evidenceId) ?? [];
    },
    async deleteMatch(roleId, candidateId) {
      deletedMatches.push({ roleId, candidateId });
      matches = matches.filter((m) => m.roleId !== roleId);
    },
    async enablePublicProof() {},
    async disablePublicProof() {},
    generateId: () => 'audit_1',
  };

  return {
    deps,
    auditEvents,
    discoveryToggleCalls,
    deletedMatches,
    remainingMatches: () => matches,
    getCandidate: () => candidate,
  };
}

describe('updateConsent', () => {
  it('toggling discoveryOptIn calls the structural toggle and records one audit event', async () => {
    const { deps, auditEvents, discoveryToggleCalls } = createFakes(baseCandidate());
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: true }, deps);
    expect(discoveryToggleCalls).toEqual([true]);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.action).toBe('discovery_opt_in');
  });

  it('opting back out records a distinct, reversible audit event', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate({ discoveryOptIn: true }));
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: false }, deps);
    expect(auditEvents[0]?.action).toBe('discovery_opt_out');
  });

  it('is a no-op (no audit event) when the requested value already matches the current state', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate({ discoveryOptIn: true }));
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: true }, deps);
    expect(auditEvents).toHaveLength(0);
  });

  it('contactUnlockConsent changes go through optimistic-concurrency updateCandidateProfile and are audited', async () => {
    const { deps, auditEvents, getCandidate } = createFakes(baseCandidate());
    await updateConsent(CANDIDATE_ID, { contactUnlockConsent: true }, deps);
    expect(getCandidate().contactUnlockConsent).toBe(true);
    expect(auditEvents[0]?.action).toBe('contact_unlock_consent_given');
  });

  it('revoking contactUnlockConsent is audited distinctly from granting it', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate({ contactUnlockConsent: true }));
    await updateConsent(CANDIDATE_ID, { contactUnlockConsent: false }, deps);
    expect(auditEvents[0]?.action).toBe('contact_unlock_consent_revoked');
  });

  it('both consent types can change in the same call, each audited separately', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate());
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: true, contactUnlockConsent: true }, deps);
    expect(auditEvents).toHaveLength(2);
  });

  it('throws NotFoundError for a nonexistent candidate', async () => {
    const { deps } = createFakes(baseCandidate());
    deps.getCandidate = async () => null;
    await expect(
      updateConsent(CANDIDATE_ID, { discoveryOptIn: true }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('exportCandidateData', () => {
  it('includes evidence and file metadata, never a raw storage key/URL', async () => {
    const { deps } = createFakes(baseCandidate());
    deps.listFilesForCandidate = async () => [
      {
        id: 'file_1',
        candidateId: CANDIDATE_ID,
        originalFilename: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        quarantineKey: 'quarantine/cand_1/file_1',
        acceptedKey: 'accepted/cand_1/file_1',
        scanStatus: 'clean',
        createdAt: '2026-08-19T00:00:00.000Z',
        scannedAt: '2026-08-19T00:01:00.000Z',
      },
    ];
    const result = await exportCandidateData(CANDIDATE_ID, deps);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).not.toHaveProperty('quarantineKey');
    expect(result.files[0]).not.toHaveProperty('acceptedKey');
    expect(JSON.stringify(result)).not.toContain('quarantine/');
    expect(JSON.stringify(result)).not.toContain('accepted/');
  });

  it('throws NotFoundError for a nonexistent candidate', async () => {
    const { deps } = createFakes(baseCandidate());
    deps.getCandidate = async () => null;
    await expect(exportCandidateData(CANDIDATE_ID, deps)).rejects.toBeInstanceOf(NotFoundError);
  });

  /**
   * Found on 2026-09-04. The account page offers to "download everything
   * Zoryvex holds about you", and the export returned candidate, evidence
   * and files only - omitting which employers had paid to receive this
   * person's contact details, which is the most privacy-sensitive record
   * the platform keeps about them. In real mode the account page could not
   * show it either, so a real candidate had no way to find out at all.
   */
  describe('contact-unlock history', () => {
    function exportMatch(roleId: string, contactUnlocked: boolean): Match {
      return {
        id: `match_${roleId}`,
        roleId,
        candidateId: CANDIDATE_ID,
        matchScore: 0.8,
        status: 'suggested',
        contactUnlocked,
        createdAt: '2026-08-19T00:00:00.000Z',
      };
    }
    function exportRole(id: string, title: string): Role {
      return {
        id,
        employerId: 'emp_1',
        launchTrack: 'aws_cloud',
        title,
        seniority: 'mid',
        outcomes: 'Ship a landing zone',
        mustHaveWork: ['Terraform'],
        constraints: '',
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
      };
    }

    it('reports every role whose employer unlocked the contact', async () => {
      const { deps } = createFakes(
        baseCandidate(),
        [exportMatch('role_1', true), exportMatch('role_2', true)],
        new Map([
          ['role_1', exportRole('role_1', 'Cloud Platform Engineer')],
          ['role_2', exportRole('role_2', 'DevOps Engineer')],
        ]),
      );
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.contactUnlocks).toEqual([
        { roleId: 'role_1', roleTitle: 'Cloud Platform Engineer' },
        { roleId: 'role_2', roleTitle: 'DevOps Engineer' },
      ]);
    });

    it('omits matches whose contact was never unlocked', async () => {
      // A match is not a disclosure. Only an unlock means somebody received
      // the contact details, and reporting the rest would tell a candidate
      // their details went somewhere they did not.
      const { deps } = createFakes(
        baseCandidate(),
        [exportMatch('role_1', false), exportMatch('role_2', true)],
        new Map([
          ['role_1', exportRole('role_1', 'Not Unlocked')],
          ['role_2', exportRole('role_2', 'Unlocked')],
        ]),
      );
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.contactUnlocks).toEqual([{ roleId: 'role_2', roleTitle: 'Unlocked' }]);
    });

    it('is an empty list, not a missing field, when nobody has unlocked', async () => {
      const { deps } = createFakes(baseCandidate());
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.contactUnlocks).toEqual([]);
    });

    it('still reports an unlock whose role has since been deleted', async () => {
      // The disclosure happened. Dropping the row because the role is gone
      // would understate who received the candidate's details.
      const { deps } = createFakes(baseCandidate(), [exportMatch('role_gone', true)], new Map());
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.contactUnlocks).toEqual([
        { roleId: 'role_gone', roleTitle: '(role no longer exists)' },
      ]);
    });

    it('never names the employer, matching what the notification email says', async () => {
      // An employer that paid to reach a candidate has not agreed to have
      // its hiring plans disclosed. The export tells the candidate exactly
      // what the unlock email already told them, and nothing further.
      const { deps } = createFakes(
        baseCandidate(),
        [exportMatch('role_1', true)],
        new Map([['role_1', exportRole('role_1', 'Cloud Platform Engineer')]]),
      );
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(JSON.stringify(result.contactUnlocks)).not.toContain('emp_1');
    });
  });

  /**
   * The same asymmetry as the unlock history, found the same day. Employers
   * have been shown every graded-task attempt behind a candidate's evidence
   * - the attempt number, whether it passed, which checks were outstanding,
   * whether any tripped a disqualifying check. The candidate could see none
   * of it, in the app or in an export offering "everything Zoryvex holds
   * about you". A person should be able to read what is said about them to
   * the people deciding whether to hire them.
   */
  describe('graded-task attempt history', () => {
    function attempt(passed: boolean, failedCheckIds: string[] = []): GradedAttemptRecord {
      return {
        evidenceId: 'ev_1',
        taskId: 'task_1',
        passed,
        failedCheckIds,
        disqualified: false,
        at: '2026-08-19T00:00:00.000Z',
      };
    }
    const evidenceItem = (id: string) =>
      ({
        id,
        candidateId: CANDIDATE_ID,
        claim: 'Built a landing zone',
        context: 'At work',
        actions: 'Wrote the modules',
        outcome: 'Ran for a year',
        source: 'project',
        verificationState: 'verified',
        verificationMethod: 'graded_task',
        visibility: 'discovery',
        consentGiven: true,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }) as Evidence;

    it('reports the attempts an employer would see, numbered in order', async () => {
      const { deps } = createFakes(
        baseCandidate(),
        [],
        new Map(),
        new Map([['ev_1', [attempt(false, ['least_privilege']), attempt(true)]]]),
      );
      deps.listCandidateEvidence = async () => [evidenceItem('ev_1')];
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.gradedAttempts).toHaveLength(1);
      expect(result.gradedAttempts[0]!.evidenceId).toBe('ev_1');
      expect(result.gradedAttempts[0]!.history.attempts.map((a) => a.attemptNumber)).toEqual([
        1, 2,
      ]);
      expect(result.gradedAttempts[0]!.history.passedFirstTime).toBe(false);
    });

    /**
     * The reason this export does not reuse the employer view's filter.
     * Attempts are recorded at every graded exit, including failures, but
     * `verificationMethod` is set only when verification succeeds - so a
     * candidate who attempted a task and never passed has records held
     * about them and no method at all. Filtering on the method would drop
     * exactly the history they have most reason to want to see, which is
     * the same omission this export was written to fix.
     */
    it('reports attempts on evidence that never passed, which have no verificationMethod', async () => {
      const { deps } = createFakes(
        baseCandidate(),
        [],
        new Map(),
        new Map([['ev_1', [attempt(false, ['least_privilege']), attempt(false, ['network'])]]]),
      );
      deps.listCandidateEvidence = async () => [
        { ...evidenceItem('ev_1'), verificationState: 'unverified' } as Evidence,
      ];
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.gradedAttempts).toHaveLength(1);
      expect(result.gradedAttempts[0]!.history.attempts).toHaveLength(2);
      expect(result.gradedAttempts[0]!.history.passedFirstTime).toBe(false);
    });

    it('leaves out evidence that was never graded, rather than exporting empty rows', async () => {
      const { deps } = createFakes(baseCandidate(), [], new Map(), new Map());
      deps.listCandidateEvidence = async () => [evidenceItem('ev_1')];
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.gradedAttempts).toEqual([]);
    });

    /**
     * This asserted the opposite until 2026-09-04, and the earlier version
     * was wrong in a way worth keeping the record of.
     *
     * match-evidence-service asks for attempts only where
     * `verificationMethod` is 'graded_task', which is correct for it: it
     * runs on every match render and a badge has no attempts. Copying that
     * rule here looked like the same optimisation and was not, because the
     * method is set only when verification SUCCEEDS while attempts are
     * recorded at every graded exit including failures. The filter dropped
     * precisely the attempts of somebody who never passed.
     *
     * The export asks for every item instead. It is a rare, user-initiated
     * document, evidence is capped, and completeness is the whole point of
     * it - a different trade from the one the employer view faces.
     */
    it('asks every evidence item, because a failed attempt sets no method', async () => {
      const asked: string[] = [];
      const { deps } = createFakes(baseCandidate(), [], new Map(), new Map());
      deps.listCandidateEvidence = async () => [
        { ...evidenceItem('ev_badge'), verificationMethod: 'issuer_badge' } as Evidence,
        { ...evidenceItem('ev_never_passed'), verificationState: 'unverified' } as Evidence,
      ];
      deps.listGradedAttempts = async (_candidateId, evidenceId) => {
        asked.push(evidenceId);
        return [];
      };
      await exportCandidateData(CANDIDATE_ID, deps);
      expect(asked).toEqual(['ev_badge', 'ev_never_passed']);
    });

    it('reports a disqualifying attempt even when a later one passed', async () => {
      // The employer view surfaces this deliberately, so the candidate has
      // to be able to see it too - otherwise the export hides the single
      // fact most likely to count against them.
      const { deps } = createFakes(
        baseCandidate(),
        [],
        new Map(),
        new Map([['ev_1', [{ ...attempt(false), disqualified: true }, attempt(true)]]]),
      );
      deps.listCandidateEvidence = async () => [evidenceItem('ev_1')];
      const result = await exportCandidateData(CANDIDATE_ID, deps);
      expect(result.gradedAttempts[0]!.history.everDisqualified).toBe(true);
    });
  });
});

/**
 * Guards a real privacy bug found in a 2026-08-27 audit.
 *
 * matching-service.ts skips opted-out candidates on recompute but leaves
 * existing Match rows in place, and getMatchesForRole returns every row
 * stored against the role. Revoking discovery consent therefore had no
 * visible effect at all — the candidate stayed in employers' match lists
 * indefinitely, which is the one thing opting out is supposed to prevent.
 */
describe('discovery opt-out withdraws the candidate from open matches', () => {
  function match(roleId: string, contactUnlocked = false): Match {
    return {
      id: `m_${roleId}`,
      roleId,
      candidateId: CANDIDATE_ID,
      matchScore: 0.8,
      status: 'suggested',
      contactUnlocked,
      createdAt: '2026-08-19T00:00:00.000Z',
    };
  }

  it('deletes open matches when discovery is switched off', async () => {
    const { deps, deletedMatches } = createFakes(baseCandidate({ discoveryOptIn: true }), [
      match('role_1'),
      match('role_2'),
    ]);
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: false }, deps);
    expect(deletedMatches.map((d) => d.roleId).sort()).toEqual(['role_1', 'role_2']);
  });

  it('keeps a match whose contact the employer already paid to unlock', async () => {
    // That disclosure happened under its own separate consent and spent part
    // of a paid allowance. Deleting it would destroy the record of something
    // the employer paid for, and would not un-disclose anything.
    const { deps, deletedMatches, remainingMatches } = createFakes(
      baseCandidate({ discoveryOptIn: true }),
      [match('role_1'), match('role_paid', true)],
    );
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: false }, deps);
    expect(deletedMatches.map((d) => d.roleId)).toEqual(['role_1']);
    expect(remainingMatches().map((m) => m.roleId)).toEqual(['role_paid']);
  });

  it('records an audit event naming how many matches were withdrawn', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate({ discoveryOptIn: true }), [
      match('role_1'),
    ]);
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: false }, deps);
    const withdrawal = auditEvents.find((e) => e.action === 'discovery_matches_withdrawn');
    expect(withdrawal).toBeDefined();
    expect(withdrawal!.reason).toContain('1 match');
  });

  it('does not touch matches when discovery is switched ON', async () => {
    const { deps, deletedMatches } = createFakes(baseCandidate({ discoveryOptIn: false }), [
      match('role_1'),
    ]);
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: true }, deps);
    expect(deletedMatches).toEqual([]);
  });

  it('writes no withdrawal audit event when there was nothing to withdraw', async () => {
    const { deps, auditEvents } = createFakes(baseCandidate({ discoveryOptIn: true }), []);
    await updateConsent(CANDIDATE_ID, { discoveryOptIn: false }, deps);
    expect(auditEvents.some((e) => e.action === 'discovery_matches_withdrawn')).toBe(false);
  });
});
