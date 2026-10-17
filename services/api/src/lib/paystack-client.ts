import { PaymentProviderError } from '../errors/typed-errors';
import { billingLog } from './billing-log';

const PAYSTACK_API_BASE = 'https://api.paystack.co';

/**
 * Every outbound Paystack call this codebase makes.
 *
 * All of them are server-side only: the secret key comes from
 * `ssm-secure-repository.ts`'s `getPaystackSecretKey()`, is read fresh per
 * call, and is never logged, never returned to a caller and never sent to
 * a browser. Nothing in `apps/web` imports this module; the public key is
 * not used at all, because checkout is a redirect to Paystack's own hosted
 * page rather than an inline widget.
 *
 * The endpoints, parameters and response fields below were read from
 * Paystack's current API reference on 2026-09-01. Where a shape is
 * asserted, it is asserted from that reading; nothing here is guessed.
 */

/**
 * How long to wait for Paystack before giving up.
 *
 * Chosen against Paystack's own webhook timeout (30 seconds in test mode)
 * and against the fact that this often runs inside a webhook handler that
 * must answer 200 quickly or be retried for 72 hours. Ten seconds is long
 * enough for a cold TLS handshake to Ireland and short enough that two
 * sequential calls plus a DynamoDB write still fit comfortably.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Attempts, not retries: 1 means "try once, do not retry". */
const DEFAULT_ATTEMPTS = 1;
const RETRYABLE_ATTEMPTS = 3;

interface PaystackEnvelope<T> {
  status: boolean;
  message?: string;
  data?: T;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  secretKey: string;
  // `| undefined` spelled out because this package compiles with
  // exactOptionalPropertyTypes, which distinguishes "absent" from
  // "present and undefined" — and every call site here forwards an
  // optional argument straight through.
  correlationId?: string | undefined;
  /**
   * Whether re-sending this exact request can only ever produce the same
   * outcome.
   *
   * This is a per-call decision and never a default, because the two
   * halves of the Subscriptions API sit on opposite sides of it.
   * `POST /subscription/disable` is safe: disabling an already-disabled
   * subscription is a no-op. `POST /subscription` is not: a retry after a
   * response that was actually delivered creates a second subscription and
   * bills the customer twice, and Paystack has no idempotency-key header
   * to prevent it. Retrying by default would eventually double-charge
   * somebody.
   */
  retryable?: boolean;
}

function isRetryableStatus(status: number): boolean {
  // 429 and 5xx are the provider asking to be tried again. A 4xx is
  // Paystack telling us the request itself is wrong, and repeating it
  // cannot make it right.
  return status === 429 || status >= 500;
}

async function paystackRequest<T>(options: RequestOptions): Promise<T> {
  const attempts = options.retryable ? RETRYABLE_ATTEMPTS : DEFAULT_ATTEMPTS;
  let lastProblem = 'unknown error';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${PAYSTACK_API_BASE}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });

      const parsed = (await response.json().catch(() => null)) as PaystackEnvelope<T> | null;

      if (response.ok && parsed?.status && parsed.data !== undefined) {
        return parsed.data;
      }

      // `status: false` with a 200 is a real Paystack shape — the HTTP
      // layer succeeded and the operation did not. Treated as a rejection,
      // not a transport failure, so it is never retried.
      lastProblem = parsed?.message ?? `HTTP ${response.status} ${response.statusText}`;
      if (!isRetryableStatus(response.status) || attempt === attempts) break;
      billingLog.warn('paystack request failed, retrying', {
        correlationId: options.correlationId,
        path: options.path,
        httpStatus: response.status,
        attempt,
      });
    } catch (error) {
      // AbortError from the timeout above, DNS failure, connection reset.
      lastProblem =
        (error as Error).name === 'AbortError'
          ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
          : (error as Error).message;
      if (attempt === attempts) break;
      billingLog.warn('paystack request errored, retrying', {
        correlationId: options.correlationId,
        path: options.path,
        problem: lastProblem,
        attempt,
      });
    } finally {
      clearTimeout(timer);
    }

    // Exponential backoff with full jitter. Jitter matters here because
    // reconciliation verifies a batch of references in sequence: without
    // it, a Paystack blip lines every retry in the batch up on the same
    // millisecond and re-creates the burst that caused the 429.
    const backoff = 200 * 2 ** (attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, Math.random() * backoff));
  }

  throw new PaymentProviderError(
    `Paystack ${options.method} ${options.path} failed: ${lastProblem}`,
  );
}

