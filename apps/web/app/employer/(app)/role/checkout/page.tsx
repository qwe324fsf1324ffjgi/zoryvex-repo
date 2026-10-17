'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Checkout } from '@zoryvex/local-adapters';
import type { Role } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import {
  formatNGN,
  KIT_DELIVERABLES,
  KIT_NOT_INCLUDED,
  KIT_PRICE_NGN,
  KIT_REFUND_TERMS,
  PAYSTACK_DISCLOSURE,
} from '@/lib/pricing';
import { isRealApiConfigured, realKit, realRoles } from '@/lib/real-api';
import { messageFor } from '@/lib/real-api/error-message';
import { useResetOnRestore } from '@/lib/use-reset-on-restore';
import { PageLoading } from '@/components/ui/PageLoading';

function CheckoutContent() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const searchParams = useSearchParams();
  const roleId = searchParams.get('id');
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  /** Synchronous latch: React state is too late to stop a second click in the same tick. */
  const inFlight = useRef(false);
  /** One idempotency key for this role's checkout, so a retry resumes rather than duplicates. */
  const checkoutKey = useRef<string | null>(null);

  useEffect(() => {
    if (!roleId || !session?.employerId) return;

    if (useReal) {
      realRoles
        .getRole(roleId)
        .then(({ role: found }) => setRole(found))
        .catch(() => setRole(null));
      return;
    }

    const { data } = getLocalAdapters();
    const found = data.getRole(roleId);
    if (!found || found.employerId !== session.employerId) {
      setRole(null);
      return;
    }
    setRole(found);
  }, [roleId, session, useReal]);

  /*
    `redirecting` is cleared when the request throws and never when it
    succeeds, because success means handing the browser to Paystack. Coming
    back with the back button restores this page from the back/forward cache
    with the flag still set, leaving "Continue to Paystack" disabled for a
    buyer who wants to buy. See use-reset-on-restore.
  */
  useResetOnRestore(() => {
    setRedirecting(false);
    inFlight.current = false;
  });

  async function startCheckout() {
    if (!roleId || !session?.employerId) return;

    if (useReal) {
      // Synchronous, because `redirecting` is React state and a second
      // click in the same tick runs before the re-render that disables
      // the button. Measured on the billing page against the deployed
      // API: three clicks sent three POSTs.
      if (inFlight.current) return;
      inFlight.current = true;

      // One key for this role's checkout, kept across retries.
      //
      // A fresh `crypto.randomUUID()` per click defeated the server's
      // idempotency entirely: the handler requires the header precisely
      // so a double click makes one order, and it enforces that with a
      // conditional write, so a different key each time meant a different
      // order each time. Reusing it is what makes a retry a retry —
      // Paystack returns a new authorization URL for the same reference,
      // and a reference can only be paid once.
      const idempotencyKey = checkoutKey.current ?? crypto.randomUUID();
      checkoutKey.current = idempotencyKey;

      setRedirecting(true);
      try {
        // A real Paystack hosted checkout is a full page navigation away
        // from this app, not something an in-page toast/dialog can show —
        // window.location.href leaves the SPA on purpose.
        const { authorizationUrl } = await realKit.createOrder(roleId, idempotencyKey);
        window.location.href = authorizationUrl;
      } catch (error) {
        inFlight.current = false;
        setRedirecting(false);
        // The server words each refusal for a person: this role already has
        // a paid Kit, or purchases are paused. Blaming Paystack for both
        // and telling the buyer to try again was wrong twice over — it
        // named the wrong cause, and "try again" will never work for
        // either. Only AppError messages reach a client at all, so this
        // cannot leak internals.
        const message = messageFor(
          error,
          "Couldn't reach Paystack to start the checkout. Nothing was charged. Try again.",
        );
        showToast(message, 'error');
      }
      return;
    }

    setCheckout(getLocalAdapters().payments.createKitCheckout(session.employerId, roleId));
  }

  function resolve(outcome: 'succeeded' | 'failed') {
    if (!checkout) return;
    const eventId = `evt_${checkout.id}_${outcome}`;
    getLocalAdapters().payments.resolveCheckout(checkout.id, eventId, outcome);
    if (outcome === 'succeeded') {
      showToast('Payment succeeded. Your Kit is ready.', 'success');
    } else {
      showToast('Payment failed. No charge was completed.', 'error');
    }
    router.push(`/employer/role?id=${roleId}`);
  }

  if (!roleId) return <StatusState kind="404" title="No role specified" />;
  if (role === undefined) {
    // Was `return null`, which rendered a blank page under the nav while the
    // role loaded. Every other page in this app says it is loading, and a
    // checkout screen is the worst one to look broken on.
    return (
      <Section className="max-w-md">
        <PageLoading blocks={1} />
      </Section>
    );
  }
  if (role === null) return <StatusState kind="403" />;

  return (
    <Section className="max-w-md">
      <PageHeader title="Get the Proof Hiring Kit" />
      <Card>
        <p className="text-sm text-ink-700">Role</p>
        <p className="font-semibold break-words text-ink-950">{role.title}</p>
        <p className="mt-4 text-2xl font-bold text-ink-950">{formatNGN(KIT_PRICE_NGN)}</p>
        <p className="mt-1 text-sm text-ink-700">One-time. Not a subscription.</p>
        {/*
          What happens next, answered before it is asked. This page showed a
          price and a button and nothing about what the money buys back, which
          is a fair question to have at the moment of paying and a worse one to
          be left with afterwards. Every claim here is what the system actually
          does: Paystack returns to the role page (kit-service's callbackUrl),
          and the artifact is generated once the webhook confirms the payment,
          which took about fifteen seconds on the real transaction of
          2026-08-26.
        */}
        <p className="mt-3 border-t border-ink-200 pt-3 text-sm text-ink-700">
          Paystack brings you back to this role. The Kit is generated once your payment is
          confirmed, usually within seconds, and stays on the role to download or print whenever you
          need it.
        </p>

        {/*
          docs/PRODUCT_SPEC.md requires the concrete deliverables, exact
          limits, final price, seller disclosure and cancellation/refund
          behaviour to all be shown before any charge, and
          docs/ACCEPTANCE_CRITERIA.md repeats it as a Kit-checkout criterion.
          This screen showed the price and the disclosure and none of the rest,
          which was survivable at 29,000 and is not the sort of thing to ask
          95,000 for.

          Every list here is the same constant the pricing and employer pages
          render, so what a buyer agreed to at checkout cannot drift from what
          they were shown beforehand.
        */}
        <h2 className="mt-4 border-t border-ink-200 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-700">
          What you get
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
          {KIT_DELIVERABLES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-700">
          What it does not cover
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
          {KIT_NOT_INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <p className="mt-4 border-t border-ink-200 pt-3 text-sm text-ink-700">{KIT_REFUND_TERMS}</p>
      </Card>
      <p className="mt-4 text-sm text-ink-500">{PAYSTACK_DISCLOSURE}</p>

      {!checkout ? (
        <Button className="mt-6" onClick={() => void startCheckout()} disabled={redirecting}>
          {redirecting ? 'Redirecting to Paystack…' : 'Continue to Paystack'}
        </Button>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-ink-700">
            This is a local simulation of the Paystack hosted-checkout handoff. Choose an outcome to
            see how each is handled:
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button onClick={() => resolve('succeeded')}>Simulate payment succeeded</Button>
            <Button variant="secondary" onClick={() => resolve('failed')}>
              Simulate payment failed
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

export default function KitCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutContent />
    </Suspense>
  );
}
