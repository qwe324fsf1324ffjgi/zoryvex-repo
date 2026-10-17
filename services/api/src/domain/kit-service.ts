import type { FeatureFlags } from '@zoryvex/config';
import { randomUUID } from 'node:crypto';
import { KIT_PRICE_NGN, type KitOrder, type PaymentAttempt, type Role } from '@zoryvex/contracts';
import {
  generateKitDeliverables,
  generateProofGapPreview,
  renderKitHtmlDocument,
  type ProofGapPreview,
} from '@zoryvex/kit-templates';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';
import type { KitArtifact } from '../repositories/kit-artifact-repository';

export interface KitDependencies {
  clock: Clock;
  getFeatureFlags(): Promise<FeatureFlags>;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  getKitOrderForRole(roleId: string): Promise<KitOrder | null>;
  createKitOrderIfNotExists(
    order: KitOrder,
    idempotencyKey: string,
  ): Promise<{ order: KitOrder; created: boolean }>;
  getLatestArtifact(roleId: string): Promise<KitArtifact | null>;
  createArtifact(artifact: KitArtifact): Promise<void>;
  /** Employer's contact email — Paystack requires one to initialize a transaction. */
  getEmployerEmail(employerId: string): Promise<string>;
  initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string }>;
  /** Records where the buyer was sent, so a retry can return the same place. */
  /** Re-reads one order, for the concurrent-request case. */
  getKitOrder(roleId: string, kitOrderId: string): Promise<KitOrder | null>;
  setKitOrderCheckoutUrl(
    roleId: string,
    kitOrderId: string,
    checkoutUrl: string,
  ): Promise<KitOrder | null>;
  /**
   * Records the attempt to take money, alongside the KitOrder.
   *
   * The KitOrder describes a thing that was bought. It cannot describe a
   * checkout that was opened and abandoned, or a `charge.success` whose
   * delivery failed for the full seventy-two hour retry window — and
   * Paystack sends no webhook for either. Without this row the Kit would
   * be the one paid product in this system that reconciliation could not
   * recover, which is exactly the customer-paid-and-got-nothing case.
   *
   * The attempt id is the kit order id on purpose: the reference already
   * embeds it, so one identifier ties the two records together.
   */
  createPaymentAttemptIfNotExists(
    attempt: PaymentAttempt,
    idempotencyKey: string,
  ): Promise<{ attempt: PaymentAttempt; created: boolean }>;
  /** Absolute app origin (e.g. https://test.zoryvex.space) — the redirect target after checkout. */
  appOrigin: string;
}

/**
 * Free preview: proof gaps + a sample rubric row, never a fabricated
 * candidate, never implies payment already occurred (Prompt 7). The
 * identical NotFoundError for "not found" and "not yours" means this never
 * confirms/denies another employer's role exists.
 */
export async function getKitPreview(
  employerId: string,
  roleId: string,
  deps: Pick<KitDependencies, 'getRole'>,
): Promise<ProofGapPreview> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');
  return generateProofGapPreview(result.role);
}

/**
 * Creates a *pending* order, then initializes a real Paystack transaction
 * (TEST mode only — governed entirely by which secret key is configured in
 * the environment, never a code-level branch) so the employer can actually
 * be redirected to a live checkout. The reference embeds roleId so the
 * webhook handler can resolve it without a scan or an extra index — see
 * docs/DATA_MODEL.md. Re-initializing on an idempotent retry (order already
 * pending, not yet paid) is safe: Paystack allows re-initializing an
 * incomplete reference and returns a fresh authorization_url each time.
 */
