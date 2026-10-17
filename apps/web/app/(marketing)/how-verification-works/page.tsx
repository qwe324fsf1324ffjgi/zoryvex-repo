import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';

export const metadata: Metadata = {
  title: 'How Verification Works — Zoryvex',
  description:
    'Every piece of evidence carries an explicit verification state. Self-attested work is never presented as independently verified.',
};

const STATES = [
  {
    label: 'Unverified',
    tone: 'neutral' as const,
    body: 'The candidate has added this evidence; nothing about it has been independently checked yet.',
  },
  {
    label: 'Self-attested',
    tone: 'neutral' as const,
    body: 'The candidate has confirmed the claim, context, actions, and outcome are accurate to the best of their knowledge.',
  },
  {
    label: 'Verified',
    tone: 'accent' as const,
    body: 'An independent check has confirmed the evidence. This state is only shown when that check has actually happened, never by default, and it stops applying if the credential behind it lapses.',
  },
];

export default function HowVerificationWorksPage() {
  return (
    <>
      <Section>
        <PageHeader
          title="What 'proof' means on Zoryvex"
          intro="Every piece of candidate evidence carries an explicit verification state. We never present self-attested work as independently verified."
        />
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">The structure behind every claim</h2>
        <p className="mt-2 text-ink-700">
          Instead of a free-text résumé line, each piece of evidence is broken into: what was
          claimed, the context it happened in, the specific actions taken, and the measurable
          outcome. This structure is what makes an evidence-checklist and claim-verification matrix
          possible in the Proof Hiring Kit.
        </p>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Verification states</h2>
        <div className="mt-6 space-y-4">
          {STATES.map((state) => (
            <Card key={state.label} className="flex items-start gap-4">
              <Badge tone={state.tone}>{state.label}</Badge>
              <p className="text-sm text-ink-700">{state.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/*
        Documents `isVerified` in matching-service.ts exactly, and nothing
        beyond it. This page defines what "proof" means here and did not
        mention that a verification can lapse, which is the one thing that
        makes the word mean something different from how most platforms use
        it. It is also the honest thing for both sides to know: a candidate
        whose badge expires needs to re-verify, and an employer should not
        assume a check they saw last month still holds.
      */}
      <Section>
        <h2 className="text-2xl font-bold text-ink-950">
          Verified describes a moment, not a status
        </h2>
        <p className="mt-2 text-ink-700">
          A certification expires. A check made in 2026 against a credential that lapses in 2027
          stops counting as proof in 2027, by itself, with nobody having to remember to re-run
          anything. It is checked every time an employer looks, not at the point the check was made.
        </p>
        <p className="mt-2 text-ink-700">
          Evidence whose expiry date we cannot read is treated as not verified rather than assumed
          good. Evidence with no expiry at all is something that does not lapse, like a repository
          you own, which is a different thing from an expiry we simply do not know.
        </p>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Where AI fits in</h2>
        <p className="mt-2 text-ink-700">
          AI may be used to summarize or explain a candidate's evidence for an employer. It never
          makes the final hiring decision, never infers protected characteristics, never scores
          faces, and never silently filters a candidate out without a stated, reviewable reason. See{' '}
          <Link prefetch={false} href="/trust-safety" className="text-accent-700 underline">
            Trust &amp; Safety
          </Link>{' '}
          for the full policy.
        </p>
      </Section>
    </>
  );
}
