import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  BillingCustomerSchema,
  BillingInvoiceSchema,
  BillingSubscriptionSchema,
  PaymentAttemptSchema,
  type BillingCustomer,
  type BillingInvoice,
  type BillingSubscription,
  type PaymentAttempt,
} from '@zoryvex/contracts';
import { isTerminalPayment } from '@zoryvex/contracts';
import { parsePaymentReference } from '../domain/payment-reference';
import { getKitOrder } from './kit-order-repository';
import { ddb, queryAllPages, tableName } from './dynamo-client';
import { isConditionalCheckFailed, isTransactionCanceledByCondition } from './dynamo-errors';

/**
 * Storage for the billing entities, on the same single table as everything
 * else (docs/DATA_MODEL.md).
 *
 * Two pointer items exist here that do not exist for any other entity, and
 * both are forced by the shape of Paystack's webhooks rather than by a
 * preference for denormalization:
 *
 * - `SUBCODE#<subscription_code>` → employerId. Every subscription and
 *   invoice event identifies its subject by subscription code. There is no
 *   employer id in a Paystack payload and never will be.
 * - `CUSCODE#<customer_code>` → employerId. A renewal charge arrives as
 *   `charge.success` carrying a reference Paystack generated itself, not
 *   the one we supplied at checkout, so the reference cannot be parsed back
 *   to an employer. The customer code is the only handle it carries.
 *
 * Without either pointer the correct behaviour on a renewal would be "we
 * received money and do not know whose it is", which is not a behaviour a
 * billing system may have.
 */

function paymentKey(employerId: string, attemptId: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: `PAYMENT#${attemptId}` };
}

/**
 * A sparse projection onto the existing GSI2, carrying only the payment
 * attempts that have not reached an outcome yet.
 *
 * Reconciliation has to be able to ask "which payments are still open"
 * across every employer, and this codebase does not permit a Scan — for
 * good reason, since one would read the whole table to find a handful of
 * rows. Writing the index keys only while an attempt is unsettled, and
 * removing them the moment it settles, keeps the index the size of the
 * work outstanding rather than the size of the history.
 *
 * The sort key is the creation time, so the query can be bounded to
 * attempts old enough that a buyer would have finished by now, rather than
 * checking a checkout somebody is still looking at.
 */
function openPaymentIndexKeys(attempt: PaymentAttempt) {
  return { GSI2PK: 'PAYMENTS_OPEN', GSI2SK: `${attempt.createdAt}#${attempt.id}` };
}

function subscriptionKey(employerId: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: 'SUBSCRIPTION' };
}

function invoiceKey(employerId: string, invoiceCode: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: `INVOICE#${invoiceCode}` };
}

function customerKey(employerId: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: 'BILLINGCUSTOMER' };
}

function subscriptionPointerKey(subscriptionCode: string) {
  return { PK: `SUBCODE#${subscriptionCode}`, SK: 'POINTER' };
}

function customerPointerKey(customerCode: string) {
  return { PK: `CUSCODE#${customerCode}`, SK: 'POINTER' };
}

/**
 * Strips the DynamoDB key attributes before validating.
 *
 * Parsing through the schema on the way out rather than casting is what
 * makes a field added to the schema and forgotten in a repository fail
 * loudly. It already failed quietly once: `priceNGN` and `foundingMember`
 * were added to `EntitlementSchema` and never added to
 * employer-repository's hand-listed projection, so both silently read back
 * as their defaults on the real backend.
 */
const DYNAMO_KEY_ATTRIBUTES = ['PK', 'SK', 'GSI2PK', 'GSI2SK'];

function withoutKeys(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).filter(([name]) => !DYNAMO_KEY_ATTRIBUTES.includes(name)),
  );
}

/**
 * Writes a payment attempt before Paystack is contacted, refusing to
 * overwrite one that already exists.
 *
 * The order matters and is the whole point: a row exists for every
 * checkout that was ever started, including the ones nobody completed.
 * Paystack sends no webhook for an abandoned checkout, so if the row were
 * written on success there would be no record at all that a buyer tried
 * and stopped — which is exactly the case the founder needs to see when
 * somebody says they paid.
 */