export async function requestKitOrder(
  employerId: string,
  roleId: string,
  idempotencyKey: string,
  deps: KitDependencies,
): Promise<{ order: KitOrder; created: boolean; authorizationUrl: string }> {
  // The payments kill switch, checked before anything is created and before
  // Paystack is contacted.
  //
  // The `payments` flag existed in the schema, was written to Parameter
  // Store by every environment, and was read by nothing — so switching it
  // off stopped no payment anywhere. Found in a 2026-08-27 audit, alongside
  // the same hole in `contactUnlocks` and `publicDiscovery`. A flag that
  // gates nothing is worse than no flag: it is a control an operator
  // believes they have.
  const flags = await deps.getFeatureFlags();
  if (!flags.payments) {
    throw new ForbiddenError('Kit purchases are currently unavailable. Nothing has been charged.');
  }

  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');

  const existing = await deps.getKitOrderForRole(roleId);
  if (existing) throw new ConflictError('This role already has a paid Kit');

  const now = deps.clock.now().toISOString();
  // Built per attempt, because a dead checkout needs a genuinely new id
  // and reference rather than a reuse of the old one.
  const buildOrder = (id: string): KitOrder => ({
    id,
    employerId,
    roleId,
    amountNGN: KIT_PRICE_NGN,
    checkoutUrl: null,
    status: 'pending',
    paystackReference: `${roleId}.${id}`,
    createdAt: now,
  });

  let { order: stored, created } = await deps.createKitOrderIfNotExists(
    buildOrder(randomUUID()),
    idempotencyKey,
  );

  // A failed order cannot be resumed, so the next press opens a new one.
  //
  // Paystack pins an outcome to a reference: one that declined stays
  // declined, and its checkout URL can only decline again. Returning that
  // URL to somebody pressing the button a second time leaves them
  // permanently unable to buy — a worse failure than the duplicate row
  // the idempotency key exists to prevent.
  //
  // `succeeded` is excluded: the guard above already refuses a role that
  // has a paid Kit, and minting a fresh reference for somebody who has
  // paid is how a customer is charged twice.
  for (let round = 2; !created && stored.status === 'failed'; round += 1) {
    if (round > MAX_CHECKOUT_ROUNDS) break;
    ({ order: stored, created } = await deps.createKitOrderIfNotExists(
      buildOrder(randomUUID()),
      `${idempotencyKey}#${round}`,
    ));
  }

  // Written after the order and before Paystack, for the same reason the
  // order itself is: a row has to exist for a checkout nobody completes.
  // Keyed by the same client idempotency key, in a different partition, so
  // a retry returns the first attempt rather than opening a second.
  await deps.createPaymentAttemptIfNotExists(
    {
      id: stored.id,
      employerId,
      purpose: 'kit',
      reference: stored.paystackReference,
      checkoutUrl: null,
      paystackTransactionId: null,
      amountNGN: stored.amountNGN,
      currency: 'NGN',
      status: 'initialized',
      paystackStatus: null,
      channel: null,
      gatewayResponse: null,
      failureReason: null,
      planCode: null,
      plan: null,
      interval: null,
      priceTier: null,
      roleId,
      subscriptionCode: null,
      customerCode: null,
      correlationId: randomUUID(),
      verifiedAt: null,
      reconcileAttempts: 0,
      createdAt: stored.createdAt,
      updatedAt: now,
    },
    idempotencyKey,
  );

  // A repeat of the same idempotency key resumes the checkout it already
  // opened, and does not ask Paystack for a second one.
  //
  // The line below used to initialize unconditionally, under a comment
  // saying a retry was safe because Paystack would hand back a fresh URL
  // for the same reference. It does not: `POST /transaction/initialize`
  // answers "Duplicate Transaction Reference", measured against the real
  // API. So the retry the Idempotency-Key header exists to make safe was
  // the one request guaranteed to fail, with a 502 shown to a buyer whose
  // first click had in fact worked.
  if (!created) {
    // Somebody else owns this reference, so this request must never
    // initialize it: Paystack permits one initialize per reference and
    // refuses the second. Sequentially the URL is already stored.
    // Concurrently — a double click, or two tabs — the winner may still
    // be talking to Paystack, so this waits for it rather than racing it
    // to the provider, and says so plainly if it never appears.
    const resumed = stored.checkoutUrl
      ? stored
      : await waitForKitCheckoutUrl(roleId, stored.id, deps);

    if (resumed?.checkoutUrl) {
      return { order: resumed, created, authorizationUrl: resumed.checkoutUrl };
    }

    throw new ConflictError(
      'That checkout is still opening. Wait a moment and try again. Nothing has been charged.',
    );
  }

  const email = await deps.getEmployerEmail(employerId);
  const { authorizationUrl } = await deps.initializeTransaction({
    email,
    amountKobo: stored.amountNGN * 100,
    reference: stored.paystackReference,
    callbackUrl: `${deps.appOrigin}/employer/role?id=${roleId}`,
  });

  // Recorded so the retry above has something to return. Failing to store
  // it is not worth losing a started checkout over: the buyer already has
  // the URL in this response.
  const withUrl = await deps.setKitOrderCheckoutUrl(roleId, stored.id, authorizationUrl);

  return { order: withUrl ?? stored, created, authorizationUrl };
}

