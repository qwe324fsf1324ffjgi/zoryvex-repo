import type { Metadata } from 'next';
import { PageHeader, Section } from '@/components/layout/Section';
import { PAYSTACK_DISCLOSURE } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Terms — Zoryvex',
  description:
    'The terms that apply to using Zoryvex, for candidates and for the organizations that pay.',
};

export default function TermsPage() {
  return (
    <Section className="max-w-3xl">
      <PageHeader title="Terms" />
      <div className="space-y-8 text-ink-700">
        <div>
          <h2 className="text-xl font-bold text-ink-950">Using Zoryvex</h2>
          <p className="mt-2">
            By using Zoryvex you agree to provide accurate information and not misuse the platform.
            That includes not submitting fabricated evidence or impersonating another person or
            organization.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">Payments</h2>
          <p className="mt-2">
            {PAYSTACK_DISCLOSURE} Prices are shown before any redirect and do not change after
            you've paid for that specific charge.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">No guarantees of outcome</h2>
          <p className="mt-2">
            Zoryvex provides tools and structured evidence to support a hiring decision. It does not
            guarantee a hire, a candidate's performance, or any specific business outcome.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink-950">Changes</h2>
          <p className="mt-2">
            These terms may be updated as the product changes. Material changes affecting active
            paid subscriptions will be communicated before they take effect.
          </p>
        </div>
      </div>
    </Section>
  );
}