export async function createPaymentAttempt(attempt: PaymentAttempt): Promise<PaymentAttempt> {
  const validated = PaymentAttemptSchema.parse(attempt);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...paymentKey(validated.employerId, validated.id),
        ...openPaymentIndexKeys(validated),
        ...validated,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  return validated;
}

/**
 * The idempotency-key guard for "the buyer pressed Subscribe twice".
 *
 * Two items in one transaction: the attempt itself, and a key item that
 * can only be written once. A duplicate request loses the transaction and
 * is handed back the attempt the first one created, so a double click, a
 * refresh, or a retried request after a dropped connection produces one
 * checkout and one charge rather than two.
 */
export async function createPaymentAttemptIfNotExists(
  attempt: PaymentAttempt,
  idempotencyKey: string,
): Promise<{ attempt: PaymentAttempt; created: boolean }> {
  const validated = PaymentAttemptSchema.parse(attempt);
  const keyItem = {
    PK: `EMPLOYER#${validated.employerId}`,
    SK: `PAYMENT_IDEMPOTENCY#${idempotencyKey}`,
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName(),
              Item: { ...keyItem, paymentAttemptId: validated.id },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                ...paymentKey(validated.employerId, validated.id),
                ...openPaymentIndexKeys(validated),
                ...validated,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return { attempt: validated, created: true };
  } catch (error) {
    if (!isTransactionCanceledByCondition(error)) throw error;

    const existingKey = await ddb.send(new GetCommand({ TableName: tableName(), Key: keyItem }));
    const existingId = existingKey.Item?.paymentAttemptId;
    if (typeof existingId === 'string') {
      const existing = await getPaymentAttempt(validated.employerId, existingId);
      if (existing) return { attempt: existing, created: false };
    }
    throw error;
  }
}

export async function getPaymentAttempt(
  employerId: string,
  attemptId: string,
): Promise<PaymentAttempt | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: paymentKey(employerId, attemptId) }),
  );
  if (!result.Item) return null;
  return PaymentAttemptSchema.parse(withoutKeys(result.Item));
}

/** Newest first. An employer has tens of these, not thousands. */
export async function listPaymentAttempts(employerId: string): Promise<PaymentAttempt[]> {
  const items = await queryAllPages({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `EMPLOYER#${employerId}`, ':prefix': 'PAYMENT#' },
  });
  return items
    .map((item) => PaymentAttemptSchema.parse(withoutKeys(item)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/**
 * Applies a patch only while the attempt is still in the status the caller
 * read.
 *
 * The condition is the race guard. A `charge.success` webhook and a
 * reconciliation pass can both be looking at the same attempt at the same
 * moment; without it, whichever finishes second wins, and "second" is
 * decided by network timing rather than by which one is right. With it,
 * the loser's write is rejected and it re-reads instead of overwriting a
 * settled outcome.
 */
export async function updatePaymentAttempt(
  employerId: string,
  attemptId: string,
  expectedStatus: PaymentAttempt['status'],
  patch: Partial<
    Pick<
      PaymentAttempt,
      | 'status'
      | 'paystackStatus'
      | 'paystackTransactionId'
      | 'channel'
      | 'gatewayResponse'
      | 'failureReason'
      | 'subscriptionCode'
      | 'customerCode'
      | 'planCode'
      | 'verifiedAt'
      | 'reconcileAttempts'
    >
  >,
  updatedAt: string,
): Promise<PaymentAttempt | null> {
  const setClauses = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt', '#status': 'status' };
  const values: Record<string, unknown> = { ':updatedAt': updatedAt, ':expected': expectedStatus };

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    setClauses.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  // Settling an attempt drops it out of the open-payments index in the
  // same write that settles it. Doing it separately would leave a window
  // in which reconciliation could pick up a payment that had just been
  // resolved and verify it again for nothing — and, worse, a window in
  // which a crash between the two writes leaves a settled payment on the
  // reconciliation list forever.
  const settles = patch.status !== undefined && isTerminalPayment(patch.status);
  if (settles) {
    names['#gsi2pk'] = 'GSI2PK';
    names['#gsi2sk'] = 'GSI2SK';
  }
  const removeClause = settles ? ' REMOVE #gsi2pk, #gsi2sk' : '';

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: paymentKey(employerId, attemptId),
        UpdateExpression: `SET ${setClauses.join(', ')}${removeClause}`,
        ConditionExpression: 'attribute_exists(PK) AND #status = :expected',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return PaymentAttemptSchema.parse(withoutKeys(result.Attributes ?? {}));
  } catch (error) {
    // Somebody else moved it first. The caller re-reads and decides; it is
    // never an error worth failing a webhook over.
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

/**
 * Stores the subscription and the code pointer atomically.
 *
 * Both or neither: a subscription written without its pointer is a
 * subscription whose renewal events cannot be attributed to anyone, and a
 * pointer written without its subscription points at nothing.
 */
export async function putBillingSubscription(
  subscription: BillingSubscription,
): Promise<BillingSubscription> {
  const validated = BillingSubscriptionSchema.parse(subscription);
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { ...subscriptionKey(validated.employerId), ...validated },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...subscriptionPointerKey(validated.subscriptionCode),
              employerId: validated.employerId,
            },
          },
        },
      ],
    }),
  );
  return validated;
}

