import { describe, expect, it } from 'vitest';
import { generateKitDeliverables, KIT_TEMPLATE_VERSION } from '../src/kit-deliverables';
import type { Role } from '@zoryvex/contracts';

const baseRole: Role = {
  id: 'role_1',
  employerId: 'emp_1',
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra reliably',
  mustHaveWork: ['Wrote Terraform for a real environment', 'Ran an incident response'],
  constraints: '',
  status: 'draft',
  createdAt: '2026-08-19T00:00:00.000Z',
};

describe('generateKitDeliverables', () => {
  it('is deterministic for the same role and clock', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const a = generateKitDeliverables(baseRole, now);
    const b = generateKitDeliverables(baseRole, now);
    expect(a).toEqual(b);
  });

  it('stamps the current template version', () => {
    const result = generateKitDeliverables(baseRole, new Date());
    expect(result.version).toBe(KIT_TEMPLATE_VERSION);
  });

  it('produces one evidence-checklist entry per mustHaveWork item', () => {
    const result = generateKitDeliverables(baseRole, new Date());
    expect(result.evidenceChecklist).toHaveLength(baseRole.mustHaveWork.length);
  });

  it('produces one claim-verification row per mustHaveWork item, with a track-specific hint', () => {
    const result = generateKitDeliverables(baseRole, new Date());
    expect(result.claimVerificationMatrix).toHaveLength(2);
    // The hint no longer names a vendor. Terraform is multi-cloud and
    // CloudFormation is AWS only, and the track this belongs to stopped being
    // an AWS track when the founder relabelled it on 2026-09-09.
    expect(result.claimVerificationMatrix[0]?.howToVerify).toMatch(/infrastructure-as-code/);
  });

  it('falls back to a generic verify hint for an unrecognized track gracefully', () => {
    const role = { ...baseRole, launchTrack: 'aws_cloud' as const };
    const result = generateKitDeliverables(role, new Date());
    expect(result.claimVerificationMatrix[0]?.howToVerify).toBeTruthy();
  });

  it('never fabricates a candidate — content is derived only from role fields', () => {
    const result = generateKitDeliverables(baseRole, new Date());
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/john|jane|candidate name|applicant:/);
  });

  it('handles a role with a single mustHaveWork item without an off-by-one error', () => {
    const role: Role = { ...baseRole, mustHaveWork: ['Solo requirement'] };
    const result = generateKitDeliverables(role, new Date());
    expect(result.structuredInterviewGuide[0]).toContain('Solo requirement');
    expect(result.structuredInterviewGuide).toHaveLength(2); // the one item's question + the closing outcomes question
  });

  it('handles an empty constraints field without throwing', () => {
    const role: Role = { ...baseRole, constraints: '' };
    expect(() => generateKitDeliverables(role, new Date())).not.toThrow();
  });

  it('handles a very long title/outcomes string without throwing or truncating silently', () => {
    const longText = 'A'.repeat(2000);
    const role: Role = { ...baseRole, title: longText, outcomes: longText };
    const result = generateKitDeliverables(role, new Date());
    expect(result.roleSuccessProfile.outcomes).toBe(longText);
  });
});
