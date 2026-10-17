import type { Metadata } from 'next';
import { FOUNDING_SLOTS_TOTAL } from '@zoryvex/contracts';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/layout/Section';
import { formatNGN, KIT_PRICE_NGN } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Zoryvex — Proof-based hiring for cloud roles',
};

const KIT_STEPS = [
  {
    title: '1. Tell us the role',
    body: 'Pick one launch track (cloud engineering, DevOps/platform, cloud-security, or MLOps) and describe the outcome you need, seniority, and must-have work.',
  },
  {
    title: '2. See the free proof-gap preview',
    body: 'Get a preview of what a strong candidate for this role would need to show, before paying anything.',
  },
  {
    title: '3. Get the full Kit',
    body: `For a one-time ${formatNGN(KIT_PRICE_NGN)} you get a way to check every claim on your shortlist and score what you find: role success profile, evidence checklist, claim-verification matrix, practical assessment rubric, structured interview guide, and decision scorecard, ready to use with your own candidates.`,
  },
];

export default function HomePage() {
  return (
    <>
      <Section className="max-w-5xl pb-6 pt-16 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-ink-950 sm:text-5xl">
          Proof you can check yourself, not a profile you have to believe
        </h1>
        {/*
          This paragraph used to say every candidate had "a credential checked
          with the organization that issued it", and that every check "links
          back to the issuer's own record".

          That was only ever true of one of the methods. `issuer_badge` is
          checked with the issuer; `repo_ownership` is not, and a candidate
          verified solely by a repository made the sentence false.

          The paragraph below is the promise that holds for both, and it keeps
          the part that matters: the employer sees the check rather than a
          score. Matching drops any candidate with no verified evidence at all
          (see matching-service), so "every candidate you see" is exact.

          This comment used to argue from graded tasks as a third method and
          called them the fastest-growing of the three. They were retired on
          2026-09-06 (ADR 0005) because a published brief marked against a
          published rubric is solvable from the brief by a language model. A
          comment that still reasons from a retired mechanism is a trap for
          whoever edits this copy next.
        */}
        {/*
          Three units rather than one, and not a word of it rewritten.

          This was a single centred paragraph carrying four separate facts:
          what has been checked, which two methods do the checking, what an
          employer is shown for each, and who pays. On a phone that renders as
          about ten centred lines, which is where a reader gives up. Centred
          text costs more the longer it runs, because every line starts in a
          different place and the eye has to find it again.

          The claims are load-bearing and were argued over in the comment
          above, so they are re-broken and not re-written. The commercial line
          is a step smaller because it is the least urgent thing here: it
          matters once somebody has decided the first two paragraphs are
          interesting, and not before.
        */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-700">
          Every candidate you see has passed at least one independent check, across cloud
          engineering, DevOps/platform, cloud-security and MLOps roles: a certification confirmed
          with the body that issued it, or proven control of a public repository with commits
          credited to them.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-700">
          For each one you see what was checked, when, and what it does not establish.
        </p>
        <p className="mx-auto mt-5 max-w-xl text-base text-ink-700">
          Candidates build a proof profile free. Employers start with a fixed-price hiring kit, no
          subscription needed.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <ButtonLink href="/for-employers" size="lg">
            Start with the free role diagnostic
          </ButtonLink>
          <ButtonLink href="/for-talent" variant="secondary" size="lg">
            Build your proof profile
          </ButtonLink>
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">How the Proof Hiring Kit works</h2>
        <p className="mt-2 text-ink-700">
          Works with zero marketplace candidates. You bring the role and your own applicants; the
          Kit gives you a structured way to evaluate them.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {KIT_STEPS.map((step) => (
            <Card key={step.title}>
              <h3 className="font-semibold text-ink-950">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-700">{step.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Built for two audiences</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-ink-950">For candidates</h3>
            <p className="mt-2 text-sm text-ink-700">
              Free, always. File claims about your real work in four lines: claim, context, actions,
              outcome. Then get them checked. A claim is something you say; a proof is one we
              confirmed with a source you do not control, and only proofs reach an employer.
              Everything is private by default.
            </p>
            <Link
              prefetch={false}
              href="/for-talent"
              className="mt-4 inline-block text-sm font-medium text-accent-700"
            >
              See how it works for talent →
            </Link>
          </Card>
          <Card>
            <h3 className="font-semibold text-ink-950">For employers</h3>
            <p className="mt-2 text-sm text-ink-700">
              Start with a free diagnostic. Buy the one-time Kit when you have a specific role to
              fill. Only consider the candidate marketplace once it has real, current, opted-in
              matches for your track.
            </p>
            <Link
              prefetch={false}
              href="/for-employers"
              className="mt-4 inline-block text-sm font-medium text-accent-700"
            >
              See how it works for employers →
            </Link>
          </Card>
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Transparent pricing</h2>
        <p className="mt-2 text-ink-700">
          One free product, one fixed one-time price, and founding-tier subscriptions that only
          activate once there is enough real supply to make them worth paying for.
        </p>
        <Link
          prefetch={false}
          href="/pricing"
          className="mt-4 inline-block text-sm font-medium text-accent-700"
        >
          See full pricing →
        </Link>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Trust controls</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-700">
          <li>
            Everything a candidate files is private by default, and never sold or shared without
            their consent.
          </li>
          <li>
            AI may summarize or explain a proof; it never checks one, and never makes the final
            hiring decision.
          </li>
          <li>No fabricated testimonials, user counts, or guarantees anywhere on this site.</li>
        </ul>
        <Link
          prefetch={false}
          href="/trust-safety"
          className="mt-4 inline-block text-sm font-medium text-accent-700"
        >
          Read the full Trust &amp; Safety page →
        </Link>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Frequently asked questions</h2>
        <dl className="mt-6 space-y-6">
          <div>
            <dt className="font-semibold text-ink-950">
              Do I need marketplace candidates to use the Kit?
            </dt>
            <dd className="mt-1 text-ink-700">
              No. The Kit works with your own candidates from day one. No marketplace profiles
              required.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink-950">
              Is the candidate marketplace available now?
            </dt>
            <dd className="mt-1 text-ink-700">
              A marketplace subscription opens once one of your roles matches at least one real,
              current, discovery-opted candidate, and we show you that number before you pay. It can
              be a small number today, and saying so is the point: you decide whether it is worth
              it, rather than finding out afterwards. Contact details still open only on the roles
              that have matches. Both checks run on our own servers, and no plan buys past either.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink-950">Is founding pricing permanent?</dt>
            <dd className="mt-1 text-ink-700">
              Founding-tier prices are fixed for the first {FOUNDING_SLOTS_TOTAL} organizations
              only, monthly billing only. See{' '}
              <Link prefetch={false} href="/pricing">
                Pricing
              </Link>{' '}
              for exact terms.
            </dd>
          </div>
        </dl>
      </Section>
    </>
  );
}
