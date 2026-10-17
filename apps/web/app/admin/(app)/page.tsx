'use client';

import { useCallback, useEffect, useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Job } from '@zoryvex/local-adapters';
import type { AuditEvent, Employer, Entitlement } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';
import { ModerationPanel } from '@/components/admin/ModerationPanel';
import { StatusState } from '@/components/ui/StatusState';
import { formatNGN, FOUNDING_TIERS } from '@/lib/pricing';
import { isRealApiConfigured } from '@/lib/real-api';

const PLAN_PRICE_NGN: Record<string, number> = Object.fromEntries(
  FOUNDING_TIERS.map((tier) => [tier.plan, tier.priceNGN]),
);

interface EmployerRow {
  employer: Employer;
  entitlement: Entitlement | null;
}

/**
 * No real backend aggregate-stats endpoint exists (only the audit-event
 * exception queue, GET /admin/exceptions — DynamoDB has no cheap native
 * count/sum, and building one is real, separate work, not a quick wire-up
 * like the employer pages this same audit pass fixed). Rather than show
 * fake candidate/revenue/MRR numbers to the founder on a real deployment —
 * genuinely risky, since they'd be the one person actually trusting this
 * page for real decisions — real mode points to the one page that IS real.
 */
function RealAdminNotice() {
  return (
    <StatusState
      kind="empty"
      title="Live metrics aren't built yet"
      body="Counts, revenue and MRR need an aggregate-stats endpoint that does not exist yet, so this overview shows nothing rather than demo numbers that would read as real ones. The exception queue and the billing diagnostic are real, and are their own pages."
      action={
        <a href="/admin/exceptions" className="text-sm font-medium underline">
          Go to the real exception queue
        </a>
      }
    />
  );
}

export default function AdminDashboardPage() {
  const useReal = isRealApiConfigured();
  const [counts, setCounts] = useState({ candidates: 0, employers: 0, roles: 0, matches: 0 });
  const [kitRevenueNGN, setKitRevenueNGN] = useState(0);
  const [subscriptionMRRNGN, setSubscriptionMRRNGN] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [employerRows, setEmployerRows] = useState<EmployerRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const refresh = useCallback(() => {
    if (useReal) return;
    const { data, queue } = getLocalAdapters();
    const candidates = data.listAllCandidates();
    const employers = data.listAllEmployers();
    const roles = employers.flatMap((e) => data.listRolesByEmployer(e.id));
    const matches = roles.flatMap((r) => data.listMatchesForRole(r.id));
    setCounts({
      candidates: candidates.length,
      employers: employers.length,
      roles: roles.length,
      matches: matches.length,
    });

    const kitOrders = employers.flatMap((e) => data.listKitOrdersForEmployer(e.id));
    setKitRevenueNGN(
      kitOrders.filter((o) => o.status === 'succeeded').reduce((sum, o) => sum + o.amountNGN, 0),
    );

    const rows = employers.map((employer) => ({
      employer,
      entitlement: data.getEntitlement(employer.id),
    }));
    setEmployerRows(rows);
    setSubscriptionMRRNGN(
      rows.reduce((sum, row) => {
        if (row.entitlement?.status !== 'active') return sum;
        // The price this member actually holds, not the current price of
        // their plan. A founding member keeps their price for the life of the
        // subscription, so once founding prices move the two stop agreeing
        // and summing the current one overstates revenue by the difference,
        // on the one screen the founder would trust for a revenue number.
        //
        // Invisible until 2026-09-02: founding prices had never changed, so
        // held and current were always the same figure. The fallback covers
        // rows written before priceNGN was recorded, which is the only case
        // where the plan's price is the best guess available.
        return sum + (row.entitlement.priceNGN ?? PLAN_PRICE_NGN[row.entitlement.plan] ?? 0);
      }, 0),
    );

    setJobs(queue.listJobs());
    setAuditEvents(
      [...data.listAuditEvents()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }, [useReal]);

  useEffect(refresh, [refresh]);

  if (useReal) {
    return (
      <Section>
        <PageHeader
          title="Founder/admin console"
          intro="Read-only platform views, plus narrow moderation actions. Every action here is logged."
        />
        <RealAdminNotice />
      </Section>
    );
  }

  const jobCounts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Section>
      <PageHeader
        title="Founder/admin console"
        intro="Read-only platform views, plus narrow moderation actions. Every action here is logged."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-ink-700">Candidates</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{counts.candidates}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-700">Employers</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{counts.employers}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-700">Roles</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{counts.roles}</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-700">Matches</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{counts.matches}</p>
        </Card>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-ink-950">Kit revenue collected</h2>
          <p className="mt-1 text-2xl font-bold text-ink-950">{formatNGN(kitRevenueNGN)}</p>
          <p className="mt-1 text-sm text-ink-700">Sum of succeeded Kit checkouts, all-time.</p>
        </Card>
        <Card>
          <h2 className="font-semibold text-ink-950">Subscription MRR</h2>
          <p className="mt-1 text-2xl font-bold text-ink-950">{formatNGN(subscriptionMRRNGN)}</p>
          <p className="mt-1 text-sm text-ink-700">Sum of currently-active founding-tier plans.</p>
        </Card>
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-xl font-bold text-ink-950">File-processing queue</h2>
        <Card>
          {jobs.length === 0 ? (
            <p className="text-sm text-ink-700">No jobs.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(jobCounts).map(([status, count]) => (
                <Badge key={status} tone={status === 'failed' ? 'error' : 'neutral'}>
                  {status}: {count}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-xl font-bold text-ink-950">Subscriptions</h2>
        {employerRows.length === 0 ? (
          <p className="text-sm text-ink-700">No employers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {employerRows.map(({ employer, entitlement }) => (
              <li key={employer.id}>
                <Card className="flex items-center justify-between gap-4">
                  <span className="min-w-0 break-words text-sm text-ink-700">
                    {employer.organizationName}
                  </span>
                  <Badge tone={entitlement?.status === 'active' ? 'accent' : 'neutral'}>
                    {entitlement?.plan ?? 'none'} · {entitlement?.status ?? 'none'}
                  </Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-xl font-bold text-ink-950">Moderation</h2>
        <ModerationPanel onActionTaken={refresh} />
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-xl font-bold text-ink-950">Audit log</h2>
        <p className="mb-3 text-sm text-ink-700">
          Every moderation action and account deletion, most recent first.
        </p>
        {auditEvents.length === 0 ? (
          <p className="text-sm text-ink-700">No audit events yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {auditEvents.map((event) => (
              <li key={event.id}>
                <Card>
                  <p className="text-sm font-medium text-ink-950">
                    {event.action} · {event.targetType} {event.targetId.slice(0, 10)}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">
                    by {event.actorRole} on {new Date(event.createdAt).toLocaleString()}
                  </p>
                  {event.reason && (
                    <p className="mt-1 text-sm text-ink-700">Reason: {event.reason}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
