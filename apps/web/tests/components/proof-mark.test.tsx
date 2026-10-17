import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofMark, proofMarkState } from '../../src/components/ui/ProofMark';

const NOW = new Date('2026-09-01T12:00:00.000Z');

describe('proofMarkState', () => {
  it('is unproved for anything that has not passed a check', () => {
    expect(proofMarkState({ verificationState: 'unverified' }, NOW)).toBe('unproved');
    expect(proofMarkState({ verificationState: 'self_attested' }, NOW)).toBe('unproved');
  });

  it('is proved when there is no expiry, which means the credential does not lapse', () => {
    expect(proofMarkState({ verificationState: 'verified' }, NOW)).toBe('proved');
  });

  it('is proved while the credential is still current', () => {
    expect(
      proofMarkState(
        { verificationState: 'verified', verificationExpiresAt: '2027-01-01T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('proved');
  });

  /**
   * The server stops counting a lapsed credential the day it lapses
   * (`isVerified` in matching-service). A mark that kept showing a live
   * check for something the marketplace had already dropped would be the
   * first "trust me" in a product built against that sentence.
   */
  it('is lapsed once the credential has expired, even though the record still says verified', () => {
    expect(
      proofMarkState(
        { verificationState: 'verified', verificationExpiresAt: '2026-01-01T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('lapsed');
  });

  it('treats an unreadable expiry as lapsed rather than as current', () => {
    // Date.parse salvages a year out of prose, so an unshaped value has to
    // be refused before parsing or "sometime in 2029" becomes confident.
    expect(
      proofMarkState(
        { verificationState: 'verified', verificationExpiresAt: 'sometime in 2029' },
        NOW,
      ),
    ).toBe('lapsed');
  });
});

describe('ProofMark', () => {
  it('says when it was checked and when it stops being true', () => {
    render(
      <ProofMark
        state="proved"
        checkedAt="2026-08-01T00:00:00.000Z"
        lapsesAt="2027-06-14T00:00:00.000Z"
      />,
    );
    const group = screen.getByRole('group');
    expect(group).toHaveAccessibleName(/Proved on/);
    expect(group).toHaveAccessibleName(/lapses/);
  });

  it('says a proof does not lapse rather than leaving the date blank', () => {
    render(<ProofMark state="proved" checkedAt="2026-08-01T00:00:00.000Z" />);
    expect(screen.getByText(/does not lapse/)).toBeInTheDocument();
  });

  it('shows a lapsed proof rather than hiding it', () => {
    render(
      <ProofMark
        state="lapsed"
        checkedAt="2024-08-01T00:00:00.000Z"
        lapsesAt="2026-01-01T00:00:00.000Z"
      />,
    );
    expect(screen.getByText('Lapsed')).toBeInTheDocument();
    expect(screen.getByRole('group')).toHaveAccessibleName(/It was proved on/);
  });

  it('tells an unproved claim what the next step is', () => {
    render(<ProofMark state="unproved" />);
    expect(screen.getByText(/File the four lines, then submit it/)).toBeInTheDocument();
  });

  it('carries the date into the accessible name, not only the pixels', () => {
    // A screen reader getting the word "verified" alone would be told less
    // than a sighted reader, and the date is the whole point of the mark.
    render(<ProofMark state="proved" checkedAt="2026-08-01T00:00:00.000Z" />);
    expect(screen.getByRole('group')).toHaveAccessibleName(/2026/);
  });

  it('names what was checked when there is something to say', () => {
    render(
      <ProofMark
        state="proved"
        checkedAt="2026-08-01T00:00:00.000Z"
        detail="AWS Certified Solutions Architect, confirmed with AWS Training and Certification"
      />,
    );
    expect(screen.getByText(/AWS Certified Solutions Architect/)).toBeInTheDocument();
  });
});