export async function getBillingSubscription(
  employerId: string,
): Promise<BillingSubscription | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: subscriptionKey(employerId) }),
  );
  if (!result.Item) return null;
  return BillingSubscriptionSchema.parse(withoutKeys(result.Item));
}

export async function employerIdForSubscriptionCode(
  subscriptionCode: string,
): Promise<string | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: subscriptionPointerKey(subscriptionCode) }),
  );
  const employerId = result.Item?.employerId;
  return typeof employerId === 'string' ? employerId : null;
}

export async function employerIdForCustomerCode(customerCode: string): Promise<string | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: customerPointerKey(customerCode) }),
  );
  const employerId = result.Item?.employerId;
  return typeof employerId === 'string' ? employerId : null;
}

export async function putBillingCustomer(customer: BillingCustomer): Promise<BillingCustomer> {
  const validated = BillingCustomerSchema.parse(customer);
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { ...customerKey(validated.employerId), ...validated },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...customerPointerKey(validated.customerCode),
              employerId: validated.employerId,
            },
          },
        },
      ],
    }),
  );
  return validated;
}

export async function getBillingCustomer(employerId: string): Promise<BillingCustomer | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: customerKey(employerId) }),
  );
  if (!result.Item) return null;
  return BillingCustomerSchema.parse(withoutKeys(result.Item));
}

/**
 * Patches the stored subscription without replacing it wholesale.
 *
 * Webhook events each know a different subset of the truth — an
 * `invoice.payment_failed` knows the failure reason and nothing about the
 * card, a `subscription.not_renew` knows the status and nothing about the
 * period — so a full overwrite from any single event would erase whatever
 * the last one taught us.
 */
/**
 * Patch the employer's subscription, optionally only if it is still the
 * subscription the caller thinks it is.
 *
 * `expectedSubscriptionCode` exists because a subscription is stored one
 * per employer while Paystack keeps every subscription an employer has
 * ever had, and goes on sending events about the old ones. An employer who
 * cancels and subscribes again has two of them live at Paystack: the old
 * one runs to the end of the period it was paid for and is disabled on its
 * own next payment date, weeks after the new one started. That
 * `subscription.disable` names the old code, resolves to the same
 * employer, and without this condition writes `cancelled` over a
 * subscription the employer has just paid for.
 *
 * Same shape as `updatePaymentAttempt`'s `expectedStatus`, and for the
 * same reason: the guard belongs on the write, where nothing can race past
 * it, rather than in a read the caller does first.
 */
