'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { CheckoutKind } from '@zoryvex/local-adapters';
import { subscriptionPrice, type Entitlement, type KitOrder } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { PageHeader, Section } from '@/components/layout/Section';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured } from '@/lib/real-api';
import { RealBillingPage } from '@/components/billing/RealBillingPage';
import { PageLoading } from '@/components/ui/PageLoading';
import {
  EVERY_TIER_INCLUDES,
  FOUNDING_SLOTS_TOTAL,
  FOUNDING_TERMS,
  FOUNDING_TIERS,
  formatNGN,
  PAYSTACK_DISCLOSURE,
} from '@/lib/pricing';

export default function BillingPage() {
  const session = useSession();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [kitOrders, setKitOrders] = useState<KitOrder[]>([]);
  const [placesTaken, setPlacesTaken] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!session?.employerId || useReal) return;
    const { data } = getLocalAdapters();
    setEntitlement(data.getEntitlement(session.employerId));
    setKitOrders(data.listKitOrdersForEmployer(session.employerId));
    // An employer who already holds a founding place is quoted the founding
    // price even once the places are gone, because their place is still
    // counted against the cap. Passing zero here is how the page asks the
    // same question the checkout asks, rather than showing them a standard
    // price and then charging a founding one.
    setPlacesTaken(
      data.holdsFoundingPlace(session.employerId) ? 0 : data.countFoundingPlacesTaken(),
    );
  }, [session, useReal]);

  useEffect(refresh, [refresh]);

  // Real mode is a different page, not a variant of this one. The local
  // build resolves a checkout instantly against a browser-storage fake,
  // which is the right shape for a demo and exactly the wrong shape for
  // money: the real page never concludes anything itself, it asks the
  // server. Keeping them apart is what stops a change to the demo quietly
  // reaching the version that charges people.
  //
  // Suspense because the real page reads the `?ref=` Paystack sends the
  // buyer back with, and useSearchParams needs a boundary under Next's
  // static export.
  if (useReal) {
    return (
      <Suspense
        fallback={
          <Section className="max-w-2xl">
            <PageLoading blocks={3} />
          </Section>
        }
      >
        <RealBillingPage />
      </Suspense>
    );
  }

  function subscribe(plan: Exclude<CheckoutKind, 'kit'>) {
    if (!session?.employerId) return;
    const { payments } = getLocalAdapters();
    const checkout = payments.createSubscriptionCheckout(session.employerId, plan);
    // Explicit choice already made by clicking this specific plan's button —
    // resolved immediately here rather than a second confirmation step,
    // since there is no ambiguity about which plan was chosen.
    payments.resolveCheckout(checkout.id, `evt_${checkout.id}`, 'succeeded');
    showToast(`Subscribed to ${plan[0]!.toUpperCase()}${plan.slice(1)}.`, 'success');
    refresh();
  }

  function cancel() {
    if (!session?.employerId) return;
    getLocalAdapters().payments.cancelSubscription(session.employerId);
    setCancelOpen(false);
    showToast('Subscription canceled.', 'success');
    refresh();
  }

  if (!session) return null;

  // Whether a plan can be started right now, which is a different question
  // from whether the plans are worth showing. Everything below is always
  // shown; only the button changes.
  const isSubscribed = entitlement?.status === 'active';

  return (
    <Section className="max-w-2xl">
      <PageHeader title="Billing" />

      <Card className="mb-8">
        <h2 className="font-semibold text-ink-950">Current plan</h2>
        <p className="mt-1 text-ink-700">
          {entitlement && entitlement.status === 'active' ? (
            <>
              {entitlement.plan[0]!.toUpperCase()}
              {entitlement.plan.slice(1)} · active
              {entitlement.priceNGN !== null && <> · {formatNGN(entitlement.priceNGN)}/month</>}
            </>
          ) : (
            'No active marketplace subscription'
          )}
        </p>
        {/*
          The price a member holds was recorded nowhere and shown nowhere, on
          a product whose strongest commercial promise is that a founding
          member keeps their price. Being able to see it is the whole point
          of having been early.
        */}
        {entitlement?.status === 'active' && entitlement.foundingMember && (
          <p className="mt-2 text-sm text-ink-700">
            You hold a founding place. This price stays the same for as long as this subscription
            runs, whatever the standard price does.
          </p>
        )}
        {entitlement?.status === 'active' && (
          <Button variant="secondary" className="mt-3" onClick={() => setCancelOpen(true)}>
            Cancel subscription
          </Button>
        )}
      </Card>

      {/*
        Always rendered, never gated on being unsubscribed.

        This section used to disappear the moment a subscription went
        active, so an employer part-way through a paid month could not see
        what else was sold: not the prices, not what the other tiers
        include, nothing, on the page they pay on. The real billing page
        had the same defect and was fixed first; this is the demo build,
        which is the one that gets shown to people, so it had to match.

        It matches production behaviour rather than the demo's own looser
        rules: locally a plan could be swapped in one click, but Paystack
        has no proration and no way to move a running subscription, so a
        demo that switched instantly would teach the wrong thing.
      */}
      <div className="mb-8">
        <h2 className="mb-3 text-xl font-bold text-ink-950">
          {isSubscribed ? 'All marketplace plans' : 'Marketplace subscriptions'}
        </h2>
        <p className="mb-4 text-sm text-ink-700">
          Monthly billing only, no annual plans. Every tier gives the same marketplace access and
          the same verified candidates. What changes is how many of them you can contact each month.
          Choosing one is a separate, explicit action; nothing here starts a trial automatically.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {FOUNDING_TIERS.map((tier) => {
            // What this employer would actually be charged today, from the
            // same function the checkout uses. The page used to show the
            // founding price to everyone, including buyers who could no
            // longer get it.
            const quote = subscriptionPrice(tier.plan, placesTaken);
            return (
              <Card key={tier.name} className="flex flex-col">
                <h3 className="font-semibold text-ink-950">{tier.name}</h3>
                <p className="mt-1 font-bold text-ink-950">{formatNGN(quote.amountNGN)}/mo</p>
                <p className="text-sm text-ink-700">{tier.bestFor}</p>
                {quote.founding ? (
                  <p className="mt-3 rounded-md bg-warm-200 px-3 py-2 text-sm text-ink-950">
                    A founding place. The standard price is {formatNGN(tier.standardPriceNGN)}/mo;
                    yours stays{' '}
                    <span className="font-semibold">{formatNGN(quote.amountNGN)}/mo</span> for as
                    long as the subscription runs.
                  </p>
                ) : (
                  <p className="mt-3 rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700">
                    The {FOUNDING_SLOTS_TOTAL} founding places have been taken. This is the standard
                    price.
                  </p>
                )}

                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-700">
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

                <h4 className="mt-auto border-t border-ink-200 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-700">
                  Not included
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

                {isSubscribed ? (
                  entitlement?.plan === tier.plan ? (
                    <p className="mt-5 text-sm text-ink-700">This is the plan you are on.</p>
                  ) : (
                    <div className="mt-5">
                      <p className="text-sm text-ink-700">
                        To move here, cancel your current plan first. You keep what you have paid
                        for until the period ends.
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-3 self-start"
                        onClick={() => setCancelOpen(true)}
                      >
                        Cancel to switch
                      </Button>
                    </div>
                  )
                ) : (
                  <Button
                    variant="secondary"
                    className="mt-5 self-start"
                    onClick={() => subscribe(tier.plan)}
                  >
                    Subscribe to {tier.name}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
        <div className="mt-5 rounded-lg border-2 border-accent-700 p-4">
          <h3 className="text-sm font-semibold text-ink-950">
            Founding places: the first {FOUNDING_SLOTS_TOTAL} organizations only
          </h3>
          <p className="mt-2 text-sm text-ink-700">{FOUNDING_TERMS.kept}</p>
          <p className="mt-2 text-sm text-ink-700">{FOUNDING_TERMS.gone}</p>
        </div>
        <div className="mt-5 rounded-lg border border-ink-200 p-4">
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
        <p className="mt-4 text-sm text-ink-500">{PAYSTACK_DISCLOSURE}</p>
      </div>

      <div>
        <h2 className="mb-3 text-xl font-bold text-ink-950">Kit orders</h2>
        {kitOrders.length === 0 ? (
          <p className="text-sm text-ink-700">No Kit purchases yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {kitOrders.map((order) => (
              <li key={order.id}>
                <Card className="flex items-center justify-between">
                  <span className="text-sm text-ink-700">{formatNGN(order.amountNGN)}</span>
                  <Badge tone={order.status === 'succeeded' ? 'accent' : 'neutral'}>
                    {order.status}
                  </Badge>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel your subscription?"
      >
        <p className="text-sm text-ink-700">
          You'll lose marketplace access at the end of the current period. This does not affect any
          Kit you've already purchased.
        </p>
        <div className="mt-4 flex gap-3">
          <Button variant="danger" onClick={cancel}>
            Yes, cancel
          </Button>
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            Keep subscription
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}
