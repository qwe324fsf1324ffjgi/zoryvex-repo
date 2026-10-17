import type { PaymentHistoryEntry, PaymentStatus } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from './BillingStatePanel';

/**
 * What actually happened to each attempt to take money, in words rather
 * than in Paystack's vocabulary.
 *
 * The statuses are Paystack's, and most of them mean nothing to a person
 * reading a bill. `abandoned` in particular reads like an accusation and
 * actually means "you did not finish"; `ongoing` means a bank is still
 * thinking. Each one gets a sentence, because a row that says only
 * "abandoned" is the reason somebody emails to ask whether they were
 * charged.
 */

const STATUS_LABEL: Record<PaymentStatus, string> = {
  initialized: 'Started',
  pending: 'In progress',
  ongoing: 'Waiting on your bank',
  processing: 'In progress',
  queued: 'Queued',
  success: 'Paid',
  failed: 'Declined',
  abandoned: 'Not completed',
  reversed: 'Refunded',
};

const STATUS_MEANING: Record<PaymentStatus, string> = {
  initialized: 'A checkout was opened. Nothing has been charged.',
  pending: 'Your bank has not given a final answer yet.',
  ongoing: 'Waiting for you or your bank to finish authorising it.',
  processing: 'Your bank has not given a final answer yet.',
  queued: 'Queued at Paystack, not yet attempted.',
  success: 'Paid in full and confirmed with Paystack directly.',
  failed: 'Your bank declined it. Nothing was charged.',
  abandoned: 'The checkout was not completed. Nothing was charged.',
  reversed: 'This payment was refunded or charged back.',
};

const STATUS_TONE: Record<PaymentStatus, 'neutral' | 'accent' | 'error'> = {
  initialized: 'neutral',
  pending: 'neutral',
  ongoing: 'neutral',
  processing: 'neutral',
  queued: 'neutral',
  success: 'accent',
  failed: 'error',
  abandoned: 'neutral',
  reversed: 'error',
};

const PURPOSE_LABEL: Record<PaymentHistoryEntry['purpose'], string> = {
  kit: 'Proof Hiring Kit',
  subscription: 'Marketplace subscription',
};

function formatNGN(amount: number): string {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}

export function PaymentHistory({ history }: { history: PaymentHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-ink-700">
        No payments yet. Anything you are charged appears here, including attempts that did not go
        through.
      </p>
    );
  }

  return (
    // Its own scroll container, so a narrow screen scrolls the table and
    // never the whole page sideways.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Every payment attempt on this organisation, newest first
        </caption>
        <thead>
          <tr className="border-b border-ink-200 text-xs font-semibold uppercase tracking-wide text-ink-700">
            <th scope="col" className="py-2 pr-4">
              Date
            </th>
            <th scope="col" className="py-2 pr-4">
              For
            </th>
            <th scope="col" className="py-2 pr-4 text-right tabular-nums">
              Amount
            </th>
            <th scope="col" className="py-2">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id} className="border-b border-ink-200 align-top">
              <td className="py-3 pr-4 text-ink-700">{formatDate(entry.createdAt)}</td>
              <td className="py-3 pr-4 text-ink-700">{PURPOSE_LABEL[entry.purpose]}</td>
              <td className="py-3 pr-4 text-right tabular-nums text-ink-950">
                {formatNGN(entry.amountNGN)}
              </td>
              <td className="py-3">
                <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
                <p className="mt-1 text-xs text-ink-700">{STATUS_MEANING[entry.status]}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
