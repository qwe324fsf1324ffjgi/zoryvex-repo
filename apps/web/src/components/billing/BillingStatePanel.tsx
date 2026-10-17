import type { AccessState, BillingOverview } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * The one part of the billing page that answers "what is going on, and what
 * do I do about it".
 *
 * Every branch here exists because Paystack behaves in a way an employer
 * would not guess. A cancelled subscription keeps working until the period
 * ends. A declined renewal is not retried for a month. Neither is obvious,
 * and a page that showed a status badge and left the reader to infer the
 * rest is how a support email starts.
 *
 * So each state says three things in order: what happened, what happens
 * next without you, and what you can do now. The third is a real control
 * where one exists, and is honestly absent where none does.
 */

const ACCESS_LABEL: Record<AccessState, string> = {
  none: 'No subscription',
  active: 'Active',
  grace: 'Payment failed',
  suspended: 'Paused',
};

const ACCESS_TONE: Record<AccessState, 'neutral' | 'accent' | 'error'> = {
  none: 'neutral',
  active: 'accent',
  grace: 'error',
  suspended: 'error',
};

/** A date an employer can read, in their own locale, without a time. */
export function formatDate(iso: string | null): string {
  if (!iso) return 'an unknown date';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'an unknown date';
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function AccessBadge({ access }: { access: AccessState }) {
  return <Badge tone={ACCESS_TONE[access]}>{ACCESS_LABEL[access]}</Badge>;
}

export interface BillingStatePanelProps {
  overview: BillingOverview;
  onUpdateCard: () => void;
  updatingCard: boolean;
}

export function BillingStatePanel({
  overview,
  onUpdateCard,
  updatingCard,
}: BillingStatePanelProps) {
  if (overview.access === 'none') return null;

  if (overview.access === 'grace' || overview.access === 'suspended') {
    const paused = overview.access === 'suspended';
    return (
      <Card className="border-error-700">
        <h2 className="font-semibold text-error-700">
          {paused ? 'Your marketplace access is paused' : 'We could not take this payment'}
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          {overview.lastFailureReason
            ? `Your bank gave the reason: ${overview.lastFailureReason}.`
            : 'Your bank did not tell us why.'}{' '}
          {overview.card
            ? `The card on file is ${overview.card.brand} ending ${overview.card.last4}, expiring ${overview.card.expMonth}/${overview.card.expYear}.`
            : 'There is no card on file for this subscription.'}
        </p>
        <p className="mt-2 text-sm text-ink-700">
          {paused
            ? 'Paystack does not retry a failed charge, so nothing will change on its own. Add a working card and the next charge goes through. Your plan and your price are unchanged.'
            : `Paystack does not retry a failed charge until the next billing date, so your access stays on until ${formatDate(
                overview.graceEndsAt,
              )} to give you time to fix it.`}
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-700">
          <li>Press the button below. It opens Paystack's own page, on Paystack's domain.</li>
          <li>
            Add a card there. Paystack charges it a small amount to confirm it works, and refunds
            that immediately.
          </li>
          <li>Come back here. The new card is used from your next billing date.</li>
        </ol>
        <Button className="mt-4" onClick={onUpdateCard} disabled={updatingCard}>
          {updatingCard ? 'Opening Paystack…' : 'Update the card on Paystack'}
        </Button>
        <p className="mt-3 text-sm text-ink-700">
          We never see or store your card number. It stays with Paystack.
        </p>
      </Card>
    );
  }

  if (overview.subscriptionStatus === 'non-renewing') {
    return (
      <Card>
        <h2 className="font-semibold text-ink-950">Your subscription is set to end</h2>
        <p className="mt-2 text-sm text-ink-700">
          You cancelled on {formatDate(overview.cancelRequestedAt)}. Nothing more will be charged.
          You keep full marketplace access until {formatDate(overview.currentPeriodEnd)}, because
          that period is already paid for.
        </p>
        <p className="mt-2 text-sm text-ink-700">
          After that date the subscription closes and this page offers the plans again. A Proof
          Hiring Kit you have already bought is unaffected: a Kit is a one-time purchase, not a
          rental.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-semibold text-ink-950">What happens next</h2>
      <p className="mt-2 text-sm text-ink-700">
        Paystack charges the card on file on {formatDate(overview.nextPaymentDate)} and every{' '}
        {overview.interval === 'annually' ? 'year' : 'month'} after that, until you cancel. Paystack
        sends you a receipt each time.
      </p>
      {overview.card && (
        <p className="mt-2 text-sm text-ink-700">
          The card on file is {overview.card.brand} ending {overview.card.last4}, expiring{' '}
          {overview.card.expMonth}/{overview.card.expYear}. If it expires before then, replace it
          here first.
        </p>
      )}
      <Button variant="secondary" className="mt-3" onClick={onUpdateCard} disabled={updatingCard}>
        {updatingCard ? 'Opening Paystack…' : 'Change the card'}
      </Button>
    </Card>
  );
}
