import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The reported failure: "after creating [a] gist and adding [the] repo link
 * the check button is not working".
 *
 * It was working exactly as written. `canSubmit` needs both the gist link and
 * the repository link, and with one of them empty the button is disabled and
 * goes grey. Nothing said which one was missing, and nothing distinguished
 * "not ready yet" from "broken", so the only available reading of a button
 * that will not press is that the button is broken. That reading is correct
 * from where the user is standing, which makes it a defect in the page rather
 * than a misunderstanding by the person using it.
 *
 * These tests hold the explanation in place: the reason has to name the field
 * that is actually outstanding, and it has to be attached to the button for
 * somebody who cannot see that the two are next to each other.
 */

const getEvidence = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=ev_1'),
}));

vi.mock('@/lib/real-api', () => ({
  isRealApiConfigured: () => true,
  realEvidenceClaims: {
    getEvidence: (...args: unknown[]) => getEvidence(...args),
    beginRepoVerification: vi.fn(),
    verifyEvidence: vi.fn(),
  },
}));

const { default: VerifyEvidencePage } =
  await import('../../app/candidate/(app)/evidence/verify/page');

beforeEach(() => {
  getEvidence.mockReset();
  getEvidence.mockResolvedValue({
    evidence: {
      id: 'ev_1',
      claim: 'I built the deployment pipeline for a payments service.',
      source: 'github',
      verificationState: 'unverified',
    },
    peerAttestations: [],
  });
});

/**
 * Fills a field with one paste rather than one event per character.
 *
 * userEvent.type dispatches a keystroke per character, so the two tests that
 * fill both URLs were firing well over a hundred events and timing out at
 * five seconds whenever the machine was busy, which validate:all reliably
 * makes it. Pasting is a single event, is a real thing a person does with a
 * URL, and reaches the same onChange the component actually reads.
 */
async function fill(field: HTMLElement, value: string) {
  await userEvent.click(field);
  await userEvent.paste(value);
}

async function openPage() {
  render(<VerifyEvidencePage />);
  // The claim text is the signal that the load resolved and the form is up.
  await screen.findByText(/deployment pipeline/i);
}

describe('the check button when it will not press', () => {
  it('names both links while both are empty, rather than only going grey', async () => {
    await openPage();

    expect(screen.getByText(/add both links in step 2/i)).toBeTruthy();
  });

  it('names only the repository once the gist link is filled in', async () => {
    await openPage();

    await fill(
      screen.getByLabelText(/link to the gist/i),
      'https://gist.github.com/someone/0123456789abcdef0123456789abcdef',
    );

    expect(screen.getByText(/add the link to your repository/i)).toBeTruthy();
    expect(screen.queryByText(/add both links/i)).toBeNull();
  });

  it('names only the gist once the repository link is filled in', async () => {
    await openPage();

    await fill(
      screen.getByLabelText(/link to the repository/i),
      'https://github.com/someone/their-project',
    );

    expect(screen.getByText(/add the link to your gist/i)).toBeTruthy();
  });

  it('ties the reason to the button, so it is not merely nearby on screen', async () => {
    await openPage();

    const button = screen.getByRole('button', { name: /run the check/i });
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBe('check-blocked');
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/add both links/i);
  });

  it('drops the explanation and enables the button once both links are present', async () => {
    await openPage();

    await fill(
      screen.getByLabelText(/link to the gist/i),
      'https://gist.github.com/someone/0123456789abcdef0123456789abcdef',
    );
    await fill(
      screen.getByLabelText(/link to the repository/i),
      'https://github.com/someone/their-project',
    );

    const button = screen.getByRole('button', { name: /run the check/i });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/turns on/i)).toBeNull();
  });

  /**
   * The code is a separate signal from the two links and must not disable the
   * button. A code issued on an earlier visit is still valid and this page
   * cannot see it, so refusing to run the check would send somebody who is
   * already finished back to reissue one, invalidating the gist they have
   * already published.
   */
  it('warns about the code without blocking the check', async () => {
    await openPage();

    await fill(
      screen.getByLabelText(/link to the gist/i),
      'https://gist.github.com/someone/0123456789abcdef0123456789abcdef',
    );
    await fill(
      screen.getByLabelText(/link to the repository/i),
      'https://github.com/someone/their-project',
    );

    expect(screen.getByText(/if you have not got a code yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /run the check/i })).not.toBeDisabled();
  });
});

/**
 * A claim with no outside source to check against.
 *
 * `VERIFICATION_METHOD_FOR_SOURCE` maps project, writeup and other to null:
 * work described in your own words has nothing to confirm it with, and the
 * page says so. It then went on to render the GitHub flow underneath that
 * sentence, because the branch choosing between the two checks was written
 * when there were only two and kept its shape when null was added. The page
 * contradicted itself in consecutive cards.
 */
describe('a claim there is no check for', () => {
  beforeEach(() => {
    getEvidence.mockResolvedValue({
      evidence: {
        id: 'ev_2',
        claim: 'I rebuilt our on-call rota and halved pages per week.',
        source: 'project',
        verificationState: 'unverified',
      },
      peerAttestations: [],
    });
  });

  it('says there is nothing to check it against', async () => {
    render(<VerifyEvidencePage />);
    expect(await screen.findByText(/nothing outside you to check this against/i)).toBeTruthy();
  });

  it('does not then offer the GitHub flow underneath that', async () => {
    render(<VerifyEvidencePage />);
    await screen.findByText(/nothing outside you to check this against/i);

    expect(screen.queryByText(/prove the account is yours/i)).toBeNull();
    expect(screen.queryByText(/point us at the work/i)).toBeNull();
    expect(screen.queryByLabelText(/link to the repository/i)).toBeNull();
  });

  /**
   * A control that can never become pressable is not a disabled state. It is
   * a promise the page cannot keep.
   */
  it('shows no permanently dead check button', async () => {
    render(<VerifyEvidencePage />);
    await screen.findByText(/nothing outside you to check this against/i);

    expect(screen.queryByRole('button', { name: /run the check/i })).toBeNull();
  });

  /**
   * This branch used to point the reader at asking a colleague, which was
   * removed on 2026-09-09. What matters now is that it does not point at a
   * route that is gone: a page offering a control that no longer exists is
   * worse than one that plainly says there is nothing to check.
   */
  it('offers no confirmation route, because there no longer is one', async () => {
    render(<VerifyEvidencePage />);
    await screen.findByText(/nothing outside you to check this against/i);

    expect(screen.queryByRole('button', { name: /send the request/i })).toBeNull();
    expect(screen.queryByText(/ask someone to confirm/i)).toBeNull();
  });
});
