import type { Metadata } from 'next';
import { MARKETPLACE_GATE_MIN_MATCHES } from '@zoryvex/contracts';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';
import {
  FOUNDING_SLOTS_TOTAL,
  EVERY_TIER_INCLUDES,
  FOUNDING_TERMS,
  FOUNDING_TIERS,
  KIT_DELIVERABLES,
  KIT_NOT_INCLUDED,
  KIT_PRICE_NGN,
  KIT_STAKES,
  PAYSTACK_DISCLOSURE,
  formatNGN,
  foundingSavingNGN,
} from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Pricing — Zoryvex',
  description:
    'What the Proof Hiring Kit and each subscription tier cost, in naira, with the founding prices and what they include.',
};

export default function PricingPage() {
  return (
    <>
      <Section>
        <PageHeader
          title="Pricing"
          intro="Candidates are always free. Employers pay for what's actually usable: a free diagnostic, a fixed one-time Kit, and founding-tier subscriptions that only make sense once there's real marketplace supply."
        />
      </Section>

      <Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <h2 className="font-semibold text-ink-950">Employer diagnostic</h2>
            <p className="mt-1 text-2xl font-bold text-ink-950">Free</p>
            <p className="mt-2 text-sm text-ink-700">
              A role diagnostic and proof-gap preview. No candidate profiles required. Not a trial:
              free permanently.
            </p>
          </Card>
          <Card>
            <h2 className="font-semibold text-ink-950">Proof Hiring Kit</h2>
            <p className="mt-1 text-2xl font-bold text-ink-950">{formatNGN(KIT_PRICE_NGN)}</p>
            <p className="mt-2 text-sm text-ink-700">{KIT_STAKES}</p>
            <p className="mt-2 text-sm text-ink-700">
              One-time charge per role. Not a subscription: you own the generated deliverables for
              that role after payment.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-700">
              {KIT_DELIVERABLES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-700">
              What it does not cover
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-ink-700">
              {KIT_NOT_INCLUDED.map((line) => (
                <li key={line} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[0.35rem] size-1.5 shrink-0 rounded-full border border-ink-300"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Marketplace subscriptions</h2>
        <p className="mt-2 text-ink-700">
          Monthly billing only, no annual plans. These are for ongoing access to the candidate
          marketplace once a role has real, opted-in matches; they do not replace the one-time Kit.
          Every tier gives the same marketplace access and the same verified candidates. What
          changes is how many of them you can contact each month.
        </p>

        <div className="mt-6 rounded-lg border-2 border-accent-700 p-5">
          <h3 className="font-semibold text-ink-950">
            Founding places: the first {FOUNDING_SLOTS_TOTAL} organizations only
          </h3>
          <p className="mt-2 text-ink-700">{FOUNDING_TERMS.kept}</p>
          <p className="mt-2 text-ink-700">{FOUNDING_TERMS.gone}</p>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {FOUNDING_TIERS.map((tier) => (
            <Card key={tier.name} className="flex flex-col">
              <h3 className="font-semibold text-ink-950">{tier.name}</h3>
              <p className="mt-1 text-xl font-bold text-ink-950">
                {formatNGN(tier.standardPriceNGN)}
                <span className="text-sm font-normal text-ink-700">/{tier.cadence}</span>
              </p>
              <p className="text-sm text-ink-700">{tier.bestFor}</p>
              <p className="mt-3 rounded-md bg-warm-200 px-3 py-2 text-sm text-ink-950">
                <span className="font-semibold">
                  {formatNGN(tier.priceNGN)}/{tier.cadence}
                </span>{' '}
                for the first {FOUNDING_SLOTS_TOTAL} organizations, kept for life
              </p>
              <p className="mt-2 text-sm text-ink-700">
                {formatNGN(foundingSavingNGN(tier))} a month less than the standard price, for as
                long as the subscription runs.
              </p>

              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-700">
                What you get
              </h4>
              <ul className="mt-2 space-y-2 text-sm text-ink-700">
                {tier.includes.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-[0.35rem] size-1.5 shrink-0 rounded-full bg-emerald-600"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <h4 className="mt-auto border-t border-ink-200 pt-5 text-xs font-semibold uppercase tracking-wide text-ink-700">
                What it does not cover
              </h4>
              <ul className="mt-2 space-y-2 text-sm text-ink-700">
                {tier.notIncluded.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-[0.35rem] size-1.5 shrink-0 rounded-full border border-ink-300"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-ink-200 p-5">
          <h3 className="text-sm font-semibold text-ink-950">True of every tier</h3>
          <ul className="mt-2 space-y-2 text-sm text-ink-700">
            {EVERY_TIER_INCLUDES.map((line) => (
              <li key={line} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[0.35rem] size-1.5 shrink-0 rounded-full bg-ink-300"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/*
          Two gates, both real and both enforced on our own servers. This page
          previously described one that existed in neither place: it said
          checkout was disabled per role, which a per-organization
          subscription cannot be. The spec's intent was never per-role
          plumbing, it was "do not sell access nobody can use", and that is
          what startSubscriptionCheckout now enforces.
        */}
        <p className="mt-2 text-sm text-ink-700">
          A marketplace subscription opens once one of your roles matches at least{' '}
          {MARKETPLACE_GATE_MIN_MATCHES} real, current, discovery-opted candidate. Before you pay,
          the billing page shows how many that actually is for your roles today. Early on it will be
          a small number, and you get to decide whether a small number is worth it. Contact details
          open per role, on the roles that have matches. Both checks run on our servers rather than
          in your browser, and no plan buys past either.
        </p>
      </Section>

      <Section>
        <h2 className="text-2xl font-bold text-ink-950">Before every paid redirect</h2>
        <p className="mt-2 text-ink-700">{PAYSTACK_DISCLOSURE}</p>
      </Section>
    </>
  );
}
