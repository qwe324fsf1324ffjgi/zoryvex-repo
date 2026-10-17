import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import { KIT_PRICE_NGN, type KitOrder, type PaymentAttempt, type Role } from '@zoryvex/contracts';
import {
  generateKitArtifact,
  getKitForDownload,
  getKitOrderStatus,
  getKitPreview,
  regenerateKitArtifact,
  requestKitOrder,
  type KitDependencies,
} from '../src/domain/kit-service';
import type { KitArtifact } from '../src/repositories/kit-artifact-repository';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentProviderError,
} from '../src/errors/typed-errors';

const OWNER_EMPLOYER_ID = 'emp_owner';
const OTHER_EMPLOYER_ID = 'emp_other';
const ROLE_ID = 'role_1';
const OWNER_EMAIL = 'employer@example.invalid';

const role: Role = {
  id: ROLE_ID,
  employerId: OWNER_EMPLOYER_ID,
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra reliably',
  mustHaveWork: ['Terraform'],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-19T00:00:00.000Z',
};

function createFakes(
  overrides: {
    initializeTransaction?: KitDependencies['initializeTransaction'];
    payments?: boolean;
  } = {},
) {
  let kitOrder: KitOrder | null = null;
  const ordersByKey = new Map<string, KitOrder>();
  const artifacts: KitArtifact[] = [];
  const initializeCalls: Parameters<KitDependencies['initializeTransaction']>[0][] = [];
  const paymentAttempts: PaymentAttempt[] = [];

  const deps: KitDependencies = {
    clock: { now: () => new Date('2026-08-19T00:00:00.000Z') },
    async getFeatureFlags() {
      return { ...DEFAULT_FEATURE_FLAGS, payments: overrides.payments ?? true };
    },
    async getRole(roleId) {
      return roleId === ROLE_ID ? { role, version: 1 } : null;
    },
    async getKitOrderForRole() {
      // Only a succeeded order, exactly as the repository does:
      // `items.find((o) => o.status === 'succeeded')`. Returning a pending
      // one made every retry look like "this role already has a paid Kit",
      // which is why the retry path went untested — and it is not what the
      // real system does, as the live API showed by answering 502 rather
      // than 409.
      return kitOrder?.status === 'succeeded' ? kitOrder : null;
    },
    async createKitOrderIfNotExists(order, idempotencyKey) {
      // Keyed by the idempotency key, as the repository is: it writes a
      // KITORDER_IDEMPOTENCY#<key> item alongside the order and hands back
      // the first order only when that exact key is seen again. Ignoring
      // the key here made every call look like a repeat, which hid the
      // fact that a new key opens a new checkout.
      const seen = ordersByKey.get(idempotencyKey);
      if (seen) return { order: seen, created: false };
      ordersByKey.set(idempotencyKey, order);
      kitOrder = order;
      return { order, created: true };
    },
    async getKitOrder(_roleId, kitOrderId) {
      return kitOrder?.id === kitOrderId ? kitOrder : null;
    },
    async setKitOrderCheckoutUrl(_roleId, _kitOrderId, checkoutUrl) {
      if (!kitOrder) return null;
      // Mirrors the repository's conditional write: the first URL stored
      // is the one kept, because a second would be a second checkout.
      if (kitOrder.checkoutUrl) return kitOrder;
      kitOrder = { ...kitOrder, checkoutUrl };
      return kitOrder;
    },
    async getLatestArtifact() {
      return artifacts.at(-1) ?? null;
    },
    async createArtifact(artifact) {
      artifacts.push(artifact);
    },
    async createPaymentAttemptIfNotExists(attempt) {
      paymentAttempts.push(attempt);
      return { attempt, created: true };
    },
    async getEmployerEmail() {
      return OWNER_EMAIL;
    },
    initializeTransaction:
      overrides.initializeTransaction ??
      (async (input) => {
        initializeCalls.push(input);
        return { authorizationUrl: `https://checkout.paystack.com/${input.reference}` };
      }),
    appOrigin: 'https://test.zoryvex.space',
  };

  return {
    deps,
    artifacts,
    initializeCalls,
    paymentAttempts,
    setSucceededOrder: (order: KitOrder) => {
      kitOrder = order;
      for (const [key, existing] of ordersByKey) {
        if (existing.id === order.id) ordersByKey.set(key, order);
      }
    },
  };
}

