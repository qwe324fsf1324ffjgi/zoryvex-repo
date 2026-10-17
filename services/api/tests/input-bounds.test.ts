import { describe, expect, it } from 'vitest';
import { TEXT_LIMITS } from '@zoryvex/contracts';
import { CreateEvidenceSchema } from '../handlers/candidates/evidence-create';
import { CreateRoleSchema } from '../handlers/roles/create';

/**
 * Every free-text field a person types was unbounded until 2026-09-04.
 *
 * The codebase already bounded the fields somebody thought about - a badge
 * URL at 2048, a task id at 128, an HCL submission at 64KB, a peer statement
 * at 600 - which is what made the gap easy to miss: it looked like a codebase
 * that bounded its input. Evidence carries four free-text fields on one
 * DynamoDB row, and a row cannot exceed 400KB, so a long enough submission
 * failed the write after the candidate had written the whole thing.
 *
 * These test the boundary rather than the constant: one character under the
 * limit is accepted, one over is refused. A test that only asserted the
 * constant's value would pass even if the schema stopped using it.
 */

const validEvidence = {
  source: 'project' as const,
  claim: 'Built a multi-account landing zone',
  context: 'At a payments company',
  actions: 'Wrote the modules and split accounts by environment',
  outcome: 'Ran for a year with no account-level incident',
  visibility: 'discovery' as const,
  consentGiven: true,
};

const validRole = {
  launchTrack: 'aws_cloud' as const,
  title: 'Cloud Platform Engineer',
  seniority: 'mid' as const,
  outcomes: 'Ship a landing zone',
  mustHaveWork: ['Built a landing zone with Terraform'],
};

const times = (n: number) => 'a'.repeat(n);

describe('evidence input bounds', () => {
  const fields = [
    ['claim', TEXT_LIMITS.claim],
    ['context', TEXT_LIMITS.context],
    ['actions', TEXT_LIMITS.actions],
    ['outcome', TEXT_LIMITS.outcome],
  ] as const;

  for (const [field, limit] of fields) {
    it(`accepts ${field} at exactly ${limit} characters`, () => {
      const result = CreateEvidenceSchema.safeParse({ ...validEvidence, [field]: times(limit) });
      expect(result.success).toBe(true);
    });

    it(`refuses ${field} one character over the limit`, () => {
      const result = CreateEvidenceSchema.safeParse({
        ...validEvidence,
        [field]: times(limit + 1),
      });
      expect(result.success).toBe(false);
    });
  }

  it('still refuses an empty required field', () => {
    // The lower bound existed before and must survive adding an upper one.
    expect(CreateEvidenceSchema.safeParse({ ...validEvidence, claim: '' }).success).toBe(false);
  });

  it('keeps all four fields together well inside a DynamoDB item', () => {
    // The reason the limits are what they are. 400KB is the hard ceiling;
    // the four fields together must not come close enough that metadata,
    // indexes and encoding overhead could push a legitimate row over.
    const worstCase =
      TEXT_LIMITS.claim + TEXT_LIMITS.context + TEXT_LIMITS.actions + TEXT_LIMITS.outcome;
    expect(worstCase).toBeLessThan(40_000);
  });
});

describe('role input bounds', () => {
  it('accepts a title at exactly the limit and refuses one over', () => {
    expect(
      CreateRoleSchema.safeParse({ ...validRole, title: times(TEXT_LIMITS.roleTitle) }).success,
    ).toBe(true);
    expect(
      CreateRoleSchema.safeParse({ ...validRole, title: times(TEXT_LIMITS.roleTitle + 1) }).success,
    ).toBe(false);
  });

  /**
   * mustHaveWork is bounded in both directions because matching scores every
   * requirement against every piece of a candidate's evidence. An unbounded
   * list is unbounded work per candidate, not merely a large row - a cost
   * problem as much as a validation one.
   */
  it('refuses more requirements than the matcher should ever score', () => {
    const tooMany = Array.from(
      { length: TEXT_LIMITS.mustHaveWorkCount + 1 },
      () => 'A requirement',
    );
    expect(CreateRoleSchema.safeParse({ ...validRole, mustHaveWork: tooMany }).success).toBe(false);
  });

  it('accepts exactly the maximum number of requirements', () => {
    const atLimit = Array.from({ length: TEXT_LIMITS.mustHaveWorkCount }, () => 'A requirement');
    expect(CreateRoleSchema.safeParse({ ...validRole, mustHaveWork: atLimit }).success).toBe(true);
  });

  it('refuses a single requirement longer than the per-item limit', () => {
    expect(
      CreateRoleSchema.safeParse({
        ...validRole,
        mustHaveWork: [times(TEXT_LIMITS.mustHaveWorkItem + 1)],
      }).success,
    ).toBe(false);
  });

  it('still requires at least one requirement', () => {
    expect(CreateRoleSchema.safeParse({ ...validRole, mustHaveWork: [] }).success).toBe(false);
  });
});
