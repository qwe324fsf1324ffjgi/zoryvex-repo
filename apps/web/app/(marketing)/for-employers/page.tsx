import type { Metadata } from 'next';
import { MARKETPLACE_GATE_MIN_MATCHES } from '@zoryvex/contracts';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Section } from '@/components/layout/Section';
import {
  formatNGN,
  KIT_DELIVERABLES,
  KIT_NOT_INCLUDED,
  KIT_PRICE_NGN,
  KIT_STAKES,
} from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'For Employers — Zoryvex',
  description:
    'See what a candidate actually built, checked against a rubric published in advance, before you spend an interview on it.',
};

export default function ForEmployersPage() {
  return (
    <>
      <Section>
        <PageHeader
          title="You cannot interview your way out of a résumé you cannot verify"
          intro="Start with a free diagnostic. When you have a specific role to fill, get a complete evaluation kit for a fixed one-time price. No marketplace candidates required."
        />
        <div className="mt-8 rounded-lg border border-ink-200 p-5 text-left">
          <h2 className="font-semibold text-ink-950">What changed about hiring this year</h2>
          {/*
            Every sentence here is checked against the two linked sources, and
            says only what they say. The version this replaces did not: it
            attributed the one-in-four projection to Gartner, when the source
            attributes it to unnamed experts and hedges it as "could be"; it
            called cloud security the single largest skills gap, when the
            source calls it the second largest behind AI; and it claimed
            fraudulent applicants were the most-cited hiring concern of 2026
            ahead of talent shortage, which appears in neither source.

            Both links were live and both contradicted the page. On a page
            arguing that claims should be checkable, a prospect who clicks
            through and finds the source saying something else costs more than
            the paragraph was ever worth. Recorded in docs/SOURCES.md, which is
            where a claim like this should have been registered to begin with.
          */}
          <p className="mt-2 text-ink-700">
            Experts quoted by HR Daily Advisor project that by 2028, one in four candidate profiles
            worldwide could be fake. Cloud security is separately reported as the skill hiring
            managers are recruiting for most, and the second largest skills gap across security
            teams globally, behind AI.
          </p>
          <p className="mt-2 text-ink-700">
            Those are findings about the market, not about us. We have not placed anyone yet and do
            not claim otherwise. They are here because they are the reason this exists: the usual
            answer to an unverifiable résumé is another interview round, and that stopped working.
          </p>
          <p className="mt-2 text-sm text-ink-700">
            Sources:{' '}
            <a
              className="underline"
              href="https://hrdailyadvisor.hci.org/2026/06/02/the-rise-of-the-fake-applicant-how-to-stop-ai-driven-hiring-fraud/"
              target="_blank"
              rel="noopener noreferrer"
            >
              HR Daily Advisor
            </a>
            ,{' '}
            <a
              className="underline"
              href="https://www.artech.com/blog/cloud-engineer-security-skills-2026/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Artech
            </a>
            .
          </p>
        </div>

        <ButtonLink href="/sign-in" size="lg">
          Start the free diagnostic
        </ButtonLink>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Free role diagnostic</h2>
        <p className="mt-2 text-ink-700">
          Describe the role: launch track, seniority, outcomes, must-have work. See a free proof-gap
          preview, useful on its own, and clearly incomplete until you get the full Kit. No
          candidate profiles required to use it.
        </p>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">
          Proof Hiring Kit — {formatNGN(KIT_PRICE_NGN)}, one-time
        </h2>
        <p className="mt-2 text-ink-700">{KIT_STAKES}</p>
        <p className="mt-4 text-ink-700">Once you buy the Kit for a role, you get:</p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-ink-700">
          {KIT_DELIVERABLES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-500">
          Delivered as HTML with accessible print/download output. No extra service or account
          needed.
        </p>
        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-700">
          What it does not cover
        </h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-700">
          {KIT_NOT_INCLUDED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">
          The candidate marketplace, when it's ready
        </h2>
        <p className="mt-2 text-ink-700">
          A marketplace subscription opens once one of your roles matches at least{' '}
          {MARKETPLACE_GATE_MIN_MATCHES} real, current, discovery-opted candidate, and the billing
          page tells you that number before you pay. It may be a small number early on. We would
          rather show you a small number than let you discover it after the charge. Contact details
          open per role, on the roles that have matches. Both checks run on our servers rather than
          in your browser, and no plan buys past either.
        </p>
        <Link
          prefetch={false}
          href="/pricing"
          className="mt-4 inline-block text-sm font-medium text-accent-700"
        >
          See founding subscription pricing →
        </Link>
      </Section>
    </>
  );
}
