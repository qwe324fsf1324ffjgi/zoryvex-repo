import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofItem } from '../../src/components/employer/ProofItem';
import type { VerifiedEvidenceSummary } from '../../src/lib/real-api/matches';

/**
 * The screen an employer pays to read. Every test here is about the gap
 * between "verified" and what was actually established, which is the only
 * thing this product sells.
 */

const item = (over: Partial<VerifiedEvidenceSummary> = {}): VerifiedEvidenceSummary => ({
  evidenceId: 'ev_1',
  claim: 'Built Terraform IaC for a multi-account AWS setup',
  context: 'At a payments company',
  actions: 'Wrote modules, wired CI/CD',
  outcome: 'Deployed reliably for a year',
  method: 'issuer_badge',
  detail: 'AWS Certified Solutions Architect, confirmed with AWS.',
  sourceAvailable: true,
  sourceUrl: 'https://www.credly.com/badges/abc',
  verifiedAt: '2026-08-20T00:00:00.000Z',
  strength: {
    attained: ['claimed', 'knowledge_assessed'],
    basis: {
      claimed: 'The candidate wrote this themselves.',
      knowledge_assessed: 'Confirmed with the body that issued it.',
    },
    unsupported: ['process_observed'],
  },
  attempts: null,
  attemptSummary: null,
  ...over,
});

const renderItem = (over: Partial<VerifiedEvidenceSummary> = {}) =>
  render(
    <ul>
      <ProofItem item={item(over)} />
    </ul>,
  );

const ATTEMPT = {
  evidenceId: 'ev_1',
  taskId: 'task_least_privilege_role_v1',
  passed: false,
  failedCheckIds: [] as string[],
  disqualified: false,
  at: '2026-08-19T00:00:00.000Z',
};

describe('what was checked', () => {
  it('names the check rather than only saying verified', () => {
    renderItem();
    expect(screen.getByText(/Confirmed with the issuer/)).toBeTruthy();
    expect(screen.getByText(/AWS Certified Solutions Architect/)).toBeTruthy();
  });

  it('sends the employer to the source to check it without us', () => {
    renderItem();
    const link = screen.getByRole('link', { name: /check this yourself/i });
    expect(link.getAttribute('href')).toBe('https://www.credly.com/badges/abc');
  });

  it('says what Zoryvex cannot establish for anybody, not only what it did', () => {
    // An employer who cannot tell "this candidate did not do that" from
    // "Zoryvex does not check that" is being misled by omission.
    renderItem();
    expect(
      screen.getByText(/limit of what we check, not a finding about this candidate/),
    ).toBeTruthy();
  });
});

