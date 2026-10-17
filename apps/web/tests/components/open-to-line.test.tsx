import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpenToLine } from '@/components/employer/OpenToLine';

/**
 * What a candidate said they want, shown to the employer deciding whether to
 * spend an unlock on them.
 *
 * `intent.openTo` has been read by matching since it was written and shown
 * to nobody. It only ever surfaced as an absence: when the list excludes
 * what the role offers, the fit reason says so. When it includes it, or
 * when the candidate listed nothing, the employer was told nothing either
 * way, so "open to tutoring" and "never answered" looked identical.
 */
describe('what the candidate is open to', () => {
  it('names the kinds in words an employer reads, not codes', () => {
    render(<OpenToLine openTo={['tutoring', 'mentoring']} />);
    expect(screen.getByText(/Tutoring toward a skill or certification/)).toBeTruthy();
    expect(screen.getByText(/Mentoring one person/)).toBeTruthy();
  });

  it('says plainly when they stated no preference', () => {
    // An empty list is an answer, and it is the reason the role was not
    // ruled out on this. Silence here would read as "we do not know".
    render(<OpenToLine openTo={[]} />);
    expect(screen.getByText(/have not said which kinds of work/i)).toBeTruthy();
  });

  it('says nothing at all for a shortlist written before the field existed', () => {
    // Absent is genuinely different from empty: one means they chose
    // nothing, the other means nobody asked. Claiming the first when it is
    // the second would put words in a candidate's mouth.
    const { container } = render(<OpenToLine openTo={undefined} />);
    expect(container.textContent).toBe('');
  });

  it('does not invent a preference the candidate never gave', () => {
    render(<OpenToLine openTo={['contract']} />);
    expect(screen.queryByText(/Permanent role/)).toBeNull();
    expect(screen.getByText(/Contract or project work/)).toBeTruthy();
  });
});
