import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BillingOverview, PaymentHistoryEntry } from '@zoryvex/contracts';
import {
  AccessBadge,
  BillingStatePanel,
  formatDate,
} from '../../src/components/billing/BillingStatePanel';
import { PaymentHistory } from '../../src/components/billing/PaymentHistory';

function overview(patch: Partial<BillingOverview> = {}): BillingOverview {
  return {
    plan: 'scout',
    interval: 'monthly',
    priceNGN: 79_000,
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

/**
 * Asserts the date is on the page, however the runner's locale spells it.
 *
 * `toLocaleDateString` is deliberate in the component: an employer in Lagos
 * should read a Lagos-shaped date. That means a test hard-coding
 * "1 October 2026" passes on one machine and fails on the next, which is a
 * failure about the test runner rather than about the page. Asserting
 * through the same formatter still proves the right date is shown, which is
 * the part worth proving.
 */
function expectDateShown(iso: string): void {
  // `exact: false` because the date sits inside a sentence rather than in a
  // node of its own.
  expect(screen.getByText(formatDate(iso), { exact: false })).toBeInTheDocument();
}

function renderPanel(patch: Partial<BillingOverview> = {}, onUpdateCard = vi.fn()) {
  render(
    <BillingStatePanel
      overview={overview(patch)}
      onUpdateCard={onUpdateCard}
      updatingCard={false}
    />,
  );
  return onUpdateCard;
}

describe('formatDate', () => {
  it('says so plainly rather than printing Invalid Date', () => {
    expect(formatDate(null)).toBe('an unknown date');
    expect(formatDate('sometime next month')).toBe('an unknown date');
  });
});

describe('AccessBadge', () => {
  it.each([
    ['active', 'Active'],
    ['grace', 'Payment failed'],
    ['suspended', 'Paused'],
    ['none', 'No subscription'],
  ] as const)('labels %s access in words, not in Paystack vocabulary', (access, label) => {
    render(<AccessBadge access={access} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('BillingStatePanel', () => {
  it('renders nothing for an organisation that has never subscribed', () => {
    const { container } = render(
      <BillingStatePanel
        overview={overview({ access: 'none' })}
        onUpdateCard={vi.fn()}
        updatingCard={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('tells an active subscriber the next charge date and the cadence', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'What happens next' })).toBeInTheDocument();
    expect(screen.getByText(/every month after that, until you cancel/)).toBeInTheDocument();
  });

  /**
   * The whole reason the grace window exists is that Paystack does not
   * retry. A page that showed a failed status without saying so leaves the
   * reader waiting for a retry that is never coming.
   */
  it('says Paystack does not retry, and when access ends', () => {
    renderPanel({
      access: 'grace',
      subscriptionStatus: 'attention',
      graceEndsAt: '2026-09-08T00:00:00.000Z',
      lastFailureReason: 'Insufficient Funds',
    });

    expect(screen.getByText(/does not retry a failed charge/)).toBeInTheDocument();
    expect(screen.getByText(/Insufficient Funds/)).toBeInTheDocument();
    expectDateShown('2026-09-08T00:00:00.000Z');
  });

  it('gives numbered steps rather than a bare button', async () => {
    const onUpdateCard = renderPanel({ access: 'grace', graceEndsAt: '2026-09-08T00:00:00.000Z' });
    expect(screen.getByRole('list')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Update the card on Paystack/ }));
    expect(onUpdateCard).toHaveBeenCalledOnce();
  });

  it('promises that no card detail reaches this product', () => {
    renderPanel({ access: 'grace', graceEndsAt: '2026-09-08T00:00:00.000Z' });
    expect(screen.getByText(/never see or store your card number/)).toBeInTheDocument();
  });

  it('shows the card on file so an employer can tell which one failed', () => {
    renderPanel({
      access: 'grace',
      graceEndsAt: '2026-09-08T00:00:00.000Z',
      card: { last4: '4081', brand: 'visa', expMonth: '12', expYear: '2030', channel: 'card' },
    });
    expect(screen.getByText(/visa ending 4081/)).toBeInTheDocument();
  });

  it('tells a suspended subscriber that nothing will change on its own', () => {
    renderPanel({ access: 'suspended', graceEndsAt: '2026-08-01T00:00:00.000Z' });
    expect(screen.getByText(/nothing will change on its own/)).toBeInTheDocument();
    expect(screen.getByText(/plan and your price are unchanged/)).toBeInTheDocument();
  });

  /**
   * Paystack's disable is not an immediate termination, and an employer who
   * cancels and immediately loses access would reasonably think they had
   * been robbed of the month they paid for.
   */
  it('tells a cancelling subscriber they keep the period they paid for', () => {
    renderPanel({
      subscriptionStatus: 'non-renewing',
      cancelRequestedAt: '2026-09-02T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    });

    expect(screen.getByText(/Nothing more will be charged/)).toBeInTheDocument();
    expectDateShown('2026-10-01T00:00:00.000Z');
    expect(screen.getByText(/a one-time purchase, not a rental/)).toBeInTheDocument();
  });
});

describe('PaymentHistory', () => {
  function entry(patch: Partial<PaymentHistoryEntry> = {}): PaymentHistoryEntry {
    return {
      id: 'p1',
      purpose: 'subscription',
      amountNGN: 79_000,
      status: 'success',
      createdAt: '2026-09-01T00:00:00.000Z',
      ...patch,
    };
  }

  it('says that nothing has been charged when there is no history', () => {
    render(<PaymentHistory history={[]} />);
    expect(screen.getByText(/No payments yet/)).toBeInTheDocument();
  });

  it('gives every outcome a sentence, not just a status word', () => {
    render(
      <PaymentHistory
        history={[
          entry({ id: 'p1', status: 'success' }),
          entry({ id: 'p2', status: 'failed' }),
          entry({ id: 'p3', status: 'abandoned' }),
          entry({ id: 'p4', status: 'reversed' }),
        ]}
      />,
    );

    expect(screen.getByText(/confirmed with Paystack directly/)).toBeInTheDocument();
    // Both a decline and an unfinished checkout have to say the money did
    // not move; "abandoned" alone reads as an accusation.
    expect(screen.getByText(/declined it. Nothing was charged/)).toBeInTheDocument();
    expect(screen.getByText(/was not completed. Nothing was charged/)).toBeInTheDocument();
    expect(screen.getByText(/refunded or charged back/)).toBeInTheDocument();
  });

  it('names what each payment was for in the buyer terms', () => {
    render(<PaymentHistory history={[entry({ purpose: 'kit' })]} />);
    expect(screen.getByText('Proof Hiring Kit')).toBeInTheDocument();
  });

  it('gives the table a caption for screen readers', () => {
    render(<PaymentHistory history={[entry()]} />);
    expect(screen.getByRole('table', { name: /payment attempt/i })).toBeInTheDocument();
  });
});
