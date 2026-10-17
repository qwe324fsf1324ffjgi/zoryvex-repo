import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_STRENGTH_DEFINITIONS,
  EVIDENCE_STRENGTH_LEVELS,
  EvidenceStrengthSchema,
  type Evidence,
} from '@zoryvex/contracts';
import { evidenceStrength, strongestLevel } from '../src/domain/evidence-strength-service';

const NOW = new Date('2026-09-02T12:00:00.000Z');

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: 'cand_1',
    source: 'certification',
    claim: 'Did a thing',
    context: 'Somewhere',
    actions: 'I did it',
    outcome: 'It worked',
    verificationState: 'unverified',
    visibility: 'discovery',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Evidence;
}

const verified = (overrides: Partial<Evidence> = {}) =>
  evidence({
    verificationState: 'verified',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    verificationDetail: 'What was checked, in words.',
    ...overrides,
  });

describe('what an unchecked claim establishes', () => {
  it('is claimed and nothing else', () => {
    const strength = evidenceStrength(evidence(), NOW);
    expect(strength.attained).toEqual(['claimed']);
    expect(strongestLevel(strength)).toBe('claimed');
  });

  it('says the same for a self-attested claim, because a self-report is a claim', () => {
    const strength = evidenceStrength(evidence({ verificationState: 'self_attested' }), NOW);
    expect(strength.attained).toEqual(['claimed']);
  });

  it('names the level rather than returning nothing', () => {
    // An empty list would render as a gap. "Claimed" is what makes an
    // unverified claim legible as an unverified claim.
    expect(evidenceStrength(evidence(), NOW).basis.claimed).toContain('themselves');
  });
});

describe('what each verification method establishes, and what it does not', () => {
  /**
   * The conservatism is the point. A certification means somebody else tested
   * their knowledge and we confirmed the credential exists and is theirs. It
   * does not mean their work was corroborated, and calling it that would be a
   * lie that flattered everybody involved.
   */
  it('a confirmed credential assesses knowledge, and corroborates no work', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'issuer_badge' }), NOW);
    expect(strength.attained).toContain('knowledge_assessed');
    expect(strength.attained).not.toContain('work_corroborated');
    expect(strength.attained).not.toContain('skill_demonstrated');
    expect(strength.basis.knowledge_assessed).toContain('issued it');
  });

  /**
   * Retired on 2026-09-06, and these tests are rewritten rather than deleted
   * so the reversal is legible.
   *
   * A graded task used to attain skill_demonstrated and outcome_verified,
   * which put it above a certification confirmed with its issuer. That was
   * defensible while the rubric meant something. It stopped being defensible
   * once it was clear the answer could be produced from the published brief
   * by a language model: the mark then said a passing file was submitted,
   * not that the person could do the work.
   */
  it('a passed work sample no longer demonstrates skill or verifies an outcome', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(strength.attained).not.toContain('skill_demonstrated');
    expect(strength.attained).not.toContain('outcome_verified');
  });

  it('says what happened, rather than quietly dropping a level', () => {
    // A candidate reading their own profile should be told why a level went
    // away, not watch it disappear.
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(strength.basis.claimed).toMatch(/stopped treating those as proof/i);
    expect(strength.basis.claimed).toMatch(/without doing the work/i);
  });

  it('no longer outranks a certification confirmed with its issuer', () => {
    // The inversion that made this wrong: an AI-solvable take-home sat above
    // a credential cryptographically bound to the candidate's own address.
    const rank = (level: string) => EVIDENCE_STRENGTH_LEVELS.indexOf(level as never);
    const task = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    const certification = evidenceStrength(verified({ verificationMethod: 'issuer_badge' }), NOW);
    expect(rank(strongestLevel(task))).toBeLessThan(rank(strongestLevel(certification)));
  });

  /**
   * The distinction the whole product rests on, asserted directly: a machine
   * read the resulting state. Not a person's opinion, not a model's.
   */
  it('claims no machine-verified outcome for a graded task any more', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(strength.basis.outcome_verified).toBeUndefined();
  });

  it('a work sample does not claim the process was observed', () => {
    // The grader sees a submission, never the road to it. Claiming otherwise
    // would be the single easiest overclaim to make here.
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(strength.attained).not.toContain('process_observed');
  });

  it('repository attribution corroborates work, and assesses no knowledge', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'repo_ownership' }), NOW);
    expect(strength.attained).toContain('work_corroborated');
    expect(strength.attained).not.toContain('knowledge_assessed');
    expect(strength.basis.work_corroborated).toContain('does not control');
  });
});

describe('continuous verification is only claimed where a lapse is enforced', () => {
  it('is reached when the credential expires', () => {
    const strength = evidenceStrength(
      verified({
        verificationMethod: 'issuer_badge',
        verificationExpiresAt: '2027-01-01T00:00:00.000Z',
      }),
      NOW,
    );
    expect(strength.attained).toContain('continuously_verified');
    expect(strength.basis.continuously_verified).toContain('2027-01-01');
  });

  /**
   * A credential with no expiry is verified once and then trusted, which is a
   * weaker thing than a check that expires. Calling both "continuous" would
   * make the word mean nothing.
   */
  it('is not reached by a perpetual credential', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'issuer_badge' }), NOW);
    expect(strength.attained).not.toContain('continuously_verified');
  });

  it('collapses to claimed the day the credential lapses', () => {
    const lapsed = verified({
      verificationMethod: 'graded_task',
      verificationExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    const strength = evidenceStrength(lapsed, NOW);
    expect(strength.attained).toEqual(['claimed']);
    // Not "was strong once". A lapsed proof advertises nothing.
    expect(strongestLevel(strength)).toBe('claimed');
  });
});