export interface InitializeTransactionInput {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  /** A Paystack plan code. Present only when this transaction starts a subscription. */
  planCode?: string;
  /**
   * Arbitrary data echoed back on the transaction and on `charge.success`.
   *
   * Used only for values that are already ours and already in the
   * reference — never for anything private. Metadata is visible on the
   * Paystack dashboard and comes back through a webhook, so a candidate
   * email or an evidence detail must never be put here.
   */
  metadata?: Record<string, string>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackAuthorization {
  last4?: string;
  brand?: string;
  exp_month?: string;
  exp_year?: string;
  channel?: string;
}

export interface VerifyTransactionResult {
  status: string;
  reference: string;
  amountKobo: number;
  currency: string;
  transactionId: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  customerCode: string | null;
  customerEmail: string | null;
  planCode: string | null;
  authorization: PaystackAuthorization | null;
}

/**
 * Creates the hosted-checkout URL the buyer is redirected to.
 *
 * Retryable on purpose. The reference is supplied by us and is unique per
 * payment attempt, and Paystack allows re-initializing an incomplete
 * reference — so a retry after a timeout either reaches the same
 * unfinished transaction or creates the one the first attempt failed to.
 * It cannot produce two charges, because a reference can only be paid
 * once.
 */
export async function initializePaystackTransaction(
  input: InitializeTransactionInput,
  secretKey: string,
  correlationId?: string,
): Promise<InitializeTransactionResult> {
  const data = await paystackRequest<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>({
    method: 'POST',
    path: '/transaction/initialize',
    secretKey,
    correlationId,
    retryable: true,
    body: {
      email: input.email,
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      callback_url: input.callbackUrl,
      ...(input.planCode ? { plan: input.planCode } : {}),
      // Paystack documents this parameter as a stringified JSON object.
      ...(input.metadata ? { metadata: JSON.stringify(input.metadata) } : {}),
    },
  });

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

interface RawTransaction {
  id?: number | string;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  channel?: string | null;
  gateway_response?: string | null;
  paid_at?: string | null;
  paidAt?: string | null;
  customer?: { customer_code?: string; email?: string } | null;
  plan?: string | { plan_code?: string } | null;
  authorization?: PaystackAuthorization | null;
}

/**
 * `data.plan` is a string plan code on some transaction shapes and an
 * object on others (the Verify response returns `plan_object` separately
 * and `plan` as a code, while List Transactions returns `plan` as an
 * object). Both are accepted; anything else reads as absent rather than
 * being coerced into a wrong code.
 */
function planCodeOf(plan: RawTransaction['plan']): string | null {
  if (typeof plan === 'string') return plan.length > 0 ? plan : null;
  if (plan && typeof plan === 'object' && typeof plan.plan_code === 'string') return plan.plan_code;
  return null;
}

function toVerifyResult(data: RawTransaction): VerifyTransactionResult {
  return {
    status: String(data.status ?? ''),
    reference: String(data.reference ?? ''),
    amountKobo: Number(data.amount ?? 0),
    currency: String(data.currency ?? ''),
    // Paystack's own changelog asks integrators to treat the transaction
    // id as an unsigned 64-bit integer. JavaScript numbers cannot hold one
    // exactly, so it is carried as a string everywhere and never parsed.
    transactionId: data.id === undefined || data.id === null ? null : String(data.id),
    channel: data.channel ?? null,
    gatewayResponse: data.gateway_response ?? null,
    paidAt: data.paid_at ?? data.paidAt ?? null,
    customerCode: data.customer?.customer_code ?? null,
    customerEmail: data.customer?.email ?? null,
    planCode: planCodeOf(data.plan),
    authorization: data.authorization ?? null,
  };
}

/**
 * Server-to-server confirmation of what actually happened, independent of
 * anything a browser or a webhook body claimed.
 *
 * Retryable: a GET that changes nothing.
 */
export async function verifyPaystackTransaction(
  reference: string,
  secretKey: string,
  correlationId?: string,
): Promise<VerifyTransactionResult> {
  const data = await paystackRequest<RawTransaction>({
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return toVerifyResult(data);
}

export interface PaystackSubscription {
  subscriptionCode: string;
  emailToken: string | null;
  customerCode: string | null;
  planCode: string | null;
  status: string;
  amountKobo: number;
  nextPaymentDate: string | null;
  createdAt: string | null;
  authorization: PaystackAuthorization | null;
  mostRecentInvoiceStatus: string | null;
  mostRecentInvoiceDescription: string | null;
}

interface RawSubscription {
  subscription_code?: string;
  email_token?: string;
  status?: string;
  amount?: number;
  next_payment_date?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  customer?: { customer_code?: string } | string | null;
  plan?: { plan_code?: string } | string | null;
  authorization?: PaystackAuthorization | null;
  most_recent_invoice?: { status?: string; description?: string | null } | null;
}

function customerCodeOf(customer: RawSubscription['customer']): string | null {
  if (typeof customer === 'string') return customer.startsWith('CUS_') ? customer : null;
  if (customer && typeof customer === 'object' && typeof customer.customer_code === 'string') {
    return customer.customer_code;
  }
  return null;
}

export function toPaystackSubscription(data: RawSubscription): PaystackSubscription {
  return {
    subscriptionCode: String(data.subscription_code ?? ''),
    emailToken: data.email_token ?? null,
    customerCode: customerCodeOf(data.customer),
    planCode: planCodeOf(data.plan as RawTransaction['plan']),
    status: String(data.status ?? ''),
    amountKobo: Number(data.amount ?? 0),
    nextPaymentDate: data.next_payment_date ?? null,
    createdAt: data.createdAt ?? data.created_at ?? null,
    authorization: data.authorization ?? null,
    mostRecentInvoiceStatus: data.most_recent_invoice?.status ?? null,
    mostRecentInvoiceDescription: data.most_recent_invoice?.description ?? null,
  };
}

/** `GET /subscription/:id_or_code`. Retryable: a read. */
export async function fetchPaystackSubscription(
  subscriptionCode: string,
  secretKey: string,
  correlationId?: string,
): Promise<PaystackSubscription> {
  const data = await paystackRequest<RawSubscription>({
    method: 'GET',
    path: `/subscription/${encodeURIComponent(subscriptionCode)}`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return toPaystackSubscription(data);
}

/**
 * `POST /subscription/disable`, which is how a subscription is cancelled.
 *
 * Both the code and the `email_token` are required; there is no
 * cancel-by-code-alone endpoint. Retryable because disabling a
 * subscription that is already disabled changes nothing.
 */
export async function disablePaystackSubscription(
  subscriptionCode: string,
  emailToken: string,
  secretKey: string,
  correlationId?: string,
): Promise<void> {
  await paystackRequest<unknown>({
    method: 'POST',
    path: '/subscription/disable',
    secretKey,
    correlationId,
    retryable: true,
    body: { code: subscriptionCode, token: emailToken },
  });
}

/** `POST /subscription/enable` — the exact inverse, same parameters. */
export async function enablePaystackSubscription(
  subscriptionCode: string,
  emailToken: string,
  secretKey: string,
  correlationId?: string,
): Promise<void> {
  await paystackRequest<unknown>({
    method: 'POST',
    path: '/subscription/enable',
    secretKey,
    correlationId,
    retryable: true,
    body: { code: subscriptionCode, token: emailToken },
  });
}

/**
 * `GET /subscription/:code/manage/link` — a short-lived link to Paystack's
 * own hosted page where the customer can replace the card on a
 * subscription or cancel it.
 *
 * Used instead of collecting card details anywhere in this product. The
 * page is Paystack's, on Paystack's domain, and the new card is tokenized
 * by Paystack with a small charge that Paystack immediately refunds. No
 * card number ever reaches this service.
 */
export async function generateSubscriptionManageLink(
  subscriptionCode: string,
  secretKey: string,
  correlationId?: string,
): Promise<string> {
  const data = await paystackRequest<{ link: string }>({
    method: 'GET',
    path: `/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return data.link;
}

export interface CreateSubscriptionInput {
  customerCode: string;
  planCode: string;
  /** ISO 8601. Used to start a plan change at the end of the paid period. */
  startDate?: string;
  authorizationCode?: string;
}

/**
 * `POST /subscription`.
 *
 * Explicitly NOT retryable. Paystack offers no idempotency key on this
 * endpoint, so a retry after a response that was actually delivered
 * creates a second subscription against the same card. A failure here is
 * surfaced and reconciled against `GET /subscription?customer=` rather
 * than blindly repeated.
 */
export async function createPaystackSubscription(
  input: CreateSubscriptionInput,
  secretKey: string,
  correlationId?: string,
): Promise<PaystackSubscription> {
  const data = await paystackRequest<RawSubscription>({
    method: 'POST',
    path: '/subscription',
    secretKey,
    correlationId,
    retryable: false,
    body: {
      customer: input.customerCode,
      plan: input.planCode,
      ...(input.startDate ? { start_date: input.startDate } : {}),
      ...(input.authorizationCode ? { authorization: input.authorizationCode } : {}),
    },
  });
  return toPaystackSubscription(data);
}

export interface PaystackPlanSummary {
  planCode: string;
  name: string;
  amountKobo: number;
  interval: string;
  currency: string;
}

interface RawPlan {
  plan_code?: string;
  name?: string;
  amount?: number;
  interval?: string;
  currency?: string;
}

function toPlanSummary(data: RawPlan): PaystackPlanSummary {
  return {
    planCode: String(data.plan_code ?? ''),
    name: String(data.name ?? ''),
    amountKobo: Number(data.amount ?? 0),
    interval: String(data.interval ?? ''),
    currency: String(data.currency ?? ''),
  };
}

/** `GET /plan/:id_or_code`. Used to prove a configured plan code is real and priced correctly. */
export async function fetchPaystackPlan(
  planCode: string,
  secretKey: string,
  correlationId?: string,
): Promise<PaystackPlanSummary> {
  const data = await paystackRequest<RawPlan>({
    method: 'GET',
    path: `/plan/${encodeURIComponent(planCode)}`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return toPlanSummary(data);
}

/** `GET /plan` — one page at a time, so a large integration cannot blow the Lambda's memory. */
export async function listPaystackPlans(
  secretKey: string,
  page = 1,
  perPage = 50,
  correlationId?: string,
): Promise<PaystackPlanSummary[]> {
  const data = await paystackRequest<RawPlan[]>({
    method: 'GET',
    path: `/plan?perPage=${perPage}&page=${page}`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return data.map(toPlanSummary);
}

/**
 * `GET /transaction?status=&from=&to=` — the reconciliation read.
 *
 * This is the only way to learn about the outcomes Paystack never
 * webhooks: an abandoned checkout and a failed card both leave no trace
 * except a row here.
 */
export async function listPaystackTransactions(
  input: { status?: string; from?: string; to?: string; page?: number; perPage?: number },
  secretKey: string,
  correlationId?: string,
): Promise<VerifyTransactionResult[]> {
  const query = new URLSearchParams();
  query.set('perPage', String(input.perPage ?? 50));
  query.set('page', String(input.page ?? 1));
  if (input.status) query.set('status', input.status);
  if (input.from) query.set('from', input.from);
  if (input.to) query.set('to', input.to);

  const data = await paystackRequest<RawTransaction[]>({
    method: 'GET',
    path: `/transaction?${query.toString()}`,
    secretKey,
    correlationId,
    retryable: true,
  });
  return data.map(toVerifyResult);
}