describe('the attempts behind a graded task', () => {
  const graded = (over: Partial<VerifiedEvidenceSummary> = {}) =>
    renderItem({
      method: 'graded_task',
      detail: 'Least-privilege IAM role, scored against a published rubric.',
      sourceUrl: null,
      strength: {
        attained: ['claimed', 'skill_demonstrated'],
        basis: {
          claimed: 'The candidate wrote this themselves.',
          skill_demonstrated: 'Scored against a rubric published in advance.',
        },
        unsupported: ['process_observed'],
      },
      ...over,
    });

  it('separates passing first time from passing after being told', () => {
    graded({
      attempts: {
        attempts: [
          { ...ATTEMPT, attemptNumber: 1, failedCheckIds: ['no_wildcard_action'] },
          { ...ATTEMPT, attemptNumber: 2, passed: true, at: '2026-08-20T00:00:00.000Z' },
        ],
        passedFirstTime: false,
        everDisqualified: false,
      },
      attemptSummary: 'Passed on attempt 2 of 2. Earlier attempts missed: no_wildcard_action.',
    });

    // Twice by design: the headline says what happened, the breakdown below
    // says which attempt it happened on. getAllByText, because asserting on
    // exactly one would be asserting the breakdown away.
    expect(screen.getByText(/Passed on attempt 2 of 2/)).toBeTruthy();
    expect(screen.getAllByText(/no_wildcard_action/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Attempt 1/)).toBeTruthy();
  });

  it('surfaces a disqualifying attempt even though a later one passed', () => {
    // Hiding it behind an eventual pass would choose for the employer.
    graded({
      attempts: {
        attempts: [
          {
            ...ATTEMPT,
            attemptNumber: 1,
            failedCheckIds: ['no_hardcoded_secret'],
            disqualified: true,
          },
          { ...ATTEMPT, attemptNumber: 2, passed: true, at: '2026-08-20T00:00:00.000Z' },
        ],
        passedFirstTime: false,
        everDisqualified: true,
      },
      attemptSummary:
        'Passed on attempt 2 of 2. Earlier attempts missed: no_hardcoded_secret. At least one attempt tripped a disqualifying check.',
    });

    expect(screen.getAllByText(/tripped a disqualifying check/).length).toBeGreaterThan(0);
  });

  /**
   * Three attempts is not worse than one. Good engineers get something
   * wrong, are told, and fix it, and a screen that graded the sequence would
   * teach candidates to submit once and guess.
   */
  it('presents the sequence as facts and never as a score', () => {
    const { container } = graded({
      attempts: {
        attempts: [{ ...ATTEMPT, attemptNumber: 1, passed: true, at: '2026-08-20T00:00:00.000Z' }],
        passedFirstTime: true,
        everDisqualified: false,
      },
      attemptSummary: 'Passed on the first submission, with nothing outstanding.',
    });

    const text = (container.textContent ?? '').toLowerCase();
    for (const judgement of ['poor', 'weak', 'struggled', 'red flag', 'concerning']) {
      expect(text).not.toContain(judgement);
    }
  });

  it('shows no attempt block for a method that has no rubric', () => {
    // A certification has no attempts, and "no graded attempt recorded"
    // against one would read as something missing rather than something that
    // never applied.
    const { container } = renderItem();
    expect(container.textContent).not.toContain('Attempt');
  });
});

/**
 * What an employer without marketplace access sees in place of the address.
 *
 * The server withholds `sourceUrl` for an organization whose subscription
 * does not currently grant access, so this component receives null and must
 * not render a link. It must also not render nothing: `sourceAvailable`
 * stays true because an independent record genuinely exists, and a page that
 * silently dropped the whole block would make a checked claim look unchecked
 * and understate the candidate.
 */
describe('an independent record that this subscription cannot open', () => {
  it('renders no link and no address at all', () => {
    render(<ProofItem item={item({ sourceUrl: null, sourceAvailable: true })} />);

    expect(screen.queryByRole('link', { name: /check this yourself/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain('credly.com');
  });

  it('still says the record exists, and who holds it', () => {
    render(<ProofItem item={item({ sourceUrl: null, sourceAvailable: true })} />);

    expect(screen.getByText(/The issuer holds a public record of this check/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /see the plans/i })).toBeTruthy();
  });

  it('names GitHub rather than the issuer for a repository check', () => {
    render(
      <ProofItem
        item={item({ sourceUrl: null, sourceAvailable: true, method: 'repo_ownership' })}
      />,
    );

    expect(screen.getByText(/GitHub holds a public record of this check/i)).toBeTruthy();
  });

  it('says nothing at all when there is genuinely no third party', () => {
    // Not a plan limit, so offering a subscription here would be selling
    // something that does not exist for this item.
    render(<ProofItem item={item({ sourceUrl: null, sourceAvailable: false })} />);

    expect(screen.queryByText(/holds a public record/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /see the plans/i })).toBeNull();
  });

  it('links normally once the organization is entitled', () => {
    render(<ProofItem item={item()} />);

    const link = screen.getByRole('link', { name: /check this yourself at the source/i });
    expect(link.getAttribute('href')).toBe('https://www.credly.com/badges/abc');
  });
});