/**
 * Called once, synchronously, right after a webhook confirms a Kit order
 * succeeded. Every call creates a new, immutable version — never
 * overwrites a prior one (docs/DATA_MODEL.md's KitArtifact entity).
 */
/**
 * How many checkouts one idempotency key may open. Each round happens
 * only because the previous one died, so this bounds a card that keeps
 * declining rather than a buyer trying honestly.
 */
const MAX_CHECKOUT_ROUNDS = 4;

/**
 * Waits out the window where a concurrent request created the order but
 * has not finished storing where it sent the buyer. Bounded: the gap is
 * one Paystack initialize, and a Lambda that waits longer than this is
 * worse than one that asks the buyer to press the button again.
 */
async function waitForKitCheckoutUrl(
  roleId: string,
  kitOrderId: string,
  deps: Pick<KitDependencies, 'getKitOrder'>,
): Promise<KitOrder | null> {
  for (const delayMs of [250, 500, 1000]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const latest = await deps.getKitOrder(roleId, kitOrderId);
    if (latest?.checkoutUrl) return latest;
  }
  return null;
}

export async function generateKitArtifact(
  roleId: string,
  deps: KitDependencies,
): Promise<KitArtifact> {
  const result = await deps.getRole(roleId);
  if (!result) throw new NotFoundError('Role not found');

  const latest = await deps.getLatestArtifact(roleId);
  const nextVersion = (latest?.version ?? 0) + 1;
  const now = deps.clock.now();
  const deliverables = generateKitDeliverables(result.role, now);
  const html = renderKitHtmlDocument(result.role, deliverables);

  const artifact: KitArtifact = {
    roleId,
    version: nextVersion,
    templateVersion: deliverables.version,
    html,
    generatedAt: now.toISOString(),
  };
  await deps.createArtifact(artifact);
  return artifact;
}

/** Regeneration requires an already-succeeded order — never free. */
export async function regenerateKitArtifact(
  employerId: string,
  roleId: string,
  deps: KitDependencies,
): Promise<KitArtifact> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');

  const order = await deps.getKitOrderForRole(roleId);
  if (!order) throw new ForbiddenError('No paid Kit exists for this role yet');

  return generateKitArtifact(roleId, deps);
}

/**
 * Read-only status check — closes a real gap found in a 2026-08-26 audit:
 * the real-mode roles list and role detail page had nowhere to check
 * whether a Kit had actually been purchased, so both omitted the
 * Kit-status badge entirely rather than guess. `getKitOrderForRole` only
 * ever returns a `succeeded` order by design (docs/DATA_MODEL.md: "a role
 * has few order attempts; takes the succeeded one") — a role with only
 * pending/failed attempts reports 'none', matching what the employer
 * actually cares about ("did I get the Kit"), not raw attempt history.
 */
export async function getKitOrderStatus(
  employerId: string,
  roleId: string,
  deps: Pick<KitDependencies, 'getRole' | 'getKitOrderForRole'>,
): Promise<{ status: 'succeeded' | 'none' }> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');

  const order = await deps.getKitOrderForRole(roleId);
  return { status: order ? 'succeeded' : 'none' };
}

export async function getKitForDownload(
  employerId: string,
  roleId: string,
  deps: Pick<KitDependencies, 'getRole' | 'getLatestArtifact'>,
): Promise<KitArtifact> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');

  const artifact = await deps.getLatestArtifact(roleId);
  if (!artifact) throw new NotFoundError('No Kit has been generated for this role yet');
  return artifact;
}
