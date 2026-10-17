'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARKETPLACE_GATE_MIN_MATCHES, type SubscriptionPlan } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { useToast } from '@/components/ui/Toast';
import { realBilling, type BillingSnapshot } from '@/lib/real-api';
import { messageFor } from '@/lib/real-api/error-message';
import { PageLoading } from '@/components/ui/PageLoading';
import { useResetOnRestore } from '@/lib/use-reset-on-restore';
import {
  EVERY_TIER_INCLUDES,
  FOUNDING_TERMS,
  FOUNDING_TIERS,
  formatNGN,
  PAYSTACK_DISCLOSURE,
} from '@/lib/pricing';
import { AccessBadge, BillingStatePanel, formatDate } from './BillingStatePanel';
import { PaymentHistory } from './PaymentHistory';

/**
 * Billing against the real backend.
 *
 * Everything shown here is read from the server on load. The browser never
 * decides that a payment succeeded, never computes a price, and never
 * grants itself access — including on the way back from Paystack, where
 * the callback URL is treated as a hint that it is worth asking again
 * rather than as an answer.
 *
 * That last point is the reason for the polling below. Paystack redirects
 * the buyer back within a second or two, but the webhook that actually
 * grants access can land after that. Showing "not subscribed" in the gap
 * would tell somebody who has just paid that they have not, so the page
 * says it is confirming and asks again a few times before giving up and
 * saying, truthfully, that it is taking longer than usual.
 */

/** How many times to re-ask after returning from a checkout, and how far apart. */
const CONFIRM_ATTEMPTS = 6;
const CONFIRM_INTERVAL_MS = 2500;

type ConfirmState = 'idle' | 'confirming' | 'slow';

