import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Match } from '@zoryvex/contracts';
import { ClosestFitNote } from '@/components/employer/ClosestFitNote';

/**
 * Matching stopped excluding people, which left a shortlist that can be
 * entirely near-misses with nothing saying so. An employer opening a page
 * where every card reads "Close, not exact" has no way to tell whether that
 * is a failure, whether the list is ordered, or whether any of it is worth
 * reading.
 */
function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    roleId: 'role_1',
    candidateId: 'cand_1',
    matchScore: 0.6,
    status: 'suggested',
    contactUnlocked: false,
    createdAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('the note above a shortlist of near-misses', () => {
  it('appears when nothing on the list is an exact match', () => {
    render(<ClosestFitNote matches={[match({ fit: 'partial' }), match({ fit: 'adjacent' })]} />);
    expect(screen.getByText(/Nobody here matches every requirement/i)).toBeTruthy();
  });

  it('stays away when an exact match exists, so it is never noise', () => {
    const { container } = render(
      <ClosestFitNote matches={[match({ fit: 'meets' }), match({ fit: 'partial' })]} />,
    );
    expect(container.textContent).toBe('');
  });

  it('says nothing on an empty shortlist, which has its own empty state', () => {
    const { container } = render(<ClosestFitNote matches={[]} />);
    expect(container.textContent).toBe('');
  });

  it('treats a match written before fit tiering as exact, not as a near-miss', () => {
    // `fit` is optional and read as `meets` everywhere else. A stored
    // shortlist must not start apologising for itself because a field was
    // added after it was written.
    const { container } = render(<ClosestFitNote matches={[match()]} />);
    expect(container.textContent).toBe('');
  });

  it('encourages a conversation without recommending a hire', () => {
    // The product never makes the hiring call. Suggesting somebody is worth
    // talking to is a different claim from suggesting they are the answer.
    render(<ClosestFitNote matches={[match({ fit: 'partial' })]} />);
    expect(screen.getByText(/worth a conversation/i)).toBeTruthy();
    expect(screen.queryByText(/best candidate|should hire|recommend hiring/i)).toBeNull();
  });
});
