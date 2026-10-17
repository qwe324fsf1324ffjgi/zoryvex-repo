import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import type { AuditEvent, Candidate, Evidence } from '@zoryvex/contracts';
import {
  reminderBody,
  sendVerificationReminders,
  type VerificationReminderDependencies,
} from '../src/domain/verification-reminder-service';

const NOW = new Date('2026-08-27T00:00:00.000Z');
const LONG_AGO = '2026-08-01T00:00:00.000Z';
const YESTERDAY = '2026-08-26T00:00:00.000Z';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand_1',
    email: 'cand@example.com',
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...overrides,
  };
}

function evidenceItem(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: 'cand_1',
    source: 'project',
    claim: 'Built something',
    context: 'Context',
    actions: 'Actions',
    outcome: 'Outcome',
    verificationState: 'unverified',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...overrides,
  };
}

function createFakes(
  input: {
    flagOn?: boolean;
    evidence?: Evidence[];
    slotTaken?: boolean;
    sendThrows?: boolean;
  } = {},
) {
  const sends: Array<{ email: string; unverifiedCount: number }> = [];
  const auditEvents: AuditEvent[] = [];
  const claims: string[] = [];

  const deps: VerificationReminderDependencies = {
    clock: { now: () => NOW },
    async getFeatureFlags() {
      return { ...DEFAULT_FEATURE_FLAGS, verificationReminders: input.flagOn ?? true };
    },
    async listCandidateEvidence() {
      return input.evidence ?? [evidenceItem()];
    },
    async claimReminderSlot(candidateId) {
      claims.push(candidateId);
      return !input.slotTaken;
    },
    async sendVerificationReminder(payload) {
      if (input.sendThrows) throw new Error('SES rejected the address');
      sends.push({ email: payload.email, unverifiedCount: payload.unverifiedCount });
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
  };

  return { deps, sends, auditEvents, claims };
}

describe('sendVerificationReminders', () => {
  it('nudges a candidate whose evidence has sat unverified', async () => {
    const fakes = createFakes();
    const run = await sendVerificationReminders([candidate()], fakes.deps);

    expect(run.sent).toBe(1);
    expect(fakes.sends).toEqual([{ email: 'cand@example.com', unverifiedCount: 1 }]);
  });

  it('does nothing at all while the flag is off, including the reads', async () => {
    // This is the only thing in the system that emails someone who did not
    // ask. It must never start because a deploy shipped.
    const fakes = createFakes({ flagOn: false });
    const run = await sendVerificationReminders([candidate()], fakes.deps);

    expect(run.sent).toBe(0);
    expect(run.outcomes['cand_1']).toBe('flag_off');
    expect(fakes.claims).toEqual([]);
    expect(fakes.sends).toEqual([]);
  });

  it('sends exactly one reminder ever, never a sequence', async () => {
    const fakes = createFakes({ slotTaken: true });
    const run = await sendVerificationReminders([candidate()], fakes.deps);

    expect(run.outcomes['cand_1']).toBe('already_reminded');
    expect(fakes.sends).toEqual([]);
  });

  it('claims the slot before sending, so a crash cannot double-send', async () => {
    // Deliberately the opposite of the Paystack webhook's ordering. There,
    // losing the effect is worse than repeating it because somebody paid.
    // Here a duplicate unsolicited email is spam and a missed nudge costs
    // nothing, so a failure between claim and send loses the reminder.
    const fakes = createFakes({ sendThrows: true });
    const run = await sendVerificationReminders([candidate()], fakes.deps);

    expect(run.outcomes['cand_1']).toBe('send_failed');
    expect(fakes.claims).toEqual(['cand_1']);
    expect(fakes.auditEvents).toEqual([]);
  });

  it('leaves alone anyone who already has something verified', async () => {
    // They are already visible to employers. Telling them to go verify would
    // be wrong as well as irritating.
    const fakes = createFakes({
      evidence: [evidenceItem({ verificationState: 'verified' }), evidenceItem({ id: 'ev_2' })],
    });
    const run = await sendVerificationReminders([candidate()], fakes.deps);

    expect(run.outcomes['cand_1']).toBe('already_verified');
    expect(fakes.claims).toEqual([]);
  });

  it('leaves alone anyone with nothing written up yet', async () => {
    const fakes = createFakes({ evidence: [] });
    const run = await sendVerificationReminders([candidate()], fakes.deps);
    expect(run.outcomes['cand_1']).toBe('nothing_to_verify');
  });

  it('leaves alone anyone still actively editing', async () => {
    const fakes = createFakes({ evidence: [evidenceItem({ updatedAt: YESTERDAY })] });
    const run = await sendVerificationReminders([candidate()], fakes.deps);
    expect(run.outcomes['cand_1']).toBe('too_soon');
    expect(fakes.claims).toEqual([]);
  });

  it('measures the quiet period from the most recent edit, not the oldest', async () => {
    const fakes = createFakes({
      evidence: [evidenceItem(), evidenceItem({ id: 'ev_2', updatedAt: YESTERDAY })],
    });
    const run = await sendVerificationReminders([candidate()], fakes.deps);
    expect(run.outcomes['cand_1']).toBe('too_soon');
  });

  it('records a deterministic audit event, so a retry cannot duplicate it', async () => {
    const fakes = createFakes();
    await sendVerificationReminders([candidate()], fakes.deps);
    expect(fakes.auditEvents[0]!.id).toBe('audit_verification_reminder_cand_1');
  });

  it('one failing address does not stop the rest of the batch', async () => {
    let calls = 0;
    const fakes = createFakes();
    fakes.deps.sendVerificationReminder = async () => {
      calls += 1;
      if (calls === 1) throw new Error('bad address');
    };
    const run = await sendVerificationReminders(
      [candidate(), candidate({ id: 'cand_2', email: 'two@example.com' })],
      fakes.deps,
    );

    expect(run.outcomes['cand_1']).toBe('send_failed');
    expect(run.outcomes['cand_2']).toBe('sent');
    expect(run.sent).toBe(1);
  });
});

describe('reminderBody', () => {
  const body = reminderBody({
    displayName: 'Ada',
    unverifiedCount: 2,
    verifyUrl: 'https://zoryvex.example/candidate/profile',
    unsubscribeUrl: 'https://zoryvex.example/candidate/account',
  });

  it('states the one fact the candidate cannot see from outside', () => {
    expect(body).toContain('employers cannot see yet');
    expect(body).toContain('does not appear in any of their searches');
  });

  it('promises it is the only one, and keeps that promise elsewhere in the code', () => {
    expect(body).toContain('only reminder we will send');
  });

  it('offers a real way out', () => {
    expect(body).toContain('https://zoryvex.example/candidate/account');
  });

  it('gets the plural right for a single item', () => {
    const one = reminderBody({
      displayName: 'Ada',
      unverifiedCount: 1,
      verifyUrl: 'x',
      unsubscribeUrl: 'y',
    });
    expect(one).toContain('1 piece of evidence');
    expect(body).toContain('2 pieces of evidence');
  });

  it('carries no marketing language and no urgency', () => {
    // A nudge that oversells is a dark pattern, and this one is aimed at
    // people who have not yet decided the product is worth their time.
    for (const word of ['act now', 'limited', 'don’t miss', 'unlock your potential', '!']) {
      expect(body.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});