describe('what the platform cannot establish is stated, not omitted', () => {
  /**
   * The honesty requirement. An employer who cannot tell "this candidate did
   * not do that" from "Zoryvex does not do that yet" is being misled by
   * omission, which is the same failure as overclaiming and harder to spot.
   */
  it('reports the unsupported levels on every response, however strong', () => {
    for (const item of [
      evidence(),
      verified({ verificationMethod: 'graded_task' }),
      verified({ verificationMethod: 'repo_ownership' }),
    ]) {
      const strength = evidenceStrength(item, NOW);
      expect(strength.unsupported).toEqual(['process_observed']);
    }
  });

  it('explains each unsupported level as a limit of the platform, not of the person', () => {
    for (const level of ['process_observed'] as const) {
      const definition = EVIDENCE_STRENGTH_DEFINITIONS[level];
      expect(definition.supported).toBe(false);
      expect(definition.whyNot, level).toBeTruthy();
      // Says so in as many words, because the inference is the whole risk.
      expect(definition.whyNot).toContain('Nothing about this candidate is implied');
    }
  });

  it('never reports a level as attained that it also reports as unsupported', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    for (const level of strength.unsupported) {
      expect(strength.attained).not.toContain(level);
    }
  });
});

describe('shape and ordering', () => {
  it('matches the published contract', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(EvidenceStrengthSchema.safeParse(strength).success).toBe(true);
  });

  it('orders by the hierarchy, not by the order facts were found', () => {
    const strength = evidenceStrength(
      verified({
        verificationMethod: 'graded_task',
        verificationExpiresAt: '2027-01-01T00:00:00.000Z',
      }),
      NOW,
    );
    const indexes = strength.attained.map((l) => EVIDENCE_STRENGTH_LEVELS.indexOf(l));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('gives every attained level a basis an employer can read', () => {
    const strength = evidenceStrength(
      verified({
        verificationMethod: 'graded_task',
        verificationExpiresAt: '2027-01-01T00:00:00.000Z',
      }),
      NOW,
    );
    for (const level of strength.attained) {
      expect(strength.basis[level], `${level} has no basis`).toBeTruthy();
      expect(strength.basis[level]!.length, `${level}'s basis is a gesture`).toBeGreaterThan(30);
    }
  });

  /**
   * Deliberately not a number. "87% verified" invites a comparison whose
   * construction the reader cannot see, which is the opaque scoring this
   * product argues against.
   */
  it('reports a level rather than a score', () => {
    const strength = evidenceStrength(verified({ verificationMethod: 'graded_task' }), NOW);
    expect(strength).not.toHaveProperty('score');
    expect(strength).not.toHaveProperty('percentage');
    expect(typeof strongestLevel(strength)).toBe('string');
  });
});

describe('peer attestation, and where it sits', () => {
  it('reaches peer verified only when somebody actually confirmed it', () => {
    const item = verified({ verificationMethod: 'issuer_badge' });
    expect(evidenceStrength(item, NOW).attained).not.toContain('peer_verified');
    expect(evidenceStrength(item, NOW, { peerAttested: true }).attained).toContain('peer_verified');
  });

  it('describes it as testimony rather than as a check', () => {
    const strength = evidenceStrength(verified(), NOW, { peerAttested: true });
    expect(strength.basis.peer_verified).toContain('testimony rather than a check');
  });

  /**
   * The ordering decision, asserted so it cannot drift back by accident.
   *
   * Under the brief's original order peer verification sat near the top, and
   * that was harmless while the order was only a label. Ranking now uses it,
   * so a peer attestation would have outranked a machine-verified outcome —
   * putting the most collusion-prone signal above the hardest to fake, and
   * inverting the product's own stated preference.
   */
  it('never outranks work corroborated against a source the candidate does not control', () => {
    // Was asserted against a graded task, which is no longer a check at all.
    // Held against repository ownership instead, which is the strongest thing
    // the platform can still establish.
    const peerOnly = evidenceStrength(verified({ verificationMethod: 'issuer_badge' }), NOW, {
      peerAttested: true,
    });
    const corroborated = evidenceStrength(verified({ verificationMethod: 'repo_ownership' }), NOW);

    const rank = (level: string) => EVIDENCE_STRENGTH_LEVELS.indexOf(level as never);
    expect(rank(strongestLevel(corroborated))).toBeGreaterThan(rank(strongestLevel(peerOnly)));
  });

  it('is still worth more than a bare claim', () => {
    const rank = (level: string) => EVIDENCE_STRENGTH_LEVELS.indexOf(level as never);
    expect(rank('peer_verified')).toBeGreaterThan(rank('claimed'));
  });

  it('cannot be reached by an unverified claim, whoever vouches for it', () => {
    // Somebody confirming an unchecked claim does not make it checked. The
    // whole hierarchy is inside the isVerified gate for this reason.
    const strength = evidenceStrength(evidence(), NOW, { peerAttested: true });
    expect(strength.attained).toEqual(['claimed']);
  });
});
