'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader, Section } from '@/components/layout/Section';
import { messageFor } from '@/lib/real-api/error-message';
import { isRealApiConfigured, realAdminBilling, type AdminBillingDiagnostic } from '@/lib/real-api';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; diagnostic: AdminBillingDiagnostic };

function formatNGN(amount: number): string {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}

function formatMoment(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

/**
 * One organisation's complete billing timeline, for the one person who has
 * to explain a payment that did not work.
 *
 * Every other billing view in this product is written for the customer and
 * deliberately drops what would only confuse them. This one keeps all of
 * it: raw Paystack statuses, gateway responses, transaction ids, the
 * reconciliation count. The `findings` list at the top is the part that
 * matters most, because a timeline alone still assumes the reader knows
 * that Paystack does not retry a failed renewal and that an `initialized`
 * row means a checkout nobody finished.
 *
 * The subscription's cancellation token is never returned by the server, so
 * it cannot be rendered here even by accident. Its presence is reported;
 * its value is not.
 */
export default function AdminBillingPage() {
  const configured = isRealApiConfigured();
  const [employerId, setEmployerId] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'idle' });

  async function look() {
    const id = employerId.trim();
    if (!id) return;
    setState({ status: 'loading' });
    try {
      setState({ status: 'loaded', diagnostic: await realAdminBilling.getDiagnostic(id) });
    } catch (error) {
      setState({
        status: 'error',
        message: messageFor(error, 'Could not reach the API.'),
      });
    }
  }

  return (
    <Section>
      <PageHeader
        title="Billing diagnostic"
        intro="Everything the system knows about one organisation's payments, and what is wrong with it. Reads the real backend only."
      />

      {!configured ? (
        <Card>
          <p className="text-sm text-ink-700">
            No real API is configured for this build (NEXT_PUBLIC_API_BASE_URL is unset). There is
            no local equivalent of this page on purpose: a diagnostic that reports on fake payments
            would be worse than none.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <Input
                  id="employer-id"
                  label="Employer id"
                  hint="From the employer record, an audit event, or a payment reference."
                  value={employerId}
                  onChange={(event) => setEmployerId(event.target.value)}
                />
              </div>
              <Button onClick={() => void look()} disabled={state.status === 'loading'}>
                {state.status === 'loading' ? 'Looking…' : 'Look up'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-ink-700">
              This route needs a founder_admin session inside a recent WebAuthn step-up window. A
              403 here means the step-up has expired, not that the organisation is missing.
            </p>
          </Card>

          {state.status === 'error' && (
            <Card className="border-error-700">
              <p className="text-sm text-error-700">{state.message}</p>
            </Card>
          )}

          {state.status === 'loaded' && <Diagnostic diagnostic={state.diagnostic} />}
        </>
      )}
    </Section>
  );
}

function Diagnostic({ diagnostic }: { diagnostic: AdminBillingDiagnostic }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink-950">State</h2>
          <Badge tone={diagnostic.inSync ? 'accent' : 'error'}>
            {diagnostic.inSync ? 'In sync' : 'Needs attention'}
          </Badge>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-700">Access right now</dt>
            <dd className="font-medium text-ink-950">{diagnostic.access}</dd>
          </div>
          <div>
            <dt className="text-ink-700">Entitlement says</dt>
            <dd className="font-medium text-ink-950">
              {diagnostic.entitlementStatus ?? 'nothing'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-700">Subscription implies</dt>
            <dd className="font-medium text-ink-950">
              {diagnostic.expectedEntitlementStatus ?? 'nothing'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-700">Cancellation token stored</dt>
            <dd className="font-medium text-ink-950">
              {diagnostic.subscription
                ? diagnostic.subscription.hasCancellationToken
                  ? 'yes'
                  : 'no, cancelling will fail'
                : 'no subscription'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className={diagnostic.findings.length > 0 ? 'border-error-700' : undefined}>
        <h2 className="font-semibold text-ink-950">What is wrong</h2>
        {diagnostic.findings.length === 0 ? (
          <p className="mt-2 text-sm text-ink-700">
            Nothing. The entitlement matches the subscription, every payment reached an outcome, and
            the cancellation token is stored.
          </p>
        ) : (
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink-700">
            {diagnostic.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink-950">Timeline</h2>
        {diagnostic.timeline.length === 0 ? (
          <p className="mt-2 text-sm text-ink-700">Nothing has ever happened on this account.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {diagnostic.timeline.map((entry) => (
              <li key={`${entry.at}-${entry.summary}`} className="border-l-2 border-ink-200 pl-3">
                <p className="text-xs uppercase tracking-wide text-ink-700">
                  {formatMoment(entry.at)} · {entry.kind}
                </p>
                <p className="text-sm text-ink-950">{entry.summary}</p>
                {entry.detail && <p className="text-sm text-ink-700">{entry.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink-950">Payment attempts</h2>
        {diagnostic.payments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-700">None.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Every payment attempt, with the raw Paystack detail
              </caption>
              <thead>
                <tr className="border-b border-ink-200 text-xs font-semibold uppercase tracking-wide text-ink-700">
                  <th scope="col" className="py-2 pr-4">
                    Reference
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Ours
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Paystack
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right tabular-nums">
                    Amount
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Gateway said
                  </th>
                  <th scope="col" className="py-2">
                    Checks
                  </th>
                </tr>
              </thead>
              <tbody>
                {diagnostic.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-ink-200 align-top">
                    <td className="py-2 pr-4 font-mono text-xs text-ink-700">
                      {payment.reference}
                      {payment.paystackTransactionId && (
                        <span className="block text-ink-500">
                          txn {payment.paystackTransactionId}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-ink-950">{payment.status}</td>
                    <td className="py-2 pr-4 text-ink-700">
                      {payment.paystackStatus ?? 'not asked'}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-ink-950">
                      {formatNGN(payment.amountNGN)}
                    </td>
                    <td className="py-2 pr-4 text-ink-700">
                      {payment.gatewayResponse ?? 'nothing recorded'}
                    </td>
                    <td className="py-2 text-ink-700">
                      {payment.verifiedAt ? 'verified' : 'never verified'} ·{' '}
                      {payment.reconcileAttempts} reconcile
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-ink-950">Invoices</h2>
        {diagnostic.invoices.length === 0 ? (
          <p className="mt-2 text-sm text-ink-700">
            None. Paystack raises one per billing period, three days before each payment date, so an
            organisation that has never renewed has none.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {diagnostic.invoices.map((invoice) => (
              <li key={invoice.invoiceCode} className="border-b border-ink-200 pb-2">
                <p className="text-ink-950">
                  {invoice.invoiceCode} · {formatNGN(invoice.amountNGN)} ·{' '}
                  {invoice.paid ? 'paid' : 'unpaid'} · {invoice.status}
                </p>
                {invoice.description && <p className="text-ink-700">{invoice.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
