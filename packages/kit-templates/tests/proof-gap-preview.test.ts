import { describe, expect, it } from 'vitest';
import { generateProofGapPreview } from '../src/proof-gap-preview';

describe('generateProofGapPreview', () => {
  it('lists every mustHaveWork item as a gap', () => {
    const preview = generateProofGapPreview({
      title: 'Cloud Engineer',
      mustHaveWork: ['Terraform', 'CI/CD'],
      outcomes: 'Ship reliably',
    });
    expect(preview.gaps).toEqual(['Terraform', 'CI/CD']);
  });

  it('never fabricates a candidate name or implies payment has occurred', () => {
    const preview = generateProofGapPreview({
      title: 'Cloud Engineer',
      mustHaveWork: ['Terraform'],
      outcomes: 'Ship reliably',
    });
    const combined = `${preview.headline} ${preview.note}`.toLowerCase();
    expect(combined).not.toMatch(/candidate matched|paid|purchase complete|order confirmed/);
  });

  it('closes on the consequence, not on a list of deliverables', () => {
    // The note is the last thing read at the moment the gaps land, and a
    // feature list there answers a question the reader has not asked yet.
    const preview = generateProofGapPreview({
      title: 'Cloud Engineer',
      mustHaveWork: ['Terraform'],
      outcomes: 'Ship reliably',
    });
    expect(preview.note).toContain('claim');
    expect(preview.note).not.toMatch(/interview guide|decision scorecard|assessment rubric/i);
  });

  it('sells without evidence this project cannot produce', () => {
    // docs/COMMERCIAL_RUNBOOK.md forbids claims that outrun the evidence, and
    // the rule holds when the claim would favour us. There is no sourced
    // hiring statistic anywhere in this repository.
    const preview = generateProofGapPreview({
      title: 'Cloud Engineer',
      mustHaveWork: ['Terraform'],
      outcomes: 'Ship reliably',
    });
    const combined = `${preview.headline} ${preview.note}`;
    expect(combined).not.toMatch(/\d+\s*%/);
    expect(combined).not.toMatch(/studies|research shows|on average|industry average/i);
  });

  it('uses singular phrasing for exactly one gap', () => {
    const preview = generateProofGapPreview({ title: 'X', mustHaveWork: ['A'], outcomes: 'Y' });
    expect(preview.headline).toContain('1 specific thing');
  });

  it('uses plural phrasing for multiple gaps', () => {
    const preview = generateProofGapPreview({
      title: 'X',
      mustHaveWork: ['A', 'B'],
      outcomes: 'Y',
    });
    expect(preview.headline).toContain('2 specific things');
  });
});
