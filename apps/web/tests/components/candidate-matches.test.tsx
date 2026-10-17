import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InterestState } from '@zoryvex/contracts';
import CandidateMatchesPage from '../../app/candidate/(app)/matches/page';

/**
 * The candidate's half of a mutual match.
 *
 * This screen did not exist. Matching wrote rows keyed by candidate that
 * no candidate could read, so "mutual matching" described a behaviour the
 * product could not perform: one side had no way to answer.
 *
 * What these pin is not the wording but the behaviour that makes the
 * feature honest — that an unanswered match does not read as a refusal,
 * that a failed load never renders as "you matched nobody", and that
 * nothing about another candidate can reach the screen.
 */

const listMyMatches = vi.fn();
const setMyInterest = vi.fn();

vi.mock('@/lib/use-session', () => ({
  useSession: () => ({ candidateId: 'cand_1', role: 'candidate' }),
}));

vi.mock('@/lib/real-api', () => ({
  isRealApiConfigured: () => true,
  messageFor: (_error: unknown, fallback: string) => fallback,
  realCandidateMatches: {
    listMyMatches: (...args: unknown[]) => listMyMatches(...args),
    setMyInterest: (...args: unknown[]) => setMyInterest(...args),
  },
}));

const baseMatch = {
  roleId: 'role_1',
  roleTitle: 'Platform engineer',
  employerId: 'emp_1',
  matchScore: 0.82,
  fit: 'meets' as const,
  candidateInterest: 'unstated' as InterestState,
  employerInterest: 'unstated' as InterestState,
  mutual: false,
};

beforeEach(() => {
  listMyMatches.mockReset();
  setMyInterest.mockReset();
});

describe('when the candidate has matches', () => {
  it('shows the role and both ways to answer', async () => {
    listMyMatches.mockResolvedValue([baseMatch]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText('Platform engineer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i am interested/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /not for me/i })).toBeEnabled();
  });

  it('shows the pay range when the employer published one', async () => {
    listMyMatches.mockResolvedValue([
      {
        ...baseMatch,
        compensation: {
          engagementKind: 'employment',
          compensation: { minNGN: 800_000, maxNGN: 1_200_000, period: 'month' },
        },
      },
    ]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText('NGN 800,000 to NGN 1,200,000 per month')).toBeInTheDocument();
  });

  it('says nothing about pay when the employer published none', async () => {
    listMyMatches.mockResolvedValue([baseMatch]);
    render(<CandidateMatchesPage />);

    await screen.findByText('Platform engineer');
    expect(screen.queryByText(/NGN/)).toBeNull();
  });

  it('explains why a partial match is partial, rather than showing a bare score', async () => {
    listMyMatches.mockResolvedValue([
      { ...baseMatch, fit: 'partial', fitReason: 'This role can employ in US.' },
    ]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText('This role can employ in US.')).toBeInTheDocument();
  });

  /**
   * The state that must not read as rejection. An unanswered match is
   * somebody who has not looked yet.
   */
  it('does not present an unanswered match as declined', async () => {
    listMyMatches.mockResolvedValue([baseMatch]);
    render(<CandidateMatchesPage />);

    await screen.findByText('Platform engineer');
    expect(screen.queryByText(/you said no/i)).toBeNull();
    expect(screen.queryByText(/you said yes/i)).toBeNull();
  });

  it('tells the candidate when the employer has already said yes', async () => {
    listMyMatches.mockResolvedValue([{ ...baseMatch, employerInterest: 'interested' }]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText(/they are interested/i)).toBeInTheDocument();
  });

  it('announces a mutual match only when both sides said yes', async () => {
    listMyMatches.mockResolvedValue([
      {
        ...baseMatch,
        candidateInterest: 'interested',
        employerInterest: 'interested',
        mutual: true,
      },
    ]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText(/you both said yes/i)).toBeInTheDocument();
  });
});

describe('answering a match', () => {
  it('sends the answer and re-reads, because mutual depends on the other side', async () => {
    // Stateful rather than a queue of one-shot results: the component
    // re-reads after saving, and an exhausted mockResolvedValueOnce chain
    // returns undefined, which fails as a mock artefact rather than as a
    // real defect.
    let current = [{ ...baseMatch }];
    listMyMatches.mockImplementation(async () => current);
    setMyInterest.mockImplementation(async () => {
      current = [
        {
          ...baseMatch,
          candidateInterest: 'interested',
          employerInterest: 'interested',
          mutual: true,
        },
      ];
      return {};
    });

    render(<CandidateMatchesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /i am interested/i }));

    await waitFor(() => expect(setMyInterest).toHaveBeenCalledWith('role_1', 'interested'));
    expect(await screen.findByText(/you both said yes/i)).toBeInTheDocument();
  });

  it('lets a candidate withdraw an answer they already gave', async () => {
    listMyMatches.mockResolvedValue([{ ...baseMatch, candidateInterest: 'interested' }]);
    setMyInterest.mockResolvedValue({});

    render(<CandidateMatchesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /change to not interested/i }));

    await waitFor(() => expect(setMyInterest).toHaveBeenCalledWith('role_1', 'declined'));
  });

  /** A double click must not send two answers. */
  it('disables the buttons while the answer is in flight', async () => {
    listMyMatches.mockResolvedValue([baseMatch]);
    let resolve: (value: unknown) => void = () => {};
    setMyInterest.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<CandidateMatchesPage />);
    const button = await screen.findByRole('button', { name: /i am interested/i });
    await userEvent.click(button);

    expect(await screen.findByRole('button', { name: /saving/i })).toBeDisabled();
    resolve({});
  });

  it('reports a failed save without pretending it worked', async () => {
    listMyMatches.mockResolvedValue([baseMatch]);
    setMyInterest.mockRejectedValue(new Error('network'));

    render(<CandidateMatchesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /i am interested/i }));

    expect(await screen.findByText(/that did not save/i)).toBeInTheDocument();
  });
});

describe('the states that are not a list of matches', () => {
  it('says plainly when there are none, and why', async () => {
    listMyMatches.mockResolvedValue([]);
    render(<CandidateMatchesPage />);

    expect(await screen.findByText(/no roles yet/i)).toBeInTheDocument();
  });

  /**
   * The distinction that matters most on this screen. A failed request
   * rendered as an empty list tells somebody their verified work matched
   * nobody, which is false and discouraging in a way that is hard to
   * undo.
   */
  it('does not render a failed load as an empty list', async () => {
    listMyMatches.mockRejectedValue(new Error('offline'));
    render(<CandidateMatchesPage />);

    expect(await screen.findByText(/could not load your matches/i)).toBeInTheDocument();
    expect(screen.queryByText(/no roles yet/i)).toBeNull();
  });

  it('offers a retry that actually calls the API again', async () => {
    let failNext = true;
    listMyMatches.mockImplementation(async () => {
      if (failNext) {
        failNext = false;
        throw new Error('offline');
      }
      return [baseMatch];
    });

    render(<CandidateMatchesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Platform engineer')).toBeInTheDocument();
  });
});