describe('getKitPreview', () => {
  it("returns a preview for the role's own employer", async () => {
    const { deps } = createFakes();
    const preview = await getKitPreview(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(preview.gaps).toEqual(['Terraform']);
  });

  it('throws NotFoundError for a role belonging to another employer (no cross-tenant read)', async () => {
    const { deps } = createFakes();
    await expect(getKitPreview(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('the identical error covers both "not mine" and "does not exist"', async () => {
    const { deps } = createFakes();
    let notMineMessage: string | undefined;
    try {
      await getKitPreview(OTHER_EMPLOYER_ID, ROLE_ID, deps);
    } catch (e) {
      notMineMessage = e instanceof Error ? e.message : undefined;
    }
    let neverExistedMessage: string | undefined;
    try {
      await getKitPreview(OTHER_EMPLOYER_ID, 'never-existed', deps);
    } catch (e) {
      neverExistedMessage = e instanceof Error ? e.message : undefined;
    }
    expect(notMineMessage).toBe(neverExistedMessage);
  });
});

describe('requestKitOrder', () => {
  it('creates a pending order for the owning employer and returns a real authorization URL', async () => {
    const { deps, initializeCalls } = createFakes();
    const { order, created, authorizationUrl } = await requestKitOrder(
      OWNER_EMPLOYER_ID,
      ROLE_ID,
      'idem-1',
      deps,
    );
    expect(created).toBe(true);
    expect(order.status).toBe('pending');
    expect(order.amountNGN).toBe(KIT_PRICE_NGN);
    expect(authorizationUrl).toBe(`https://checkout.paystack.com/${order.paystackReference}`);
    expect(initializeCalls).toEqual([
      {
        email: OWNER_EMAIL,
        // Kobo is Paystack's smallest currency unit. Derived rather than
        // written out, so a price change cannot leave the site advertising
        // one figure while the charge goes out as another.
        amountKobo: KIT_PRICE_NGN * 100,
        reference: order.paystackReference,
        callbackUrl: `https://test.zoryvex.space/employer/role?id=${ROLE_ID}`,
      },
    ]);
  });

  /**
   * Paystack initializes a reference once. The second call answers
   * "Duplicate Transaction Reference" — measured against the real API with
   * a real test key — so the retry that the Idempotency-Key header exists
   * to make safe was the one request guaranteed to fail, handing a 502 to
   * a buyer whose first click had worked.
   */
  it('resumes the checkout on a retry instead of asking Paystack for a second one', async () => {
    const { deps, initializeCalls } = createFakes();
    const first = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);
    const second = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);

    expect(initializeCalls).toHaveLength(1);
    expect(second.authorizationUrl).toBe(first.authorizationUrl);
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
  });

  /**
   * Paystack pins an outcome to a reference: one that declined stays
   * declined. Returning the stored URL after a decline leaves the buyer
   * permanently unable to buy the Kit.
   */
  it('opens a fresh checkout after the previous one failed', async () => {
    const { deps, initializeCalls, setSucceededOrder } = createFakes();
    const first = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);

    // The card declined. Paystack sends no webhook for that; the order is
    // settled as failed by reconciliation or the callback.
    setSucceededOrder({ ...first.order, status: 'failed' });

    const second = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);

    expect(second.created).toBe(true);
    expect(second.order.paystackReference).not.toBe(first.order.paystackReference);
    expect(initializeCalls).toHaveLength(2);
  });

  /** The double click as it happens: both in flight at once. */
  it('two concurrent requests with one key open one checkout', async () => {
    const { deps, initializeCalls } = createFakes();
    const [first, second] = await Promise.all([
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps),
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps),
    ]);

    expect(initializeCalls).toHaveLength(1);
    expect(first.authorizationUrl).toBe(second.authorizationUrl);
    expect(first.order.id).toBe(second.order.id);
  });

  it('refuses a second initialize the way Paystack does, and still resumes', async () => {
    const seen = new Set<string>();
    const { deps } = createFakes({
      initializeTransaction: async (input) => {
        if (seen.has(input.reference)) {
          throw new Error(
            'Paystack POST /transaction/initialize failed: Duplicate Transaction Reference',
          );
        }
        seen.add(input.reference);
        return { authorizationUrl: 'https://checkout.paystack.com/kit123' };
      },
    });

    const first = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);
    // Would throw if the retry path reached Paystack again.
    const second = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);
    expect(second.authorizationUrl).toBe(first.authorizationUrl);
  });

  it('rejects a request for a role belonging to another employer', async () => {
    const { deps } = createFakes();
    await expect(
      requestKitOrder(OTHER_EMPLOYER_ID, ROLE_ID, 'idem-1', deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the role already has a paid Kit — never a second charge', async () => {
    const { deps, setSucceededOrder } = createFakes();
    setSucceededOrder({
      id: 'existing',
      employerId: OWNER_EMPLOYER_ID,
      roleId: ROLE_ID,
      amountNGN: 29000,
      checkoutUrl: null,
      status: 'succeeded',
      paystackReference: `${ROLE_ID}.existing`,
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    await expect(
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'idem-2', deps),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('propagates a PaymentProviderError truthfully when Paystack is unreachable, never granting a fake authorization URL', async () => {
    const { deps } = createFakes({
      initializeTransaction: async () => {
        throw new PaymentProviderError('Paystack unreachable');
      },
    });
    await expect(
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'idem-1', deps),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe('generateKitArtifact / regenerateKitArtifact', () => {
  it('generateKitArtifact starts at version 1', async () => {
    const { deps } = createFakes();
    const artifact = await generateKitArtifact(ROLE_ID, deps);
    expect(artifact.version).toBe(1);
  });

  it('regenerateKitArtifact requires an existing paid order', async () => {
    const { deps } = createFakes();
    await expect(regenerateKitArtifact(OWNER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('regenerateKitArtifact creates a new, higher version — never overwrites the paid original', async () => {
    const { deps, setSucceededOrder, artifacts } = createFakes();
    setSucceededOrder({
      id: 'kit_1',
      employerId: OWNER_EMPLOYER_ID,
      roleId: ROLE_ID,
      amountNGN: 29000,
      checkoutUrl: null,
      status: 'succeeded',
      paystackReference: `${ROLE_ID}.kit_1`,
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    const first = await generateKitArtifact(ROLE_ID, deps);
    const second = await regenerateKitArtifact(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.html).toEqual(first.html); // the original is still present, untouched
  });

  it('rejects regeneration requested by a non-owning employer', async () => {
    const { deps, setSucceededOrder } = createFakes();
    setSucceededOrder({
      id: 'kit_1',
      employerId: OWNER_EMPLOYER_ID,
      roleId: ROLE_ID,
      amountNGN: 29000,
      checkoutUrl: null,
      status: 'succeeded',
      paystackReference: `${ROLE_ID}.kit_1`,
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    await expect(regenerateKitArtifact(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('getKitOrderStatus', () => {
  it("reports 'none' when no order has ever succeeded", async () => {
    const { deps } = createFakes();
    await expect(getKitOrderStatus(OWNER_EMPLOYER_ID, ROLE_ID, deps)).resolves.toEqual({
      status: 'none',
    });
  });

  it("reports 'succeeded' once a real order has", async () => {
    const { deps, setSucceededOrder } = createFakes();
    setSucceededOrder({
      id: 'kit_1',
      employerId: OWNER_EMPLOYER_ID,
      roleId: ROLE_ID,
      amountNGN: 29000,
      checkoutUrl: null,
      status: 'succeeded',
      paystackReference: `${ROLE_ID}.kit_1`,
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    await expect(getKitOrderStatus(OWNER_EMPLOYER_ID, ROLE_ID, deps)).resolves.toEqual({
      status: 'succeeded',
    });
  });

  it('rejects a role belonging to another employer — never confirms/denies purchase state cross-tenant', async () => {
    const { deps } = createFakes();
    await expect(getKitOrderStatus(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('getKitForDownload', () => {
  it('throws NotFoundError when no Kit has been generated yet', async () => {
    const { deps } = createFakes();
    await expect(getKitForDownload(OWNER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('returns the latest artifact once one exists', async () => {
    const { deps } = createFakes();
    await generateKitArtifact(ROLE_ID, deps);
    const artifact = await getKitForDownload(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(artifact.version).toBe(1);
  });

  it('rejects a non-owning employer', async () => {
    const { deps } = createFakes();
    await generateKitArtifact(ROLE_ID, deps);
    await expect(getKitForDownload(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

/**
 * Guards the same class of bug as the contactUnlocks switch: the `payments`
 * flag was defined in the schema, written to Parameter Store by every
 * environment, and read by nothing. Switching it off stopped no payment
 * anywhere.
 */
describe('the payments kill switch actually stops purchases', () => {
  it('refuses a Kit order while payments are off', async () => {
    const { deps } = createFakes({ payments: false });
    await expect(
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'idem-1', deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('never reaches Paystack, so nothing can be charged', async () => {
    // Checked before the order is created and before the transaction is
    // initialized. The message says nothing has been charged, and this is
    // what makes that true.
    const fakes = createFakes({ payments: false });
    await expect(
      requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'idem-1', fakes.deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fakes.initializeCalls).toEqual([]);
  });
});

/**
 * A KitOrder describes a thing that was bought. It cannot describe a
 * checkout that was opened and abandoned, or a `charge.success` whose
 * delivery failed for the full seventy-two hour retry window, and Paystack
 * sends no webhook for either. Without a payment attempt beside it, the Kit
 * would be the one paid product reconciliation could not recover.
 */
describe('requestKitOrder records a payment attempt', () => {
  it('writes one alongside the order, before Paystack is contacted', async () => {
    const { deps, paymentAttempts } = createFakes();
    await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);

    expect(paymentAttempts).toHaveLength(1);
    expect(paymentAttempts[0]).toMatchObject({
      purpose: 'kit',
      status: 'initialized',
      roleId: ROLE_ID,
      amountNGN: KIT_PRICE_NGN,
      currency: 'NGN',
    });
  });

  it('gives the attempt the same id and reference as the order it belongs to', async () => {
    const { deps, paymentAttempts } = createFakes();
    const { order } = await requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps);

    expect(paymentAttempts[0]?.id).toBe(order.id);
    expect(paymentAttempts[0]?.reference).toBe(order.paystackReference);
  });

  it('records nothing when the payments flag refuses the purchase', async () => {
    const { deps, paymentAttempts } = createFakes({ payments: false });
    await expect(requestKitOrder(OWNER_EMPLOYER_ID, ROLE_ID, 'key-1', deps)).rejects.toThrow();
    expect(paymentAttempts).toEqual([]);
  });
});
