import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from '../src/lib/paystack-client';
import { PaymentProviderError } from '../src/errors/typed-errors';

// Not a real credential — a fixed fixture value.
const FIXTURE_SECRET_KEY = 'sk_test_unit-test-fixture-not-a-real-credential';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initializePaystackTransaction', () => {
  it('sends the exact fields Paystack requires and returns the authorization URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
          reference: 'role_1:kit_1',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await initializePaystackTransaction(
      {
        email: 'employer@example.invalid',
        amountKobo: 2_900_000,
        reference: 'role_1:kit_1',
        callbackUrl: 'https://test.zoryvex.space/employer/role?id=role_1',
      },
      FIXTURE_SECRET_KEY,
    );

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc123',
      accessCode: 'abc123',
      reference: 'role_1:kit_1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${FIXTURE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'employer@example.invalid',
      amount: 2_900_000,
      currency: 'NGN',
      reference: 'role_1:kit_1',
      callback_url: 'https://test.zoryvex.space/employer/role?id=role_1',
    });
  });

  it('throws PaymentProviderError, never a raw fetch error, when Paystack rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(400, { status: false, message: 'Invalid key' })),
    );

    await expect(
      initializePaystackTransaction(
        {
          email: 'employer@example.invalid',
          amountKobo: 2_900_000,
          reference: 'role_1:kit_1',
          callbackUrl: 'https://test.zoryvex.space/employer/role?id=role_1',
        },
        FIXTURE_SECRET_KEY,
      ),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('throws PaymentProviderError when the network call itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(
      initializePaystackTransaction(
        {
          email: 'employer@example.invalid',
          amountKobo: 2_900_000,
          reference: 'role_1:kit_1',
          callbackUrl: 'https://test.zoryvex.space/employer/role?id=role_1',
        },
        FIXTURE_SECRET_KEY,
      ),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe('verifyPaystackTransaction', () => {
  it('calls the verify endpoint with the reference URL-encoded and returns the parsed result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: true,
        data: { status: 'success', reference: 'role_1:kit_1', amount: 2_900_000, currency: 'NGN' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyPaystackTransaction('role_1:kit_1', FIXTURE_SECRET_KEY);

    // The fields Paystack did not send read as null rather than being
    // absent, so a caller comparing them never has to distinguish "not
    // returned" from "returned empty" — the two mean the same thing here
    // and treating them differently is how a null channel becomes a
    // string "undefined" in a diagnostic view.
    expect(result).toEqual({
      status: 'success',
      reference: 'role_1:kit_1',
      amountKobo: 2_900_000,
      currency: 'NGN',
      transactionId: null,
      channel: null,
      gatewayResponse: null,
      paidAt: null,
      customerCode: null,
      customerEmail: null,
      planCode: null,
      authorization: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent('role_1:kit_1')}`,
    );
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${FIXTURE_SECRET_KEY}` });
  });

  it('throws PaymentProviderError when Paystack reports the transaction was not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { status: false, message: 'Transaction not found' })),
    );

    await expect(
      verifyPaystackTransaction('role_1:does-not-exist', FIXTURE_SECRET_KEY),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});
