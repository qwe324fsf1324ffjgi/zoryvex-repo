import type { Metadata } from 'next';
import { Badge } from '@/components/ui/Badge';
import { PageHeader, Section } from '@/components/layout/Section';
import { isRealApiConfigured } from '@/lib/real-api';

export const metadata: Metadata = {
  title: 'Status — Zoryvex',
  description: 'Current state of the Zoryvex service and what is live in this environment.',
};

export default function StatusPage() {
  return (
    <Section className="max-w-3xl">
      <PageHeader title="Status" />
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge tone="neutral">In development</Badge>
          <p className="text-ink-700">
            Zoryvex is in active development.{' '}
            {isRealApiConfigured()
              ? 'This build talks to a real, non-production test backend.'
              : 'This build runs against local, deterministic demo data.'}{' '}
            No live production system is deployed yet, and no uptime claim is made until one is.
          </p>
        </div>
        <p className="text-ink-700">
          Once a production system exists, this page will reflect its real, monitored status, not a
          static claim.
        </p>
      </div>
    </Section>
  );
}
