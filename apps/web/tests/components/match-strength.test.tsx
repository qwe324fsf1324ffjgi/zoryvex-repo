import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchStrength, matchStrengthSentence } from '../../src/components/employer/MatchStrength';

/**
 * The number is not a similarity score, and calling it "72% match" invited
 * the reader to imagine an engine that does not exist here.
 * `scoreCandidateAgainstRole` divides the weighted coverage of each
 * must-have requirement by the number of requirements, so it is the share
 * of what the employer said they needed that verified proof supports.
 */
describe('matchStrengthSentence', () => {
  it('names the quantity rather than calling it a match', () => {
    expect(matchStrengthSentence(0.72, 4)).toBe(
      '72% of your 4 must-have requirements backed by proof',
    );
    expect(matchStrengthSentence(0.72)).not.toContain('match');
  });

  it('gets the singular right, because a one-requirement role is common', () => {
    expect(matchStrengthSentence(1, 1)).toBe(
      '100% of your 1 must-have requirement backed by proof',
    );
  });

  it('says plainly that nothing supports the role rather than showing a bare zero', () => {
    expect(matchStrengthSentence(0, 4)).toBe('No verified proof supports this role yet');
  });

  it('still says something useful when the requirement count is not to hand', () => {
    expect(matchStrengthSentence(0.5)).toBe('50% of your must-have work backed by proof');
  });
});

describe('MatchStrength', () => {
  it('shows the percentage and what it is a percentage of', () => {
    render(<MatchStrength score={0.72} requirementCount={4} />);
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(
      screen.getByText(/of your 4 must-have requirements backed by proof/),
    ).toBeInTheDocument();
  });

  it('counts current proofs when the caller knows them', () => {
    render(<MatchStrength score={0.72} requirementCount={4} proofCount={3} />);
    expect(screen.getByText('3 current proofs')).toBeInTheDocument();
  });

  it('says none rather than zero', () => {
    render(<MatchStrength score={0} requirementCount={4} proofCount={0} />);
    expect(screen.getByText('no current proofs')).toBeInTheDocument();
    expect(screen.getByText('no proof supports this yet')).toBeInTheDocument();
  });

  it('omits the proof line entirely when the caller does not know it', () => {
    render(<MatchStrength score={0.72} requirementCount={4} />);
    expect(screen.queryByText(/current proof/)).not.toBeInTheDocument();
  });

  it('rounds rather than showing a long fraction', () => {
    render(<MatchStrength score={0.666} requirementCount={3} />);
    expect(screen.getByText('67%')).toBeInTheDocument();
  });
});
