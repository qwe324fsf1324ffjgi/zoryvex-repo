import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublicProofNextStep } from '@/components/marketing/PublicProofNextStep';

/**
 * The public proof page is the only surface in this product a stranger
 * reaches, and it used to end without offering them anything.
 * docs/COMMERCIAL_RUNBOOK.md requires "one honest next action" on every
 * shared surface; this is that action, and these tests are mostly about the
 * ways it could stop being honest.
 */

describe('what a stranger is offered at the end of a proof page', () => {
  it('addresses both people who actually arrive here', () => {
    render(<PublicProofNextStep displayName="Amara" />);

    expect(screen.getByRole('link', { name: /make your own proof page/i })).toHaveAttribute(
      'href',
      '/for-talent',
    );
    expect(screen.getByRole('link', { name: /see how hiring works/i })).toHaveAttribute(
      'href',
      '/for-employers',
    );
  });

  /**
   * The candidate is free and the employer is not. A growth surface that
   * quietly omits which side pays is the cheapest possible dishonesty, and
   * this one names both.
   */
  it('says which side pays, rather than only that it is free', () => {
    render(<PublicProofNextStep displayName="Amara" />);

    expect(screen.getByText(/candidates pay nothing/i)).toBeTruthy();
    expect(screen.getByText(/that side is paid/i)).toBeTruthy();
  });

  /**
   * There is no honest number to print. The marketplace gate has not been
   * met, so any count of members, hires or companies would be invented, and
   * an invented number on a page about checkable claims discredits the
   * entire product. This asserts the absence rather than trusting a reviewer
   * to notice one being added later.
   */
  it('prints no membership count, testimonial or scarcity claim', () => {
    const { container } = render(<PublicProofNextStep displayName="Amara" />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/join \d|\d+[,\d]* (engineers|candidates|companies|members)/i);
    expect(text).not.toMatch(/limited time|spots? (left|remaining)|only \d+ left|hurry/i);
    expect(text).not.toMatch(/trusted by|loved by|rated \d/i);
  });

  /**
   * It is the candidate's page, not a recruiting surface we borrowed. They
   * published it to show their work, and asking their contacts to invite
   * their contacts would spend their credibility on our growth.
   */
  it('asks nobody to forward it or invite anyone', () => {
    const { container } = render(<PublicProofNextStep displayName="Amara" />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/refer a friend|invite your|share this with|tell your friends/i);
  });

  it('names the person whose page it is, so the context is not lost', () => {
    render(<PublicProofNextStep displayName="Amara" />);

    expect(screen.getByText(/Amara does not control/i)).toBeTruthy();
  });

  /**
   * The claim on this page is narrow on purpose, and the summary of it has to
   * stay as narrow as the proofs above it.
   */
  it('repeats the limits rather than overselling what a check means', () => {
    render(<PublicProofNextStep displayName="Amara" />);

    expect(
      screen.getByText(/do not score anybody, rank anybody, or decide who gets hired/i),
    ).toBeTruthy();
  });
});
