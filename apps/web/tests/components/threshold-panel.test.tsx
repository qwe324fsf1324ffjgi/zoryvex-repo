import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Evidence } from '@zoryvex/contracts';
import { thresholdStanding, ThresholdPanel } from '../../src/components/candidate/ThresholdPanel';

const NOW = new Date('2026-09-01T12:00:00.000Z');

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: 'cand_1',
    source: 'project',
    claim: 'Cut deploy time',
    context: 'A team of four',
    actions: 'Rewrote the pipeline',
    outcome: 'From forty minutes to six',
    verificationState: 'unverified',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const proved = evidence({ id: 'ev_proved', verificationState: 'verified' });
const lapsed = evidence({
  id: 'ev_lapsed',
  verificationState: 'verified',
  verificationExpiresAt: '2026-01-01T00:00:00.000Z',
});

describe('thresholdStanding', () => {
  /**
   * `recomputeMatchesForRole` writes no match at all for a candidate with no
   * verified evidence — not a match scored zero, no match. Somebody with an
   * account and nothing checked was invisible to every employer and had no
   * way to know it, and would reasonably conclude the product was empty
   * rather than that they were outside it.
   */
  it('says plainly that an unchecked candidate cannot be seen', () => {
    const standing = thresholdStanding(true, [], NOW);
    expect(standing.tone).toBe('out');
    expect(standing.heading).toMatch(/cannot see you/i);
    expect(standing.next?.href).toBe('/candidate/evidence/new');
  });

  it('tells a candidate with filed but unchecked claims that a claim scores nothing', () => {
    const standing = thresholdStanding(true, [evidence(), evidence({ id: 'ev_2' })], NOW);
    expect(standing.tone).toBe('out');
    expect(standing.body).toMatch(/scores nothing/);
    expect(standing.next?.label).toMatch(/checked/i);
  });

  it('lets a proved, opted-in candidate know they are in', () => {
    const standing = thresholdStanding(true, [proved], NOW);
    expect(standing.tone).toBe('in');
    expect(standing.heading).toMatch(/You are in, on 1 proof/);
  });

  it('counts proofs rather than claims in the heading', () => {
    const standing = thresholdStanding(
      true,
      [proved, evidence({ id: 'ev_2' }), evidence({ id: 'ev_3', verificationState: 'verified' })],
      NOW,
    );
    expect(standing.heading).toMatch(/on 2 proofs/);
  });

  /**
   * Not a penalty, and the copy has to say so: the same rule that makes a
   * proof worth something is the rule that retires it.
   */
  it('explains a lapse as the meaning of "checked", not as a punishment', () => {
    const standing = thresholdStanding(true, [lapsed], NOW);
    expect(standing.tone).toBe('out');
    expect(standing.heading).toMatch(/lapsed/i);
    expect(standing.body).toMatch(/not a penalty/i);
  });

  it('names the discovery switch when that is the only thing in the way', () => {
    const standing = thresholdStanding(false, [proved], NOW);
    expect(standing.tone).toBe('out');
    expect(standing.heading).toMatch(/nobody can see it/);
    // No action button: the switch is on this same page, right below.
    expect(standing.next).toBeNull();
  });

  /**
   * A private item never reaches an employer, so it cannot be what gets a
   * candidate found. Counting it would be the product congratulating
   * somebody for something that does nothing.
   */
  it('does not count a private proof toward being findable', () => {
    const standing = thresholdStanding(
      true,
      [evidence({ verificationState: 'verified', visibility: 'private' })],
      NOW,
    );
    expect(standing.tone).toBe('out');
    expect(standing.heading).toMatch(/only proof is private/i);
  });

  it('mentions lapsed proofs even when a live one keeps the candidate in', () => {
    const standing = thresholdStanding(true, [proved, lapsed], NOW);
    expect(standing.tone).toBe('in');
    expect(standing.body).toMatch(/lapsed and stopped counting/);
  });
});

describe('ThresholdPanel', () => {
  it('announces the standing to assistive technology, since it changes as you work', () => {
    render(<ThresholdPanel discoveryOptIn={true} evidence={[]} now={NOW} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers the next step as a real control, not just a sentence', () => {
    render(<ThresholdPanel discoveryOptIn={true} evidence={[]} now={NOW} />);
    expect(screen.getByRole('link', { name: /File your first claim/ })).toHaveAttribute(
      'href',
      '/candidate/evidence/new',
    );
  });
});