export async function updateBillingSubscription(
  employerId: string,
  patch: Partial<
    Pick<
      BillingSubscription,
      | 'status'
      | 'planCode'
      | 'plan'
      | 'interval'
      | 'priceTier'
      | 'priceNGN'
      | 'nextPaymentDate'
      | 'currentPeriodStart'
      | 'currentPeriodEnd'
      | 'graceEndsAt'
      | 'lastFailureReason'
      | 'card'
      | 'cancelRequestedAt'
      | 'emailToken'
    >
  >,
  updatedAt: string,
  expectedSubscriptionCode?: string,
): Promise<BillingSubscription | null> {
  const setClauses = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': updatedAt };

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    setClauses.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  const conditions = ['attribute_exists(PK)'];
  if (expectedSubscriptionCode !== undefined) {
    conditions.push('#subscriptionCode = :expectedSubscriptionCode');
    names['#subscriptionCode'] = 'subscriptionCode';
    values[':expectedSubscriptionCode'] = expectedSubscriptionCode;
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: subscriptionKey(employerId),
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: conditions.join(' AND '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return BillingSubscriptionSchema.parse(withoutKeys(result.Attributes ?? {}));
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

/**
 * Records where the buyer was sent to pay.
 *
 * Never overwrites a URL already stored: the first checkout opened is the
 * one a retry should return to, and a second one would be a second
 * Paystack transaction for the same money.
 */
export async function setPaymentAttemptCheckoutUrl(
  employerId: string,
  attemptId: string,
  checkoutUrl: string,
): Promise<PaymentAttempt | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: paymentKey(employerId, attemptId),
        UpdateExpression: 'SET checkoutUrl = :url',
        ConditionExpression:
          'attribute_exists(PK) AND (attribute_not_exists(checkoutUrl) OR checkoutUrl = :null)',
        ExpressionAttributeValues: { ':url': checkoutUrl, ':null': null },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return PaymentAttemptSchema.parse(withoutKeys(result.Attributes ?? {}));
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

export async function putBillingInvoice(invoice: BillingInvoice): Promise<BillingInvoice> {
  const validated = BillingInvoiceSchema.parse(invoice);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...invoiceKey(validated.employerId, validated.invoiceCode), ...validated },
    }),
  );
  return validated;
}

export async function getBillingInvoice(
  employerId: string,
  invoiceCode: string,
): Promise<BillingInvoice | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: invoiceKey(employerId, invoiceCode) }),
  );
  if (!result.Item) return null;
  return BillingInvoiceSchema.parse(withoutKeys(result.Item));
}

/** Newest first, for the billing page's history and the founder's diagnostic view. */
export async function listBillingInvoices(employerId: string): Promise<BillingInvoice[]> {
  const items = await queryAllPages({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `EMPLOYER#${employerId}`, ':prefix': 'INVOICE#' },
  });
  return items
    .map((item) => BillingInvoiceSchema.parse(withoutKeys(item)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Every payment attempt that has not reached an outcome, created before
 * `createdBefore`.
 *
 * The bound is what stops reconciliation racing a live checkout. A buyer
 * who is halfway through entering a card has an `initialized` row, and
 * asking Paystack about it and writing `abandoned` on the answer would
 * settle a payment that is still happening. Only attempts old enough that
 * a hosted checkout session has expired are looked at.
 */
export async function listOpenPaymentAttempts(createdBefore: string): Promise<PaymentAttempt[]> {
  const items = await queryAllPages({
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK < :before',
    ExpressionAttributeValues: { ':pk': 'PAYMENTS_OPEN', ':before': createdBefore },
  });
  return items.map((item) => PaymentAttemptSchema.parse(withoutKeys(item)));
}

/**
 * Finds a payment attempt from a reference alone, for reconciliation
 * reading Paystack's side of the ledger.
 *
 * Parsing rather than indexing, because the reference is built from the
 * employer id and the attempt id and nothing is gained by storing a third
 * copy of both. A reference that does not parse belongs to something this
 * system did not create, which is itself the finding.
 */
export async function findPaymentAttemptByReference(
  reference: string,
): Promise<PaymentAttempt | null> {
  const parsed = parsePaymentReference(reference);
  if (!parsed) return null;
  if (parsed.kind === 'subscription') {
    return getPaymentAttempt(parsed.employerId, parsed.attemptId);
  }

  // A Kit reference names the role and the order but not the employer, and
  // the attempt is stored under the employer. The kit order is the hop
  // between them, and its absence is itself the finding: a Paystack payment
  // against a kit reference with no order behind it is money this system
  // cannot account for.
  const order = await getKitOrder(parsed.roleId, parsed.kitOrderId);
  if (!order) return null;
  return getPaymentAttempt(order.employerId, parsed.kitOrderId);
}
