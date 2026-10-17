import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The two consent checkboxes on the candidate profile are network-backed in
 * real mode: each one calls `updateConsent` and then re-reads the profile.
 * Neither is a local state flip.
 *
 * Found in the 2026-09-10 interactive-element audit. `checked` is bound to
 * the fetched profile, so it cannot move until the round trip finishes, and
 * nothing disabled the control or showed that anything was happening. From
 * the candidate's side that is a checkbox that does not respond when
 * clicked — the exact "looks clickable, does nothing" symptom — and a second
 * click during the gap sends a second request computed from the stale value.
 *
 * These tests hold the in-flight contract: while the request is running the
 * control is disabled, and it comes back enabled whether the call succeeds or
 * fails.
 */

const updateConsent = vi.fn();
const getProfile = vi.fn();
const listEvidence = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/use-session', () => ({
  useSession: () => ({ candidateId: 'cand_1', role: 'candidate', accountId: 'acct_1' }),
}));

vi.mock('@/lib/real-api', () => ({
  isRealApiConfigured: () => true,
  messageFor: (_e: unknown, fallback: string) => fallback,
  realCandidateProfile: {
    getProfile: (...a: unknown[]) => getProfile(...a),
    updateProfile: vi.fn(),
  },
  realEvidenceClaims: {
    listEvidence: (...a: unknown[]) => listEvidence(...a),
    deleteEvidence: vi.fn(),
  },
  realPrivacy: {
    updateConsent: (...a: unknown[]) => updateConsent(...a),
    requestDeletion: vi.fn(),
    exportData: vi.fn(),
  },
  realPublicProof: { getBadgeUrl: vi.fn() },
}));

const { ToastProvider } = await import('../../src/components/ui/Toast');
const { default: ProfilePage } = await import('../../app/candidate/(app)/profile/page');

const CANDIDATE = {
  id: 'cand_1',
  email: 'candidate@example.com',
  displayName: 'Test Candidate',
  launchTrack: 'aws_cloud',
  summary: 'A summary.',
  onboardingComplete: true,
  discoveryOptIn: false,
  contactUnlockConsent: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A promise this test decides when to settle, so "in flight" is observable. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  updateConsent.mockReset();
  getProfile.mockReset().mockResolvedValue({ candidate: CANDIDATE, version: 1 });
  listEvidence.mockReset().mockResolvedValue([]);
});

async function renderProfile() {
  render(
    <ToastProvider>
      <ProfilePage />
    </ToastProvider>,
  );
  return screen.findByRole('checkbox', { name: /discoverable to employers|employer discovery/i });
}

describe('the discovery consent toggle while its request is in flight', () => {
  it('disables itself so a second click cannot send a request built on the stale value', async () => {
    const gate = deferred<void>();
    updateConsent.mockReturnValue(gate.promise);

    const toggle = await renderProfile();
    await userEvent.click(toggle);

    await waitFor(() => expect(updateConsent).toHaveBeenCalledTimes(1));
    expect(toggle).toBeDisabled();

    // A determined second click must not produce a second request.
    await userEvent.click(toggle).catch(() => {});
    expect(updateConsent).toHaveBeenCalledTimes(1);

    gate.resolve();
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it('comes back enabled after a failure, so the candidate can retry', async () => {
    const gate = deferred<void>();
    updateConsent.mockReturnValue(gate.promise);

    const toggle = await renderProfile();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());

    gate.reject(new Error('network'));
    await waitFor(() => expect(toggle).toBeEnabled());
  });
});