export function RealBillingPage() {
  const params = useSearchParams();
  const { showToast } = useToast();
  const returnedFromCheckout = Boolean(params.get('ref'));

  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(
    returnedFromCheckout ? 'confirming' : 'idle',
  );
  const [startingPlan, setStartingPlan] = useState<SubscriptionPlan | null>(null);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await realBilling.getBilling();
      setSnapshot(next);
      setLoadFailed(false);
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Kept in a ref so the polling effect below does not restart every time
  // the snapshot changes, which would reset the attempt count and poll
  // forever.
  const attemptsRef = useRef(0);
  /** Synchronous latch: React state is too late to stop a second click in the same tick. */
  const inFlight = useRef(false);
  /** One idempotency key per plan, so a retry resumes rather than duplicates. */
  const checkoutKeys = useRef(new Map<SubscriptionPlan, string>());

  useEffect(() => {
    if (confirmState !== 'confirming') return;
    let cancelled = false;

    const tick = async () => {
      const next = await load();
      if (cancelled) return;
      if (next && next.overview.access !== 'none') {
        setConfirmState('idle');
        showToast('Subscription active. Thank you.', 'success');
        return;
      }
      attemptsRef.current += 1;
      if (attemptsRef.current >= CONFIRM_ATTEMPTS) {
        setConfirmState('slow');
        return;
      }
      timer = setTimeout(() => void tick(), CONFIRM_INTERVAL_MS);
    };

    let timer = setTimeout(() => void tick(), CONFIRM_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [confirmState, load, showToast]);

  /*
    Both of these flags survive a redirect to Paystack, because the success
    path of startCheckout and updateCard is to leave the page rather than to
    update it. A buyer who presses Back is served this page out of the
    back/forward cache with the flag still set, and `startingPlan !== null`
    disables every Subscribe button on the page rather than only the one they
    pressed. See use-reset-on-restore for the full reasoning.
  */
  useResetOnRestore(() => {
    setStartingPlan(null);
    setUpdatingCard(false);
    // Coming back with the back button is a new intent, not a retry of
    // the one that redirected away. Releasing the in-flight latch is what
    // lets the buyer press Subscribe again at all; the keys survive, so
    // pressing it again resumes the same checkout rather than opening a
    // second one beside the first.
    inFlight.current = false;
  });

  async function startCheckout(plan: SubscriptionPlan) {
    // Checked and set synchronously, because `startingPlan` is React
    // state and does not exist yet for a second click in the same tick.
    // Measured against the deployed API: three clicks on Subscribe sent
    // three POSTs, even though the button rendered disabled immediately
    // afterwards, because all three handlers ran before the re-render.
    if (inFlight.current) return;
    inFlight.current = true;

    // One key per plan, kept across retries of the same intent.
    //
    // This used to be `crypto.randomUUID()` inline, which read as "a fresh
    // key per attempt" and was really a fresh key per click. The server
    // requires an Idempotency-Key precisely so a double click produces one
    // checkout, and it implements that correctly with a transactional key
    // item — so the only thing defeating it was the caller handing it a
    // different key every time. Three clicks meant three keys, three
    // attempts, three Paystack transactions, and a buyer who completed two
    // of them charged twice with two subscriptions running.
    //
    // Reused on a retry, which is what makes a retry safe: the server
    // hands back the attempt the first call created and Paystack returns a
    // fresh authorization URL for the same reference, which can only ever
    // be paid once. Cleared after a genuine failure of a different plan so
    // switching plans is a new intent, not a replay of the old one.
    const existing = checkoutKeys.current.get(plan);
    const idempotencyKey = existing ?? crypto.randomUUID();
    checkoutKeys.current.set(plan, idempotencyKey);

    setStartingPlan(plan);
    try {
      const { authorizationUrl } = await realBilling.startSubscription(plan, idempotencyKey);
      // A full-page redirect rather than a new tab: the buyer needs to come
      // back to this origin for the callback, and a popup can be blocked.
      window.location.assign(authorizationUrl);
    } catch (error) {
      inFlight.current = false;
      setStartingPlan(null);
      showToast(
        messageFor(error, "Couldn't start the checkout. Nothing has been charged."),
        'error',
      );
    }
  }

  async function updateCard() {
    setUpdatingCard(true);
    try {
      const { link } = await realBilling.getCardUpdateLink();
      window.location.assign(link);
    } catch (error) {
      setUpdatingCard(false);
      showToast(
        messageFor(error, "Couldn't open the card update page. Try again in a moment."),
        'error',
      );
    }
  }

  async function confirmCancel() {
    setCancelling(true);
    try {
      const result = await realBilling.cancel();
      setCancelOpen(false);
      await load();
      showToast(`Cancelled. You keep access until ${formatDate(result.accessEndsAt)}.`, 'success');
    } catch (error) {
      showToast(
        messageFor(error, "Couldn't cancel. Nothing has changed. Try again in a moment."),
        'error',
      );
    } finally {
      setCancelling(false);
    }
  }

  if (loadFailed && !snapshot) {
    return (
      <Section className="max-w-2xl">
        <PageHeader title="Billing" />
        <StatusState
          kind="500"
          title="We could not load your billing"
          body="Nothing has changed and nothing has been charged. Reload the page in a moment."
        />
      </Section>
    );
  }

  if (!snapshot) {
    return (
      <Section className="max-w-2xl">
        <PageHeader title="Billing" />
        <PageLoading header={false} blocks={3} />
      </Section>
    );
  }

  const { overview, history, quotes } = snapshot;
  const hasSubscription = overview.access !== 'none';

  /*
    The plans are always on this page now, and the reason is a promise the
    product was already making and then breaking.

    The whole section used to render only when `canSubscribe` was true, which
    meant "no subscription at all, or one already fully ended". Two things
    fell through that.

    An employer part-way through a paid month could not see what else was
    sold. Not the prices, not what the other tiers include, nothing: the page
    they pay on simply had no plans on it. That is a strange thing for a
    billing page to hide, and there is nothing to protect them from by
    hiding it.

    Worse, cancelling did not open it back up. Cancelling moves a
    subscription to `non-renewing` and leaves access running until the period
    already paid for runs out, which is the humane behaviour and is the
    behaviour the cancel dialog describes. But `non-renewing` is not
    `cancelled`, so the plans stayed hidden for the rest of the month, while
    the cancel dialog was promising in as many words: "You can subscribe
    again later." They could not. The page had removed the way.

    So the gate below is no longer about whether to show the plans. It is
    only about whether a new one can START right now, and it matches what the
    server actually enforces rather than guessing wider: subscription-service
    refuses a second subscription at `active` and `attention`, and accepts
    one at every other status. `non-renewing` is accepted there, which is
    what makes resubscribing after a cancellation work at all.
  */
  const liveSubscription =
    overview.subscriptionStatus === 'active' || overview.subscriptionStatus === 'attention';
  const accessEndsAt = overview.currentPeriodEnd ?? overview.nextPaymentDate;

  return (
    <Section className="max-w-3xl">
      <PageHeader title="Billing" />

      {confirmState !== 'idle' && !hasSubscription && (
        <Card className="mb-6" role="status" aria-live="polite">
          <h2 className="font-semibold text-ink-950">
            {confirmState === 'confirming'
              ? 'Confirming your payment'
              : 'This is taking longer than usual'}
          </h2>
          <p className="mt-2 text-sm text-ink-700">
            {confirmState === 'confirming'
              ? 'We are checking with Paystack directly rather than taking your browser at its word. This usually takes a few seconds.'
              : 'Paystack has not confirmed the payment to us yet. If money left your account, it is not lost: we check again automatically every hour and your access will start without you doing anything. Nothing will be charged twice.'}
          </p>
          {confirmState === 'slow' && (
            <Button variant="secondary" className="mt-3" onClick={() => void load()}>
              Check again now
            </Button>
          )}
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink-950">Current plan</h2>
          <AccessBadge access={overview.access} />
        </div>
        <p className="mt-2 text-ink-700">
          {hasSubscription && overview.plan ? (
            <>
              {overview.plan[0]!.toUpperCase()}
              {overview.plan.slice(1)}
              {overview.priceNGN !== null && (
                <>
                  {' · '}
                  {formatNGN(overview.priceNGN)}/
                  {overview.interval === 'annually' ? 'year' : 'month'}
                </>
              )}
            </>
          ) : (
            'No marketplace subscription'
          )}
        </p>
        {overview.foundingMember && hasSubscription && (
          <p className="mt-2 text-sm text-ink-700">
            You hold a founding place. This price stays the same for as long as this subscription
            runs, whatever the standard price does.
          </p>
        )}
        {hasSubscription && overview.subscriptionStatus !== 'non-renewing' && (
          <Button variant="secondary" className="mt-3" onClick={() => setCancelOpen(true)}>
            Cancel subscription
          </Button>
        )}
      </Card>

      <div className="mb-8">
        <BillingStatePanel
          overview={overview}
          onUpdateCard={() => void updateCard()}
          updatingCard={updatingCard}
        />
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-xl font-bold text-ink-950">
          {hasSubscription ? 'All marketplace plans' : 'Marketplace subscriptions'}
        </h2>
        <p className="mb-4 text-sm text-ink-700">
          Monthly billing only, no annual plans. Every tier gives the same marketplace access and
          the same verified candidates. What changes is how many of them you can contact each month.
          Choosing one is a separate, explicit action; nothing here starts a trial.
        </p>

        {/*
            The rules of changing plan, written down before somebody needs
            them rather than discovered at the point of being refused.

            Paystack has no proration and no way to move a running
            subscription onto a different plan. Its own documented route is
            to let the current one finish and start the new one from the next
            payment date, which is what cancelling here does. Saying that
            plainly is the difference between a product with a constraint and
            a product that feels broken.
          */}
        {liveSubscription && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-ink-950">Moving to a different plan</h3>
            <p className="mt-2 text-sm text-ink-700">
              You are on {overview.plan}. Cancel this plan first, then start the one you want.
              Cancelling does not cut you off: you keep everything you are paying for until{' '}
              {formatDate(accessEndsAt)}, and you can start any plan below, including this same one,
              as soon as you have cancelled.
            </p>
            <p className="mt-2 text-sm text-ink-700">
              It works this way because your card is charged for a whole month at a time and there
              is no way to refund part of one. Switching immediately would mean paying for a second
              month on top of the one you have already bought.
            </p>
            {overview.foundingMember && (
              <p className="mt-2 text-sm text-ink-700">
                You hold a founding place. Cancelling gives it up, and a founding price is only held
                for as long as a subscription runs.
              </p>
            )}
          </Card>
        )}

        {/*
            Cancelled, but the paid month is still running. The plans below
            are live and pressing one works. This says so, because the last
            thing this page told them was "cancelled".
          */}
        {!liveSubscription && hasSubscription && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold text-ink-950">Your subscription is ending</h3>
            <p className="mt-2 text-sm text-ink-700">
              You keep access until {formatDate(accessEndsAt)} and nothing further will be charged.
              You can start any plan below right now, including the one you were on.
            </p>
            <p className="mt-2 text-sm text-ink-700">
              Starting one before {formatDate(accessEndsAt)} is charged straight away, and the days
              you have already paid for run out alongside it rather than being added on. Waiting
              until then costs you nothing.
            </p>
          </Card>
        )}

        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-ink-950">What happens when you subscribe</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li>You go to Paystack&apos;s checkout page and pay there. We never see your card.</li>
            <li>
              Paystack confirms the payment to us and your access opens. If you close the tab before
              that, it still opens: we check with Paystack directly.
            </li>
            <li>
              The same amount is charged on the same date each month until you cancel. You can
              cancel any time, and you keep the month you have paid for.
            </li>
            {/*
              The gate is a number that has moved before, so the sentence
              agrees with whatever it is rather than assuming the plural.
              At its current value of 1 the old wording read "with 1 real,
              current matches", on the page where somebody decides to
              spend several hundred thousand naira a month.
            */}
            <li>
              Contact details open per role, on a role with at least {MARKETPLACE_GATE_MIN_MATCHES}{' '}
              real, current {MARKETPLACE_GATE_MIN_MATCHES === 1 ? 'match' : 'matches'}. On a role
              below that you can browse everything found so far but cannot spend an unlock, on any
              plan. Said here rather than discovered afterwards.
            </li>
          </ol>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          {FOUNDING_TIERS.map((tier) => {
            const quote = quotes.find((q) => q.plan === tier.plan);
            if (!quote) return null;
            const isCurrent = hasSubscription && overview.plan === tier.plan;
            return (
              <Card key={tier.name} className="flex flex-col">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="font-semibold text-ink-950">{tier.name}</h3>
                  {/*
                      Marked on the card itself. Somebody comparing three
                      tiers should not have to scroll back up to remember
                      which one they are on.
                    */}
                  {isCurrent && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-accent-700">
                      {liveSubscription ? 'Your plan' : 'Ending'}
                    </span>
                  )}
                </div>
                <p className="mt-1 font-bold text-ink-950">{formatNGN(quote.amountNGN)}/mo</p>
                <p className="text-sm text-ink-700">{tier.bestFor}</p>
                {/*
                    What the marketplace actually holds for this organization,
                    stated before the purchase rather than discovered after
                    it. Buying is allowed from a single match, so this number
                    can be small; a buyer who is trusted to decide is owed the
                    number they are deciding on.
                  */}
                <p className="mt-2 text-sm text-ink-700">
                  {quote.marketplaceCandidates === 1
                    ? 'Your strongest role currently matches 1 candidate who has opted into discovery.'
                    : `Your strongest role currently matches ${quote.marketplaceCandidates} candidates who have opted into discovery.`}{' '}
                  {quote.marketplaceCandidates < 5
                    ? 'That is a small marketplace today. The Kit and the verification work regardless of its size, and matches are recomputed as candidates join.'
                    : 'Matches are recomputed as candidates join and as you widen a role.'}
                </p>
                {quote.priceTier === 'founding' ? (
                  <p className="mt-3 rounded-md bg-warm-200 px-3 py-2 text-sm text-ink-950">
                    A founding place, {quote.foundingPlacesLeft} of them left. The standard price is{' '}
                    {formatNGN(tier.standardPriceNGN)}/mo; yours stays{' '}
                    <span className="font-semibold">{formatNGN(quote.amountNGN)}/mo</span> for as
                    long as the subscription runs.
                  </p>
                ) : (
                  <p className="mt-3 rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700">
                    The founding places have been taken. This is the standard price.
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

                {/*
                    Three states, and each one says what is true rather than
                    leaving a dead button on the card.

                    The middle case is the one that used to be impossible to
                    reach, because the whole section was hidden while a
                    subscription was running. A button here would 409 against
                    subscription-service's own guard, so it offers the step
                    that actually leads somewhere instead.
                  */}
                {!quote.available ? (
                  <p className="mt-5 text-sm text-ink-700">
                    Not open for subscription yet. Nothing can be charged for this tier.
                  </p>
                ) : liveSubscription ? (
                  isCurrent ? (
                    <p className="mt-5 text-sm text-ink-700">
                      This is the plan you are on. It renews on{' '}
                      {formatDate(overview.nextPaymentDate)}.
                    </p>
                  ) : (
                    <div className="mt-5">
                      <p className="text-sm text-ink-700">
                        To move here from {overview.plan}, cancel first. You keep your current plan
                        until {formatDate(accessEndsAt)}.
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
                    disabled={startingPlan !== null}
                    onClick={() => void startCheckout(tier.plan)}
                  >
                    {startingPlan === tier.plan
                      ? 'Opening Paystack…'
                      : isCurrent
                        ? `Start ${tier.name} again`
                        : `Subscribe to ${tier.name}`}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border-2 border-accent-700 p-4">
          <h3 className="text-sm font-semibold text-ink-950">Founding places</h3>
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

        <p className="mt-4 text-sm text-ink-700">{PAYSTACK_DISCLOSURE}</p>
      </div>

      <div>
        <h2 className="mb-3 text-xl font-bold text-ink-950">Payment history</h2>
        <PaymentHistory history={history} />
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel your subscription?"
      >
        <p className="text-sm text-ink-700">
          Nothing more will be charged. You keep full marketplace access until{' '}
          {formatDate(overview.currentPeriodEnd ?? overview.nextPaymentDate)}, because that period
          is already paid for.
        </p>
        <p className="mt-2 text-sm text-ink-700">
          This does not affect any Proof Hiring Kit you have bought. You can subscribe again later,
          but a founding price is only held for as long as a subscription runs.
        </p>
        <div className="mt-4 flex gap-3">
          <Button variant="danger" onClick={() => void confirmCancel()} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Yes, cancel'}
          </Button>
          <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={cancelling}>
            Keep subscription
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}
