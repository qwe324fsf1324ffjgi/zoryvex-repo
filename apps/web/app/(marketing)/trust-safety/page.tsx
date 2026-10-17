import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Section } from '@/components/layout/Section';
import { PAYSTACK_DISCLOSURE } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Trust & Safety — Zoryvex',
  description:
    'How Zoryvex handles candidate data, what the AI is and is not allowed to do, and the limits on what we claim about the product.',
};

export default function TrustSafetyPage() {
  return (
    <>
      <Section>
        <PageHeader
          title="Trust & Safety"
          intro="How Zoryvex handles candidate data, AI, and honesty in what we say about the product."
        />
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Privacy by default</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-700">
          <li>
            Candidate evidence and profile data are private unless the candidate explicitly shares
            them.
          </li>
          <li>
            Discovery opt-in is a single choice a candidate makes and can revoke at any time.
            Revocation is immediate, and it withdraws them from every open match.
          </li>
          <li>Contact details are only unlocked with the candidate's explicit consent.</li>
          <li>
            Candidates can export or delete their own data. See{' '}
            <Link prefetch={false} href="/privacy">
              Privacy
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">AI, used narrowly</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-700">
          <li>AI may summarize or explain a proof an employer is already allowed to see.</li>
          <li>AI never makes the final hiring decision. An employer's own action does.</li>
          <li>AI never infers protected characteristics and never scores faces.</li>
          <li>No candidate is silently filtered out by AI without a stated, reviewable reason.</li>
        </ul>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">What we don't do</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-700">
          <li>No fabricated testimonials, user counts, or "used by" claims.</li>
          <li>No claims that Zoryvex is the best, fastest, safest, proven, or guaranteed.</li>
          <li>No hidden fees, forced trials, or obstructed cancellation on any paid product.</li>
          <li>No marketplace upsell shown before a role has real, opted-in matching supply.</li>
        </ul>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Payments</h2>
        <p className="mt-2 text-ink-700">
          {PAYSTACK_DISCLOSURE} See{' '}
          <Link prefetch={false} href="/pricing">
            Pricing
          </Link>{' '}
          for exact terms.
        </p>
      </Section>
    </>
  );
}
