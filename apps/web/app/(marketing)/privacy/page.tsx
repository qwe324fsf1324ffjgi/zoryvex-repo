import type { Metadata } from 'next';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'Privacy — Zoryvex',
  description:
    'What Zoryvex collects, why, how long it is kept, and how to export or delete everything held about you.',
};

export default function PrivacyPage() {
  return (
    <Section className="max-w-3xl">
      <PageHeader title="Privacy" />
      <div className="space-y-8 text-ink-700">
        <div>
          <h2 className="text-xl font-bold text-ink-950">What we collect</h2>
          <p className="mt-2">
            Candidates: profile details, evidence you choose to add, and your discovery opt-in
            state. Employers: organization details, saved roles, and payment/entitlement state.
            Never raw card data, which Paystack holds directly.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">Who can see your evidence</h2>
          <p className="mt-2">
            Private by default. It becomes visible to a specific employer only if you applied to
            their role or opted into discovery for a track that role matched. Opting out removes you
            from discovery immediately, not on a delayed schedule.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">Export and deletion</h2>
          <p className="mt-2">
            You can request your own data as an export at any time. Deletion removes your profile,
            your evidence, and every discovery-index entry tied to you. Not just a hidden flag.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">What we never log</h2>
          <p className="mt-2">
            Tokens, email bodies, contact details, file contents, payment payloads, and candidate
            evidence are never written to operational logs.
          </p>
        </div>
      </div>
    </Section>
  );
}
