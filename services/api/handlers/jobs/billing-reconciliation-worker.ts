import { billingLog } from '../../src/lib/billing-log';
import { getFeatureFlags } from '../../src/repositories/feature-flags-repository';
import { reconcileBilling } from '../../src/domain/billing-reconciliation-service';
import { createAwsReconciliationDependencies } from '../../src/composition/aws-billing-dependencies';

const deps = createAwsReconciliationDependencies();

/**
 * The scheduled half of the billing system.
 *
 * Paystack webhooks only fire for successful transactions, so an abandoned
 * checkout, a declined card, and a `charge.success` whose delivery failed
 * all look identical from a webhook-only integration: nothing arrives. This
 * job is what closes them, by asking Paystack directly about every payment
 * this system started and never heard the end of, and by looking the other
 * way for successful payments Paystack has that this system does not.
 *
 * Gated on the same `payments` flag as the checkout, so the emergency
 * lockdown script stops the whole billing surface with one parameter rather
 * than most of it. There is nothing to reconcile while nothing can be
 * charged.
 *
 * The work is bounded by the sparse open-payments index, which holds only
 * unsettled attempts and empties itself as they settle — so a quiet day
 * costs one query that returns nothing.
 */
export const handler = async (): Promise<{
  checked: number;
  settled: number;
  granted: number;
  abandoned: number;
  unreachable: number;
  discrepancies: number;
  skipped: boolean;
}> => {
  const flags = await getFeatureFlags();
  if (!flags.payments) {
    // Said out loud, because the silent version is genuinely confusing. The
    // first scheduled run in TEST on 2026-09-01 completed in 477ms and wrote
    // nothing at all, which looks exactly like a healthy run over an empty
    // queue. Distinguishing "switched off" from "nothing to do" meant reading
    // this file. An emergency lockdown turns this flag off deliberately, so
    // the quiet case is one somebody will be looking at under pressure.
    billingLog.info('billing reconciliation skipped', { reason: 'payments flag is off' });
    return {
      checked: 0,
      settled: 0,
      granted: 0,
      abandoned: 0,
      unreachable: 0,
      discrepancies: 0,
      skipped: true,
    };
  }

  const report = await reconcileBilling(deps);

  // Counts only. The discrepancy text names references and amounts, which
  // belong in the founder's alert and the audit trail, not in a log line
  // that CloudWatch keeps and anybody with log access can read.
  return {
    checked: report.checked,
    settled: report.settled,
    granted: report.granted,
    abandoned: report.abandoned,
    unreachable: report.unreachable,
    discrepancies: report.discrepancies.length,
    skipped: false,
  };
};
