import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BillingOverview, SubscriptionStatus } from '@zoryvex/contracts';

/**
 * Two founder reports, which turned out to be one line of code.
 *
 * "Make sure they can see all plans even when subscribe to one", and "make
 * sure when subscription is cancelled they can still resubscribe to any
 * plan".
 *
 * The plans section rendered only when `!hasSubscription || status ===
 * 'cancelled'`. So an employer mid-month saw no plans at all, and an
 * employer who had just cancelled saw none either, because cancelling moves
 * a subscription to `non-renewing` and leaves access running to the end of
 * the period already paid for. `non-renewing` is not `cancelled`, so the
 * section stayed hidden for the rest of the month.
 *
 * That second one is the worse of the two, because the cancel dialog says in
 * as many words "You can subscribe again later". The page had removed the
 * way to do it.
 *
 * These tests pin the rule that replaced it, and the rule is the one the
 * server already enforces rather than a wider guess: subscription-service
 * refuses a second subscription at `active` and `attention`, and accepts one
 * at every other status.
 */

const getBilling = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/real-api', () => ({
  realBilling: {
    getBilling: (...args: unknown[]) => getBilling(...args),
    startSubscription: vi.fn(),
    cancel: vi.fn(),
    getCardUpdateLink: vi.fn(),
  },
}));

const { RealBillingPage } = await import('../../src/components/billing/RealBillingPage');
// The real provider rather than a stub: the page calls useToast during
// render, and a stubbed context would stop these tests noticing if that
// dependency changed shape.
const { ToastProvider } = await import('../../src/components/ui/Toast');

function overview(patch: Partial<BillingOverview> = {}): BillingOverview {
  return {
    plan: 'scout',
    interval: 'monthly',
    priceNGN: 800_000,
    foundingMember: true,
    subscriptionStatus: 'active',
    access: 'active',
    contactUnlockAllowance: 5,
    contactUnlocksUsedThisPeriod: 0,
    nextPaymentDate: '2026-10-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    graceEndsAt: null,
    lastFailureReason: null,
    card: null,
    cancelRequestedAt: null,
    ...patch,
  };
}

/** Every tier open for sale, so visibility is the only thing under test. */
const QUOTES = [
  {
    plan: 'scout' as const,
    amountNGN: 800_000,
    priceTier: 'founding' as const,
    foundingPlacesLeft: 3,
    marketplaceCandidates: 6,
    available: true,
  },
  {
    plan: 'team' as const,
    amountNGN: 1_400_000,
    priceTier: 'founding' as const,
    foundingPlacesLeft: 3,
    marketplaceCandidates: 6,
    available: true,
  },
  {
    plan: 'partner' as const,
    amountNGN: 2_400_000,
    priceTier: 'founding' as const,
    foundingPlacesLeft: 3,
    marketplaceCandidates: 6,
    available: true,
  },
];

async function renderBilling(patch: Partial<BillingOverview> = {}) {
  getBilling.mockResolvedValue({ overview: overview(patch), history: [], quotes: QUOTES });
  render(
    <ToastProvider>
      <RealBillingPage />
    </ToastProvider>,
  );
  // The page loads its snapshot in an effect, so wait for the real content.
  await screen.findByRole('heading', { name: /current plan/i });
}

beforeEach(() => {
  getBilling.mockReset();
});

/** The three tier names as the page renders them. */
function expectAllThreeTiersVisible() {
  expect(screen.getByRole('heading', { name: /^scout$/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^team$/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^partner$/i })).toBeInTheDocument();
}

describe('every plan is visible, whatever the subscription is doing', () => {
  it('shows all three while a subscription is running', async () => {
    await renderBilling({ subscriptionStatus: 'active', access: 'active', plan: 'scout' });
    expectAllThreeTiersVisible();
  });

  it('shows all three with no subscription at all', async () => {
    await renderBilling({
      subscriptionStatus: null,
      access: 'none',
      plan: null,
      priceNGN: null,
      nextPaymentDate: null,
      currentPeriodEnd: null,
    });
    expectAllThreeTiersVisible();
  });

  // The regression the founder actually hit.
  it.each<SubscriptionStatus>(['non-renewing', 'cancelled', 'completed'])(
    'shows all three at status %s',
    async (subscriptionStatus) => {
      await renderBilling({ subscriptionStatus, access: 'active', plan: 'scout' });
      expectAllThreeTiersVisible();
    },
  );
});

describe('after cancelling, every plan can actually be started again', () => {
  it('offers a working button for each plan, including the one just cancelled', async () => {
    await renderBilling({
      subscriptionStatus: 'non-renewing',
      access: 'active',
      plan: 'scout',
    });

    // The cancelled plan offers a restart rather than pretending it is still
    // current, and the other two are plain subscribes.
    expect(screen.getByRole('button', { name: /start scout again/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /subscribe to team/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /subscribe to partner/i })).toBeEnabled();
  });

  it('says access continues rather than leaving the word cancelled as the last thing read', async () => {
    await renderBilling({
      subscriptionStatus: 'non-renewing',
      access: 'active',
      plan: 'scout',
    });
    expect(screen.getByText(/you can start any plan below right now/i)).toBeInTheDocument();
  });

  /**
   * The part that costs money if it goes unsaid. Paystack charges the new
   * plan at checkout and gives nothing back for the days left on the old
   * one, so an employer who restarts a week after cancelling pays for that
   * week twice. Telling them is the difference between a choice and a
   * surprise on a card statement.
   */
  it('says plainly that starting early is charged now and overlaps what they paid for', async () => {
    await renderBilling({
      subscriptionStatus: 'non-renewing',
      access: 'active',
      plan: 'scout',
    });

    expect(screen.getByText(/charged straight away/i)).toBeInTheDocument();
    expect(screen.getByText(/rather than being added on/i)).toBeInTheDocument();
  });
});

describe('while a subscription is live, the page explains rather than dead-ends', () => {
  it('marks the current plan and does not offer to buy it twice', async () => {
    await renderBilling({ subscriptionStatus: 'active', access: 'active', plan: 'scout' });

    expect(screen.queryByRole('button', { name: /subscribe to scout/i })).toBeNull();
    expect(screen.getByText(/this is the plan you are on/i)).toBeInTheDocument();
  });

  it('tells the employer how to move to a different plan instead of offering a button that fails', async () => {
    await renderBilling({ subscriptionStatus: 'active', access: 'active', plan: 'scout' });

    // The server returns 409 for a second subscription while one is active,
    // so a Subscribe button here would be a lie. The page offers the step
    // that leads somewhere.
    expect(screen.queryByRole('button', { name: /subscribe to team/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: /cancel to switch/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/moving to a different plan/i)).toBeInTheDocument();
  });

  it('warns a founding member that switching gives up the founding price', async () => {
    await renderBilling({
      subscriptionStatus: 'active',
      access: 'active',
      plan: 'scout',
      foundingMember: true,
    });
    expect(screen.getByText(/cancelling gives it up/i)).toBeInTheDocument();
  });
});
